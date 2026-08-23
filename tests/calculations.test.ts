import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import {
  calculateCompanyCashBalance,
  calculateDashboardMetrics,
  calculateExpenseTax,
  calculateExternalCashBalance,
  calculatePeriodExpenses,
  calculatePeriodPurchaseCosts,
  filterVehiclesByPurchaseDate,
  generateTaxReport,
  calculateSaleBreakdown,
  calculateVehicleTotalCost,
} from "../src/lib/domain/calculations";
import { generateBackupExport, generateTaxReportExport, restoreBackupDryRun, verifyBackupExport } from "../src/lib/backup/export";
import { getAllowedVehicleStatusTransitions, getPurchaseTaxRate, PURCHASE_SOURCES } from "../src/lib/domain/constants";
import { calculateTimeDecayWeight, extractConditionFeaturesFromText, inferMarketType, normalizeListing, runComparableEstimator, shouldRefreshVehicle, shouldStoreValuationSnapshot } from "../src/lib/market-snap/engine";
import { processTemporaryListingImages } from "../src/lib/market-snap/image-features";
import { convertDealRadarListingToInventory } from "../src/lib/market-snap/repository";
import { importPayloadSchema, marketListingPayloadSchema } from "../src/lib/market-snap/validation";
import { assertAllowedUpload, canExportTaxReports, canManageBackups, sanitizeCsvCell, sanitizeStorageFileName } from "../src/lib/security";
import { assertSameOrigin, checkRateLimit, resetRateLimitForTests, RouteSecurityError } from "../src/lib/server/security";
import { activityLogSchema, applyRecurringExpenseTemplateSchema, attachmentSchema, backupRequestSchema, cashTransactionSchema, contactSchema, expenseSchema, normalizeVin, recurringExpenseTemplateSchema, regenerateInvitationSchema, saleCorrectionSchema, saleVoidSchema, taxExportSchema, vehicleAnyUpdateSchema, vehicleSchema } from "../src/lib/validation";
import { dedupeOrganizationsByHighestRole, emptyAppData, mapExpense, mapVehicle } from "../src/lib/supabase/mappers";
import { activeVehiclesOnly, isValidVehicleDeleteConfirmation } from "../src/lib/vehicle-delete";
import type {
  CompanyCashTransaction,
  ExternalCashTransaction,
  Sale,
  Vehicle,
  VehicleExpense,
} from "../src/types/domain";
import type { VehicleValuation } from "../src/types/market-snap";

const vehicle: Vehicle = {
  id: "vehicle-1",
  organizationId: "org-1",
  vin: "VIN",
  purchasePrice: 10000,
  purchaseDate: "2026-01-01",
  purchaseSource: "OpenLane",
  status: "sold",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  createdBy: "user-1",
};

test("purchase tax rules are source-aware and OpenLane-only", () => {
  for (const source of PURCHASE_SOURCES) {
    const expectedTaxRate = source === "OpenLane" ? 0.05 : 0;
    assert.equal(getPurchaseTaxRate(source), expectedTaxRate);
    assert.deepEqual(
      calculateExpenseTax({
        purchaseSource: source,
        category: "vehicle_purchase_price",
        amountBeforeTax: 10000,
      }),
      {
        taxRate: expectedTaxRate,
        taxAmount: expectedTaxRate * 10000,
        totalAmount: 10000 + expectedTaxRate * 10000,
      },
    );
  }

  assert.deepEqual(
    calculateExpenseTax({
      purchaseSource: "OpenLane",
      category: "vehicle_purchase_price",
      amountBeforeTax: 10000,
    }),
    { taxRate: 0.05, taxAmount: 500, totalAmount: 10500 },
  );
  assert.deepEqual(
    calculateExpenseTax({
      purchaseSource: "FacebookMarketplace",
      category: "vehicle_purchase_price",
      amountBeforeTax: 10000,
    }),
    { taxRate: 0, taxAmount: 0, totalAmount: 10000 },
  );
  assert.deepEqual(
    calculateExpenseTax({
      purchaseSource: "OpenLane",
      category: "auction_fee",
      amountBeforeTax: 1000,
    }),
    { taxRate: 0.15, taxAmount: 150, totalAmount: 1150 },
  );
  assert.deepEqual(
    calculateExpenseTax({
      purchaseSource: "OpenLane",
      category: "repair",
      amountBeforeTax: 100,
      addFifteenPercentTax: true,
    }),
    { taxRate: 0.15, taxAmount: 15, totalAmount: 115 },
  );
  assert.deepEqual(
    calculateExpenseTax({
      purchaseSource: "OpenLane",
      category: "repair",
      amountBeforeTax: 100,
    }),
    { taxRate: 0, taxAmount: 0, totalAmount: 100 },
  );
});

test("Market Snap normalizes listings and separates salvage from clean markets", () => {
  const clean = normalizeListing({
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    sourceName: "AutoTrader/AutoHebdo",
    sourceType: "retail",
    title: "2020 Toyota Corolla LE",
    year: 2020,
    make: "Toyota",
    model: "Corolla",
    mileageKm: 80000,
    listedPrice: 17995,
    capturedAt: new Date().toISOString(),
  });
  const salvage = normalizeListing({
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    sourceName: "Copart",
    sourceType: "salvage",
    title: "2020 Toyota Corolla salvage",
    description: "front damage, non-repairable, parts only",
    listedPrice: 3500,
  });

  assert.equal(clean.marketType, "clean_retail_market");
  assert.equal(salvage.marketType, "salvage_auction_market");
  assert.ok(salvage.warnings.some((warning) => warning.includes("separated")));
});

test("Market Snap time decay lowers old listing weight", () => {
  const recent = calculateTimeDecayWeight(new Date().toISOString());
  const old = calculateTimeDecayWeight("2025-01-01T00:00:00.000Z");

  assert.ok(recent > old);
  assert.ok(old >= 0.08);
});

test("Market Snap comparable estimator scores deals, risk, cost basis, and recommendation", () => {
  const valuation = runComparableEstimator({
    organizationId: "org-1",
    vehicle: { ...vehicle, status: "listed_for_sale", purchaseSource: "other", year: 2020, make: "Toyota", model: "Corolla", mileage: 80000, listedPrice: 18000, purchasePrice: 12000 },
    expenses: [],
    comparables: [
      { sourceName: "AutoTrader/AutoHebdo", marketType: "clean_retail_market", year: 2020, make: "Toyota", model: "Corolla", mileageKm: 82000, listedPrice: 18500, capturedAt: new Date().toISOString() },
      { sourceName: "AutoTrader/AutoHebdo", marketType: "clean_retail_market", year: 2021, make: "Toyota", model: "Corolla", mileageKm: 76000, listedPrice: 19900, capturedAt: new Date().toISOString() },
    ],
  });

  assert.equal(valuation.estimatorType, "comparable_estimator");
  assert.equal(valuation.marketType, "clean_retail_market");
  assert.ok(valuation.estimatedRetailMarketValue > 0);
  assert.ok(valuation.estimatedWholesaleBuyValue < valuation.estimatedRetailMarketValue);
  assert.ok(valuation.maxRecommendedBid >= 0);
  assert.ok(valuation.confidenceScore > 0);
  assert.ok(["Strong Buy", "Negotiate", "Avoid", "High Risk"].includes(valuation.recommendationBadge));
});

test("Market Snap refresh excludes sold vehicles and stores only useful snapshots", () => {
  const soldVehicle: Vehicle = { ...vehicle, status: "sold" };
  const activeVehicle: Vehicle = { ...vehicle, status: "listed_for_sale" };
  const archivedVehicle: Vehicle = { ...activeVehicle, archivedAt: "2026-05-13T12:00:00.000Z" };
  const valuationBase: VehicleValuation = runComparableEstimator({
    organizationId: "org-1",
    vehicle: activeVehicle,
    comparables: [],
  });
  const unchanged = { ...valuationBase, valuationDate: new Date().toISOString() };
  const changed = { ...valuationBase, estimatedRetailMarketValue: valuationBase.estimatedRetailMarketValue + 1000 };

  assert.equal(shouldRefreshVehicle(soldVehicle), false);
  assert.equal(shouldRefreshVehicle(activeVehicle), true);
  assert.equal(shouldRefreshVehicle(archivedVehicle), false);
  assert.equal(shouldStoreValuationSnapshot(valuationBase, unchanged), false);
  assert.equal(shouldStoreValuationSnapshot(valuationBase, changed), true);
});

test("Market Snap extension/API payload validation accepts visible listing data only", () => {
  assert.equal(marketListingPayloadSchema.safeParse({
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    sourceName: "OpenLane",
    sourceType: "auction",
    listingUrl: "https://example.com/listing/1",
    title: "2021 Honda Civic",
    year: 2021,
    make: "Honda",
    model: "Civic",
    mileageKm: 60000,
    listedPrice: 16000,
  }).success, true);
  assert.equal(inferMarketType("IAA", "salvage", "salvage", "airbag deployed"), "salvage_auction_market");
  assert.equal(marketListingPayloadSchema.safeParse({
    organizationId: "not-an-org",
    sourceName: "",
    listingUrl: "javascript:alert(1)",
  }).success, false);
});

test("Market Snap import validation can use batch source name for rows", () => {
  assert.equal(importPayloadSchema.safeParse({
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    sourceName: "Manual JSON Import",
    rows: [{ year: 2020, make: "Toyota", model: "Corolla", listedPrice: 18000 }],
  }).success, true);
});

test("Market Snap condition intelligence keeps unknowns but raises risk for severe evidence", () => {
  const clean = runComparableEstimator({
    organizationId: "org-1",
    listing: {
      organizationId: "org-1",
      sourceName: "AutoTrader/AutoHebdo",
      sourceType: "retail",
      year: 2020,
      make: "Toyota",
      model: "Corolla",
      mileageKm: 80000,
      listedPrice: 18000,
      imageCount: 8,
    },
    comparables: [],
  });
  const highRisk = runComparableEstimator({
    organizationId: "org-1",
    listing: {
      organizationId: "org-1",
      sourceName: "Copart",
      sourceType: "salvage",
      title: "2020 Toyota Corolla salvage structural rust",
      description: "P0700 transmission code, non-repairable, parts only, flood damage",
      year: 2020,
      make: "Toyota",
      model: "Corolla",
      mileageKm: 80000,
      auctionHammerPrice: 4000,
      diagnosticFeatures: {
        diagnosticCodesAvailable: true,
        obdCodes: [{ code: "P0700", severity: "high", description: "Transmission control system" }],
      },
    },
    comparables: [],
  });

  assert.ok(clean.missingData.includes("diagnostic_codes_unknown"));
  assert.ok(highRisk.riskScore > clean.riskScore);
  assert.equal(highRisk.recommendationBadge, "High Risk");
  assert.ok(highRisk.estimatedReconditioningCost > clean.estimatedReconditioningCost);
});

test("Market Snap extracts only explicit condition evidence from text", () => {
  const features = extractConditionFeaturesFromText("frame rust, cracked bumper, SRS airbag warning, clean title");

  assert.equal(features.rust?.rustDetected, true);
  assert.equal(features.rust?.rustSeverity, "structural");
  assert.equal(features.cosmetic?.cosmeticDamageDetected, true);
  assert.equal(features.mechanical?.electricalIssue, true);
  assert.equal(features.title?.cleanTitle, true);
});

test("Market Snap image pipeline stores features and releases temporary buffers", async () => {
  let fetched = 0;
  const features = await processTemporaryListingImages({
    imageUrls: ["https://example.test/a.jpg", "https://example.test/b.jpg"],
    fetchImage: async () => {
      fetched += 1;
      return new ArrayBuffer(8);
    },
  });

  assert.equal(fetched, 2);
  assert.equal(features.imageCount, 2);
  assert.equal(features.photoAnalysisStatus, "processed");
  assert.equal(Boolean(features.imageProcessedAt), true);
});

test("Market Snap image pipeline records per-image failures without inventing visual condition", async () => {
  const features = await processTemporaryListingImages({
    imageUrls: ["https://example.test/good.jpg", "https://example.test/bad.jpg"],
    fetchImage: async (url) => {
      if (url.includes("bad")) throw new Error("blocked");
      return new ArrayBuffer(8);
    },
  });

  assert.equal(features.imageCount, 1);
  assert.equal(features.photoAnalysisStatus, "processed");
  assert.equal(features.rustVisibleScore, undefined);
  assert.equal(features.damageVisibleScore, undefined);
  assert.equal(features.imageProcessingErrors?.length, 1);
});

test("Deal Radar conversion prefills only known listing fields", () => {
  const prefill = convertDealRadarListingToInventory({
    source_name: "Facebook Marketplace",
    listing_url: "https://example.test/listing",
    year: 2021,
    make: "Honda",
    model: "Civic",
    mileage_km: 60000,
    listed_price: 16000,
    color: "Red",
    vin: "SHOULD_NOT_COPY",
  });

  assert.deepEqual(Object.keys(prefill).sort(), ["make", "mileage", "model", "notes", "purchasePrice", "purchaseSource", "trim", "year"].sort());
  assert.equal(prefill.make, "Honda");
  assert.equal(prefill.purchaseSource, "FacebookMarketplace");
  assert.equal("vin" in prefill, false);
});

test("optional 15 percent tax works for regular expenses", () => {
  assert.equal(
    calculateExpenseTax({
      purchaseSource: "Copart",
      category: "repair",
      amountBeforeTax: 200,
      addFifteenPercentTax: true,
    }).totalAmount,
    230,
  );
  assert.equal(
    calculateExpenseTax({
      purchaseSource: "Copart",
      category: "repair",
      amountBeforeTax: 200,
      addFifteenPercentTax: false,
    }).totalAmount,
    200,
  );
});

test("recurring expense tax behavior supports no tax, 15 percent, and custom rates", () => {
  assert.deepEqual(
    calculateExpenseTax({ category: "other", amountBeforeTax: 250, taxBehavior: "no_tax" }),
    { taxRate: 0, taxAmount: 0, totalAmount: 250 },
  );
  assert.deepEqual(
    calculateExpenseTax({ category: "other", amountBeforeTax: 250, taxBehavior: "add_15_percent" }),
    { taxRate: 0.15, taxAmount: 37.5, totalAmount: 287.5 },
  );
  assert.deepEqual(
    calculateExpenseTax({ category: "other", amountBeforeTax: 250, taxBehavior: "custom", customTaxRate: 0.1 }),
    { taxRate: 0.1, taxAmount: 25, totalAmount: 275 },
  );
});

test("Commission Plaque is always non-taxable", () => {
  assert.deepEqual(
    calculateExpenseTax({
      purchaseSource: "OpenLane",
      category: "commission_plaque",
      amountBeforeTax: 250,
      addFifteenPercentTax: true,
    }),
    { taxRate: 0, taxAmount: 0, totalAmount: 250 },
  );
});

test("sale breakdown separates paper sale, tax, and external commission", () => {
  assert.deepEqual(
    calculateSaleBreakdown({
      vehicleTotalCost: 12000,
      taxableProfitAmount: 2000,
      realClientPayment: 15000,
    }),
    {
      paperSalePrice: 14000,
      profitTaxDue: 440,
      externalCommission: 1000,
      netProfitAfterTax: 1560,
    },
  );
});

test("vehicle total cost and cash balances are calculated", () => {
  const expenses: VehicleExpense[] = [
    {
      id: "expense-1",
      organizationId: "org-1",
      vehicleId: "vehicle-1",
      category: "repair",
      amountBeforeTax: 100,
      taxRate: 0.15,
      taxAmount: 15,
      totalAmount: 115,
      date: "2026-01-02",
      createdAt: "2026-01-02",
      createdBy: "user-1",
    },
  ];
  assert.equal(calculateVehicleTotalCost(vehicle, expenses), 10115);

  const company: CompanyCashTransaction[] = [
    { id: "1", organizationId: "org-1", type: "company_cash_added", amount: 5000, date: "2026-01-01", createdAt: "2026-01-01", createdBy: "user-1" },
    { id: "2", organizationId: "org-1", type: "company_cash_withdrawn", amount: 500, date: "2026-01-02", createdAt: "2026-01-02", createdBy: "user-1" },
  ];
  const external: ExternalCashTransaction[] = [
    { id: "0", organizationId: "org-1", type: "external_cash_added", amount: 1000, date: "2026-01-01", createdAt: "2026-01-01", createdBy: "user-1" },
    { id: "1", organizationId: "org-1", type: "external_commission_earned", amount: 700, date: "2026-01-01", createdAt: "2026-01-01", createdBy: "user-1" },
    { id: "2", organizationId: "org-1", type: "external_cash_transferred_to_company", amount: 200, date: "2026-01-02", createdAt: "2026-01-02", createdBy: "user-1" },
    { id: "3", organizationId: "org-1", type: "external_vehicle_expense_paid", amount: 50, date: "2026-01-03", createdAt: "2026-01-03", createdBy: "user-1" },
  ];
  assert.equal(calculateCompanyCashBalance(company), 4500);
  assert.equal(calculateExternalCashBalance(external), 1450);
});

test("expense validation and mapping support funding source defaults", () => {
  assert.equal(expenseSchema.safeParse({
    category: "repair",
    amountBeforeTax: 100,
    addTax: "on",
    fundingSource: "external_cash",
    date: "2026-05-09",
  }).success, true);
  assert.equal(expenseSchema.safeParse({
    category: "repair",
    amountBeforeTax: 100,
    fundingSource: "personal_wallet",
    date: "2026-05-09",
  }).success, false);
  assert.equal(mapExpense({
    id: "expense-1",
    organization_id: "org-1",
    vehicle_id: "vehicle-1",
    category: "repair",
    amount_before_tax: 100,
    tax_rate: 0,
    tax_amount: 0,
    total_amount: 100,
    date: "2026-05-09",
    created_at: "2026-05-09",
    created_by: "user-1",
  }).fundingSource, "company_cash");
});

test("recurring expense template validation is organization-safe input shape", () => {
  assert.equal(recurringExpenseTemplateSchema.safeParse({
    name: "Plate commission",
    category: "commission_plaque",
    amountBeforeTax: 250,
    taxBehavior: "no_tax",
    defaultFundingSource: "company_cash",
    autoApplyToNewVehicles: "on",
    isActive: "on",
  }).success, true);
  assert.equal(recurringExpenseTemplateSchema.safeParse({
    name: "Bad template",
    category: "other",
    amountBeforeTax: 250,
    taxBehavior: "custom",
    customTaxRate: 2,
    defaultFundingSource: "external_cash",
  }).success, false);
});


test("applying a recurring expense template requires vehicle and template ids", () => {
  assert.equal(applyRecurringExpenseTemplateSchema.safeParse({
    vehicleId: "63c47786-fb41-40c1-a573-71346969b9e0",
    templateId: "b7568098-9d05-4619-9b19-63d6ef6217b8",
  }).success, true);
  assert.equal(applyRecurringExpenseTemplateSchema.safeParse({
    templateId: "b7568098-9d05-4619-9b19-63d6ef6217b8",
  }).success, false);
  assert.equal(applyRecurringExpenseTemplateSchema.safeParse({
    vehicleId: "63c47786-fb41-40c1-a573-71346969b9e0",
    templateId: "not-a-template-id",
  }).success, false);
});

test("domain validation rejects invalid controlled values", () => {
  assert.equal(cashTransactionSchema.safeParse({
    type: "external_cash_personally_removed",
    amount: 100,
    date: "2026-05-13",
  }).success, true);
  assert.equal(cashTransactionSchema.safeParse({
    type: "surprise_cash_type",
    amount: 100,
    date: "2026-05-13",
  }).success, false);
  assert.equal(contactSchema.safeParse({
    type: "buyer",
    fullName: "Jane Buyer",
  }).success, true);
  assert.equal(contactSchema.safeParse({
    type: "random_contact",
    fullName: "Jane Buyer",
  }).success, false);
  assert.equal(expenseSchema.safeParse({
    category: "repair",
    amountBeforeTax: 100,
    fundingSource: "wallet",
  }).success, false);
  assert.equal(vehicleAnyUpdateSchema.safeParse({
    updateMode: "status",
    status: "missing",
  }).success, false);
});

test("vehicle VIN validation normalizes quality input and rejects unsafe identifiers", () => {
  assert.equal(normalizeVin(" 1hg cm8263 3a004352 "), "1HGCM82633A004352");
  const valid = vehicleSchema.parse({
    vin: " 1hg cm8263 3a004352 ",
    purchasePrice: 12000,
    purchaseDate: "2026-05-13",
    purchaseSource: "OpenLane",
    status: "purchased",
  });
  assert.equal(valid.vin, "1HGCM82633A004352");
  assert.equal(vehicleSchema.safeParse({
    vin: "",
    purchasePrice: 12000,
    purchaseDate: "2026-05-13",
    purchaseSource: "OpenLane",
    status: "purchased",
  }).success, true);
  assert.equal(vehicleSchema.safeParse({
    vin: "1HGCM82633A00435",
    purchasePrice: 12000,
    purchaseDate: "2026-05-13",
    purchaseSource: "OpenLane",
    status: "purchased",
  }).success, false);
  assert.equal(vehicleSchema.safeParse({
    vin: "1HGCM82633A00IOQ2",
    purchasePrice: 12000,
    purchaseDate: "2026-05-13",
    purchaseSource: "OpenLane",
    status: "purchased",
  }).success, false);
});

test("validation migration backs active VIN uniqueness without unsafe duplicate cleanup", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260519_validation_domain_integrity.sql"), "utf8");
  const route = readFileSync(join(process.cwd(), "src/app/api/mutations/route.ts"), "utf8");
  const repository = readFileSync(join(process.cwd(), "src/lib/supabase/repository.ts"), "utf8");

  assert.match(sql, /create or replace function normalize_vehicle_vin/i);
  assert.match(sql, /vehicles_vin_quality/i);
  assert.match(sql, /contacts_type_valid/i);
  assert.match(sql, /Duplicate active VINs exist/i);
  assert.match(sql, /vehicles_org_active_vin_unique_idx/i);
  assert.match(route, /assertUniqueActiveVin/i);
  assert.match(route, /Another active vehicle already uses this VIN/i);
  assert.match(repository, /normalizeVin\(formData\.get\("vin"\)\)/i);
});
test("duplicate organization rows resolve to the highest role", () => {
  const organizations = dedupeOrganizationsByHighestRole([
    { id: "org-1", name: "Lot", role: "viewer", inviteCode: "VIEWER" },
    { id: "org-1", name: "Lot", role: "owner", inviteCode: "OWNER" },
    { id: "org-2", name: "Other Lot", role: "viewer", inviteCode: "" },
  ]);

  assert.equal(organizations.length, 2);
  assert.equal(organizations.find((organization) => organization.id === "org-1")?.role, "owner");
});

test("membership migration preserves existing roles and avoids unsafe duplicate cleanup", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260509_membership_role_resolution.sql"), "utf8");

  assert.match(sql, /join_organization_by_access_code/i);
  assert.match(sql, /set role = organization_memberships\.role/i);
  assert.match(sql, /unique \(organization_id, user_id\)/i);
  assert.match(sql, /Duplicate organization memberships exist/i);
});

test("deleted cash transactions are excluded from balances", () => {
  const company: CompanyCashTransaction[] = [
    { id: "1", organizationId: "org-1", type: "company_cash_added", amount: 5000, date: "2026-01-01", createdAt: "2026-01-01", createdBy: "user-1" },
    { id: "2", organizationId: "org-1", type: "company_cash_added", amount: 9000, date: "2026-01-02", createdAt: "2026-01-02", createdBy: "user-1", deletedAt: "2026-01-03" },
  ];
  const external: ExternalCashTransaction[] = [
    { id: "1", organizationId: "org-1", type: "external_commission_earned", amount: 1200, date: "2026-01-01", createdAt: "2026-01-01", createdBy: "user-1" },
    { id: "2", organizationId: "org-1", type: "external_cash_personally_removed", amount: 400, date: "2026-01-02", createdAt: "2026-01-02", createdBy: "user-1", deletedAt: "2026-01-03" },
  ];

  assert.equal(calculateCompanyCashBalance(company), 5000);
  assert.equal(calculateExternalCashBalance(external), 1200);
});

test("cash reversal entries preserve history while offsetting balances", () => {
  const company: CompanyCashTransaction[] = [
    { id: "deposit", organizationId: "org-1", type: "company_cash_added", amount: 10000, date: "2026-01-01", createdAt: "2026-01-01", createdBy: "user-1" },
    { id: "withdrawal", organizationId: "org-1", type: "company_cash_withdrawn", amount: 2000, date: "2026-01-02", createdAt: "2026-01-02", createdBy: "user-1", reversedTransactionId: "withdrawal-reversal", voidedAt: "2026-01-03", voidReason: "Wrong amount" },
    { id: "withdrawal-reversal", organizationId: "org-1", type: "company_cash_added", amount: 2000, date: "2026-01-03", createdAt: "2026-01-03", createdBy: "user-2", correctionOfTransactionId: "withdrawal" },
  ];
  const external: ExternalCashTransaction[] = [
    { id: "commission", organizationId: "org-1", type: "external_commission_earned", amount: 1500, date: "2026-01-01", createdAt: "2026-01-01", createdBy: "user-1", reversedTransactionId: "commission-reversal", voidedAt: "2026-01-04" },
    { id: "commission-reversal", organizationId: "org-1", type: "external_cash_personally_removed", amount: 1500, date: "2026-01-04", createdAt: "2026-01-04", createdBy: "user-2", correctionOfTransactionId: "commission" },
  ];

  assert.equal(calculateCompanyCashBalance(company), 10000);
  assert.equal(calculateExternalCashBalance(external), 0);
});

test("deposit and commission reversals can reveal invalid negative balances", () => {
  const company: CompanyCashTransaction[] = [
    { id: "deposit", organizationId: "org-1", type: "company_cash_added", amount: 10000, date: "2026-01-01", createdAt: "2026-01-01", createdBy: "user-1" },
    { id: "spent", organizationId: "org-1", type: "company_cash_withdrawn", amount: 8000, date: "2026-01-02", createdAt: "2026-01-02", createdBy: "user-1" },
    { id: "deposit-reversal", organizationId: "org-1", type: "company_cash_withdrawn", amount: 10000, date: "2026-01-03", createdAt: "2026-01-03", createdBy: "user-2", correctionOfTransactionId: "deposit" },
  ];
  const external: ExternalCashTransaction[] = [
    { id: "commission", organizationId: "org-1", type: "external_commission_earned", amount: 1500, date: "2026-01-01", createdAt: "2026-01-01", createdBy: "user-1" },
    { id: "transfer", organizationId: "org-1", type: "external_cash_transferred_to_company", amount: 1000, date: "2026-01-02", createdAt: "2026-01-02", createdBy: "user-1" },
    { id: "commission-reversal", organizationId: "org-1", type: "external_cash_personally_removed", amount: 1500, date: "2026-01-03", createdAt: "2026-01-03", createdBy: "user-2", correctionOfTransactionId: "commission" },
  ];

  assert.equal(calculateCompanyCashBalance(company), -8000);
  assert.equal(calculateExternalCashBalance(external), -1000);
});

test("cash reversal migration blocks invalid and system-generated reversals", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260516_cash_ledger_reversal_integrity.sql"), "utf8");
  const repository = readFileSync(join(process.cwd(), "src/lib/supabase/repository.ts"), "utf8");

  assert.match(sql, /add column if not exists reversed_transaction_id uuid/i);
  assert.match(sql, /add column if not exists correction_of_transaction_id uuid/i);
  assert.match(sql, /add column if not exists voided_at timestamptz/i);
  assert.match(sql, /create or replace function reverse_company_cash_transaction/i);
  assert.match(sql, /create or replace function reverse_external_cash_transaction/i);
  assert.match(sql, /perform 1 from organizations where id = p_organization_id for update/i);
  assert.match(sql, /source_vehicle_id is not null or original\.source_expense_id is not null/i);
  assert.match(sql, /organization_company_cash_balance\(p_organization_id\) \+ reversal_effect < 0/i);
  assert.match(sql, /organization_external_cash_balance\(p_organization_id\) \+ reversal_effect < 0/i);
  assert.match(sql, /correction_of_transaction_id,\s*created_by/i);
  assert.match(sql, /set reversed_transaction_id = reversal_id/i);
  assert.match(sql, /void_reason = coalesce\(clean_reason/i);
  assert.match(sql, /cash_transaction_reversed/i);
  assert.match(sql, /grant execute on function reverse_company_cash_transaction/i);
  assert.match(sql, /grant execute on function reverse_external_cash_transaction/i);

  assert.match(repository, /rpc\(rpcName/i);
  assert.match(repository, /reverse_company_cash_transaction/i);
  assert.match(repository, /reverse_external_cash_transaction/i);
  assert.doesNotMatch(repository, /cash_transaction_deleted/);
  assert.doesNotMatch(repository, /Deleted from cash management/);
});

test("vehicle purchase price expense does not duplicate the vehicle purchase price", () => {
  const tiguan: Vehicle = {
    ...vehicle,
    id: "tiguan",
    purchasePrice: 4000,
  };
  const expenses: VehicleExpense[] = [
    {
      id: "purchase-expense",
      organizationId: "org-1",
      vehicleId: "tiguan",
      category: "vehicle_purchase_price",
      amountBeforeTax: 4000,
      taxRate: 0.05,
      taxAmount: 200,
      totalAmount: 4200,
      date: "2026-04-13",
      createdAt: "2026-04-13",
      createdBy: "user-1",
    },
    {
      id: "repair-expense",
      organizationId: "org-1",
      vehicleId: "tiguan",
      category: "repair",
      amountBeforeTax: 555,
      taxRate: 0.15,
      taxAmount: 83.25,
      totalAmount: 638.25,
      date: "2026-05-07",
      createdAt: "2026-05-07",
      createdBy: "user-1",
    },
  ];

  assert.equal(calculateVehicleTotalCost(tiguan, expenses), 4838.25);
});

test("tax report period totals filter vehicles by purchase date without losing period activity", () => {
  const januaryVehicle: Vehicle = {
    ...vehicle,
    id: "jan-vehicle",
    purchasePrice: 10000,
    purchaseDate: "2026-01-15",
    status: "sold",
  };
  const februaryVehicle: Vehicle = {
    ...vehicle,
    id: "feb-vehicle",
    purchasePrice: 20000,
    purchaseDate: "2026-02-10",
    status: "listed_for_sale",
  };
  const marchVehicleWithExpenseOnly: Vehicle = {
    ...vehicle,
    id: "march-expense-vehicle",
    purchasePrice: 0,
    purchaseDate: "2026-03-05",
    status: "purchased",
  };
  const expenses: VehicleExpense[] = [
    {
      id: "jan-purchase-expense",
      organizationId: "org-1",
      vehicleId: januaryVehicle.id,
      category: "vehicle_purchase_price",
      amountBeforeTax: 10000,
      taxRate: 0.05,
      taxAmount: 500,
      totalAmount: 10500,
      fundingSource: "company_cash",
      date: "2026-01-15",
      createdAt: "2026-01-15",
      createdBy: "user-1",
    },
    {
      id: "feb-repair",
      organizationId: "org-1",
      vehicleId: januaryVehicle.id,
      category: "repair",
      amountBeforeTax: 300,
      taxRate: 0.15,
      taxAmount: 45,
      totalAmount: 345,
      fundingSource: "company_cash",
      date: "2026-02-12",
      createdAt: "2026-02-12",
      createdBy: "user-1",
    },
    {
      id: "march-purchase-expense",
      organizationId: "org-1",
      vehicleId: marchVehicleWithExpenseOnly.id,
      category: "vehicle_purchase_price",
      amountBeforeTax: 7000,
      taxRate: 0.05,
      taxAmount: 350,
      totalAmount: 7350,
      fundingSource: "company_cash",
      date: "2026-03-05",
      createdAt: "2026-03-05",
      createdBy: "user-1",
    },
  ];
  const marchSale: Sale = {
    id: "march-sale",
    organizationId: "org-1",
    vehicleId: januaryVehicle.id,
    saleDate: "2026-03-20",
    vehicleTotalCost: 10845,
    taxableProfitAmount: 2000,
    profitTaxDue: 440,
    paperSalePrice: 12845,
    realClientPayment: 13000,
    externalCommission: 155,
    createdAt: "2026-03-20",
    createdBy: "user-1",
  };
  const companyCashTransactions: CompanyCashTransaction[] = [
    {
      id: "jan-cash",
      organizationId: "org-1",
      type: "vehicle_cost_paid",
      amount: 10500,
      date: "2026-01-15",
      sourceVehicleId: januaryVehicle.id,
      sourceExpenseId: "jan-purchase-expense",
      createdAt: "2026-01-15",
      createdBy: "user-1",
    },
    {
      id: "feb-cash",
      organizationId: "org-1",
      type: "vehicle_cost_paid",
      amount: 345,
      date: "2026-02-12",
      sourceVehicleId: januaryVehicle.id,
      sourceExpenseId: "feb-repair",
      createdAt: "2026-02-12",
      createdBy: "user-1",
    },
  ];
  const data = {
    vehicles: [januaryVehicle, februaryVehicle, marchVehicleWithExpenseOnly],
    expenses,
    sales: [marchSale],
    companyCashTransactions,
    externalCashTransactions: [] as ExternalCashTransaction[],
  };

  assert.deepEqual(filterVehiclesByPurchaseDate(data.vehicles, "2026-02-01", "2026-02-28").map((item) => item.id), ["feb-vehicle"]);
  assert.equal(calculatePeriodPurchaseCosts(data.vehicles, "2026-02-01", "2026-02-28"), 20000);
  assert.equal(calculatePeriodExpenses(data.vehicles, data.expenses, "2026-02-01", "2026-02-28"), 345);

  const februaryReport = generateTaxReport({ ...data, startDate: "2026-02-01", endDate: "2026-02-28" });
  assert.equal(februaryReport.vehiclePurchaseCosts, 20000);
  assert.equal(februaryReport.totalExpenses, 20345);
  assert.equal(februaryReport.totalTaxableProfit, 0);

  const marchReport = generateTaxReport({ ...data, startDate: "2026-03-01", endDate: "2026-03-31" });
  assert.equal(marchReport.vehiclePurchaseCosts, 0);
  assert.equal(marchReport.totalExpenses, 7350);
  assert.equal(marchReport.totalTaxableProfit, 2000);
  assert.equal(marchReport.taxDue, 440);

  const emptyReport = generateTaxReport({ ...data, startDate: "2026-04-01", endDate: "2026-04-30" });
  assert.deepEqual(emptyReport, {
    totalTaxableProfit: 0,
    taxDue: 0,
    totalCompanySales: 0,
    totalExternalCommission: 0,
    externalTransferredToCompany: 0,
    externalPersonallyRemoved: 0,
    vehiclePurchaseCosts: 0,
    auctionFees: 0,
    totalExpenses: 0,
    taxesPaidOnPurchasesAndExpenses: 0,
    netProfitAfterTax: 0,
    companyCashAdded: 0,
  });
});

test("voided sales are excluded from dashboard and tax report totals", () => {
  const activeSale: Sale = {
    id: "active-sale",
    organizationId: "org-1",
    vehicleId: "vehicle-1",
    saleDate: "2026-03-01",
    vehicleTotalCost: 10000,
    taxableProfitAmount: 2000,
    profitTaxDue: 440,
    paperSalePrice: 12000,
    realClientPayment: 13000,
    externalCommission: 1000,
    status: "active",
    createdAt: "2026-03-01",
    createdBy: "user-1",
  };
  const voidedSale: Sale = {
    ...activeSale,
    id: "voided-sale",
    taxableProfitAmount: 9000,
    profitTaxDue: 1980,
    paperSalePrice: 19000,
    externalCommission: 5000,
    status: "voided",
    voidedAt: "2026-03-02",
  };

  const report = generateTaxReport({
    vehicles: [vehicle],
    expenses: [],
    sales: [activeSale, voidedSale],
    companyCashTransactions: [],
    externalCashTransactions: [],
  });
  const metrics = calculateDashboardMetrics({
    vehicles: [vehicle],
    expenses: [],
    sales: [activeSale, voidedSale],
    companyCashTransactions: [],
    externalCashTransactions: [],
  });

  assert.equal(report.totalTaxableProfit, 2000);
  assert.equal(report.totalCompanySales, 12000);
  assert.equal(report.totalExternalCommission, 1000);
  assert.equal(metrics.netProfit, 1560);
});

test("sale void and correction validation requires auditable reasons", () => {
  assert.equal(saleVoidSchema.safeParse({
    saleId: "63c47786-fb41-40c1-a573-71346969b9e0",
    reason: "Customer cancelled",
  }).success, true);
  assert.equal(saleVoidSchema.safeParse({
    saleId: "63c47786-fb41-40c1-a573-71346969b9e0",
    reason: "",
  }).success, false);
  assert.equal(saleCorrectionSchema.safeParse({
    saleId: "63c47786-fb41-40c1-a573-71346969b9e0",
    saleDate: "2026-03-05",
    taxableProfitAmount: 2500,
    realClientPayment: 14000,
    buyerName: "Correct Buyer",
    reason: "Wrong payment amount",
  }).success, true);
});

test("sale void correction migration preserves sale and reverses cash impacts", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260518_sale_void_correction_workflow.sql"), "utf8");
  const calculations = readFileSync(join(process.cwd(), "src/lib/domain/calculations.ts"), "utf8");
  const marketSnapApi = readFileSync(join(process.cwd(), "src/lib/server/market-snap-api.ts"), "utf8");
  const repository = readFileSync(join(process.cwd(), "src/lib/supabase/repository.ts"), "utf8");

  assert.match(sql, /add column if not exists voided_at timestamptz/i);
  assert.match(sql, /add column if not exists corrected_by_sale_id uuid references sales/i);
  assert.match(sql, /add column if not exists correction_of_sale_id uuid references sales/i);
  assert.match(sql, /drop constraint if exists sales_one_per_vehicle/i);
  assert.match(sql, /create unique index sales_one_active_per_vehicle_idx/i);
  assert.match(sql, /create or replace function void_vehicle_sale_atomic/i);
  assert.match(sql, /create or replace function correct_vehicle_sale_atomic/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /organization_company_cash_balance\(p_organization_id\) - sale_record\.paper_sale_price < 0/i);
  assert.match(sql, /company_cash_withdrawn/i);
  assert.match(sql, /external_cash_personally_removed/i);
  assert.match(sql, /source_sale_id/i);
  assert.match(sql, /status = 'voided'/i);
  assert.match(sql, /status = 'corrected'/i);
  assert.match(sql, /record_vehicle_sale_atomic/i);
  assert.match(sql, /grant execute on function void_vehicle_sale_atomic/i);
  assert.match(sql, /grant execute on function correct_vehicle_sale_atomic/i);

  assert.match(calculations, /function isActiveSale/i);
  assert.match(marketSnapApi, /\.is\("voided_at", null\)/i);
  assert.match(marketSnapApi, /\.eq\("status", "active"\)/i);
  assert.match(repository, /rpc\("void_vehicle_sale_atomic"/i);
  assert.match(repository, /rpc\("correct_vehicle_sale_atomic"/i);
});

test("dashboard metrics use sold and in-stock vehicle status", () => {
  const sale: Sale = {
    id: "sale-1",
    organizationId: "org-1",
    vehicleId: "vehicle-1",
    saleDate: "2026-01-11",
    vehicleTotalCost: 10000,
    taxableProfitAmount: 1000,
    profitTaxDue: 220,
    paperSalePrice: 11000,
    realClientPayment: 11500,
    externalCommission: 500,
    createdAt: "2026-01-11",
    createdBy: "user-1",
  };
  const metrics = calculateDashboardMetrics({
    vehicles: [vehicle],
    expenses: [],
    sales: [sale],
    companyCashTransactions: [],
    externalCashTransactions: [],
  });
  assert.equal(metrics.vehiclesSold, 1);
  assert.equal(metrics.netProfit, 780);
  assert.equal(metrics.averageTimeToSell, 10);
});

test("vehicle status transitions allow only the active inventory path", () => {
  assert.deepEqual(getAllowedVehicleStatusTransitions("purchased"), ["in_repair"]);
  assert.deepEqual(getAllowedVehicleStatusTransitions("in_repair"), ["listed_for_sale"]);
  assert.deepEqual(getAllowedVehicleStatusTransitions("listed_for_sale"), []);
  assert.deepEqual(getAllowedVehicleStatusTransitions("sold"), []);

  assert.equal(vehicleAnyUpdateSchema.safeParse({
    updateMode: "status",
    status: "in_repair",
    reason: "Moved to the shop",
  }).success, true);
  assert.equal(vehicleAnyUpdateSchema.safeParse({
    updateMode: "status",
    status: "sold",
  }).success, true);
});

test("vehicle purchase correction validation requires auditable financial inputs", () => {
  assert.equal(vehicleAnyUpdateSchema.safeParse({
    updateMode: "purchase",
    purchasePrice: 12000,
    purchaseDate: "2026-03-15",
    purchaseSource: "OpenLane",
    reason: "Corrected auction invoice",
  }).success, true);
  assert.equal(vehicleAnyUpdateSchema.safeParse({
    updateMode: "purchase",
    purchasePrice: 12000,
    purchaseDate: "2026-03-15",
    purchaseSource: "OpenLane",
    reason: "",
  }).success, false);
});

test("vehicle financial correction migration is atomic and blocks sold vehicles", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260517_vehicle_financial_corrections.sql"), "utf8");
  const repository = readFileSync(join(process.cwd(), "src/lib/supabase/repository.ts"), "utf8");

  assert.match(sql, /create table if not exists vehicle_corrections/i);
  assert.match(sql, /create or replace function transition_vehicle_status/i);
  assert.match(sql, /create or replace function correct_vehicle_purchase/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /vehicle_record\.status = 'purchased'::vehicle_status and p_next_status = 'in_repair'::vehicle_status/i);
  assert.match(sql, /vehicle_record\.status = 'in_repair'::vehicle_status and p_next_status = 'listed_for_sale'::vehicle_status/i);
  assert.match(sql, /Record sales through the sale workflow/i);
  assert.match(sql, /Sold vehicle purchase details require the sale correction workflow/i);
  assert.match(sql, /calculate_purchase_tax_rate\(p_purchase_source\)/i);
  assert.match(sql, /organization_company_cash_balance\(p_organization_id\) \+ old_cash_impact/i);
  assert.match(sql, /update vehicle_expenses/i);
  assert.match(sql, /update company_cash_transactions/i);
  assert.match(sql, /vehicle_purchase_corrected/i);
  assert.match(sql, /grant execute on function correct_vehicle_purchase/i);

  assert.match(repository, /rpc\("correct_vehicle_purchase"/i);
  assert.match(repository, /rpc\("transition_vehicle_status"/i);
  const updateVehicleBody = repository.slice(repository.indexOf("export async function updateVehicle"));
  assert.doesNotMatch(updateVehicleBody, /\bpurchase_price:/);
});

test("backup export includes required restorable files", async () => {
  const backup = await generateBackupExport({
    ...emptyAppData,
    activeOrganizationId: "org-1",
    vehicles: [vehicle],
  });
  const verification = await verifyBackupExport(backup);
  const zip = await JSZip.loadAsync(await backup.arrayBuffer());
  const pdfHeader = (await zip.file("summary.pdf")!.async("text")).slice(0, 8);

  assert.equal(verification.ok, true);
  assert.deepEqual(verification.missing, []);
  assert.equal(pdfHeader, "%PDF-1.4");
});

test("backup verifier rejects invalid ZIP structure", async () => {
  const zip = new JSZip();
  zip.file("full-backup.json", JSON.stringify({ activeOrganizationId: "org-1" }));
  const invalidBackup = await zip.generateAsync({ type: "blob" });
  const verification = await verifyBackupExport(invalidBackup);

  assert.equal(verification.ok, false);
  assert.equal(verification.invalid, true);
  assert.ok(verification.missing.includes("backup-manifest.json"));
});

test("restore dry-run parses backup counts without writing data", async () => {
  const backup = await generateBackupExport({
    ...emptyAppData,
    activeOrganizationId: "org-1",
    vehicles: [vehicle],
    expenses: [
      {
        id: "expense-1",
        organizationId: "org-1",
        vehicleId: "vehicle-1",
        category: "repair",
        amountBeforeTax: 100,
        taxRate: 0.15,
        taxAmount: 15,
        totalAmount: 115,
        date: "2026-01-02",
        createdAt: "2026-01-02",
        createdBy: "user-1",
      },
    ],
  });
  const dryRun = await restoreBackupDryRun(backup);

  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.summary?.vehicles, 1);
  assert.equal(dryRun.summary?.expenses, 1);
  assert.deepEqual(dryRun.conflicts, []);
});

test("security helpers restrict full backup roles", () => {
  assert.equal(canManageBackups("owner"), true);
  assert.equal(canManageBackups("admin"), true);
  assert.equal(canManageBackups("accountant"), false);
  assert.equal(canManageBackups("viewer"), false);
});

test("tax export roles are limited to owner, admin, and accountant", () => {
  assert.equal(canExportTaxReports("owner"), true);
  assert.equal(canExportTaxReports("admin"), true);
  assert.equal(canExportTaxReports("accountant"), true);
  assert.equal(canExportTaxReports("member"), false);
  assert.equal(canExportTaxReports("viewer"), false);
});

test("server origin checks reject unsafe cross-origin mutations", () => {
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://localhost:3000/api/mutations", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
  })));
  assert.throws(
    () => assertSameOrigin(new Request("http://localhost:3000/api/mutations", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    })),
    RouteSecurityError,
  );
});

test("rate limiter blocks repeated abuse by IP and by user", async () => {
  resetRateLimitForTests();
  const request = new Request("http://localhost:3000/api/vin", {
    headers: { "x-forwarded-for": "203.0.113.10" },
  });
  await assert.doesNotReject(() => checkRateLimit(request, "test-bucket", { limit: 2, windowMs: 60_000 }));
  await assert.doesNotReject(() => checkRateLimit(request, "test-bucket", { limit: 2, windowMs: 60_000 }));
  await assert.rejects(() => checkRateLimit(request, "test-bucket", { limit: 2, windowMs: 60_000 }), RouteSecurityError);

  resetRateLimitForTests();
  await assert.doesNotReject(() => checkRateLimit(request, "test-bucket", { limit: 1, windowMs: 60_000, userId: "user-a" }));
  await assert.doesNotReject(() => checkRateLimit(request, "test-bucket", { limit: 1, windowMs: 60_000, userId: "user-b" }));
  await assert.rejects(() => checkRateLimit(request, "test-bucket", { limit: 1, windowMs: 60_000, userId: "user-a" }), RouteSecurityError);

  resetRateLimitForTests();
  await assert.doesNotReject(() => checkRateLimit(request, "short-window", { limit: 1, windowMs: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.doesNotReject(() => checkRateLimit(request, "short-window", { limit: 1, windowMs: 1 }));
  resetRateLimitForTests();
});

test("persistent rate limiter requires Supabase config when enabled", async () => {
  const previousBackend = process.env.RATE_LIMIT_BACKEND;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  resetRateLimitForTests();
  process.env.RATE_LIMIT_BACKEND = "supabase";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  await assert.rejects(
    () => checkRateLimit(new Request("http://localhost:3000/api/vin"), "persistent-test", { limit: 1, windowMs: 60_000 }),
    (error: unknown) => error instanceof RouteSecurityError && error.status === 503,
  );
  if (previousBackend === undefined) delete process.env.RATE_LIMIT_BACKEND;
  else process.env.RATE_LIMIT_BACKEND = previousBackend;
  if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  if (previousAnon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnon;
  resetRateLimitForTests();
});

test("persistent rate limit migration uses an atomic Supabase bucket", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260520_persistent_rate_limiting.sql"), "utf8");
  const security = readFileSync(join(process.cwd(), "src/lib/server/security.ts"), "utf8");

  assert.match(sql, /create table if not exists rate_limit_buckets/i);
  assert.match(sql, /primary key \(bucket, identifier_hash\)/i);
  assert.match(sql, /create or replace function check_rate_limit/i);
  assert.match(sql, /on conflict \(bucket, identifier_hash\)/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /grant execute on function check_rate_limit/i);
  assert.match(security, /createHash\("sha256"\)/i);
  assert.match(security, /RATE_LIMIT_BACKEND/i);
});

test("high-risk mutation domains have dedicated route entrypoints", () => {
  const routes = [
    "src/app/api/vehicles/route.ts",
    "src/app/api/vehicles/[vehicleId]/route.ts",
    "src/app/api/vehicles/[vehicleId]/archive/route.ts",
    "src/app/api/vehicles/[vehicleId]/expenses/route.ts",
    "src/app/api/vehicles/[vehicleId]/expenses/[expenseId]/route.ts",
    "src/app/api/vehicles/[vehicleId]/sale/route.ts",
    "src/app/api/sales/[saleId]/void/route.ts",
    "src/app/api/sales/[saleId]/correct/route.ts",
    "src/app/api/cash/[account]/route.ts",
    "src/app/api/cash/[account]/[transactionId]/route.ts",
    "src/app/api/cash/[account]/[transactionId]/reverse/route.ts",
  ];
  for (const route of routes) {
    assert.equal(existsSync(join(process.cwd(), route)), true, `${route} should exist`);
  }
  const bridge = readFileSync(join(process.cwd(), "src/lib/server/mutation-route-bridge.ts"), "utf8");
  const mutations = readFileSync(join(process.cwd(), "src/features/app/mutations.ts"), "utf8");
  assert.match(bridge, /forwardDomainMutation/i);
  assert.match(bridge, /checkRateLimit/i);
  assert.match(mutations, /function mutationEndpoint/i);
  assert.match(mutations, /\/api\/vehicles\/\$\{vehicleId\}\/archive/i);
  assert.match(mutations, /\/api\/cash\/\$\{account\}\/\$\{transactionId\}\/reverse/i);
});

test("DealerFlowApp shell delegates app plumbing to feature modules", () => {
  const app = readFileSync(join(process.cwd(), "src/components/dealer-flow-app.tsx"), "utf8");
  assert.match(app, /@\/features\/app\/navigation/i);
  assert.match(app, /@\/features\/app\/permissions/i);
  assert.match(app, /@\/features\/app\/mutations/i);
  assert.equal(app.includes("function getRouteState"), false);
  assert.equal(app.includes("function mutationEndpoint"), false);
  assert.equal(existsSync(join(process.cwd(), "src/features/app/navigation.ts")), true);
  assert.equal(existsSync(join(process.cwd(), "src/features/app/permissions.ts")), true);
  assert.equal(existsSync(join(process.cwd(), "src/features/app/mutations.ts")), true);
});

test("backup and tax export request schemas reject invalid payloads", () => {
  assert.equal(backupRequestSchema.safeParse({ organizationId: "not-a-uuid" }).success, false);
  assert.equal(taxExportSchema.safeParse({
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    startDate: "2026-05-08",
    endDate: "2026-05-01",
    format: "pdf",
  }).success, false);
});

test("CSV export escapes formula injection", () => {
  assert.equal(sanitizeCsvCell("=cmd|' /C calc'!A0"), "\"'=cmd|' /C calc'!A0\"");
  assert.equal(sanitizeCsvCell("+SUM(A1:A2)"), "\"'+SUM(A1:A2)\"");
});

test("tax report exports produce real PDF, CSV, and JSON", async () => {
  const data = {
    ...emptyAppData,
    activeOrganizationId: "org-1",
    vehicles: [
      {
        ...vehicle,
        id: "old-vehicle",
        purchasePrice: 9000,
        purchaseDate: "2026-04-15",
      },
    ],
    expenses: [
      {
        id: "expense-1",
        organizationId: "org-1",
        vehicleId: "old-vehicle",
        category: "repair",
        amountBeforeTax: 100,
        taxRate: 0.15,
        taxAmount: 15,
        totalAmount: 115,
        fundingSource: "company_cash",
        date: "2026-05-10",
        createdAt: "2026-05-10",
        createdBy: "user-1",
      },
    ],
    sales: [
      {
        id: "sale-1",
        organizationId: "org-1",
        vehicleId: "vehicle-1",
        saleDate: "2026-05-01",
        vehicleTotalCost: 10000,
        taxableProfitAmount: 1000,
        profitTaxDue: 220,
        paperSalePrice: 11000,
        realClientPayment: 11500,
        externalCommission: 500,
        createdAt: "2026-05-01",
        createdBy: "user-1",
      },
    ],
  };
  const pdf = await generateTaxReportExport(data, { format: "pdf", startDate: "2026-05-01", endDate: "2026-05-31" });
  const csv = await generateTaxReportExport(data, { format: "csv", startDate: "2026-05-01", endDate: "2026-05-31" });
  const json = await generateTaxReportExport(data, { format: "json", startDate: "2026-05-01", endDate: "2026-05-31" });

  assert.equal((await pdf.text()).slice(0, 8), "%PDF-1.4");
  const csvText = await csv.text();
  const jsonReport = JSON.parse(await json.text()).report;
  assert.match(csvText, /These calculations are estimates/);
  assert.match(csvText, /vehiclePurchaseCosts/);
  assert.match(csvText, /"0"/);
  assert.equal(jsonReport.taxDue, 220);
  assert.equal(jsonReport.vehiclePurchaseCosts, 0);
  assert.equal(jsonReport.totalExpenses, 115);
});

test("upload validation rejects dangerous files and sanitizes names", () => {
  assert.equal(sanitizeStorageFileName("../driver license<script>.pdf"), "driver_license_script_.pdf");
  assert.throws(
    () => assertAllowedUpload(new File(["alert(1)"], "x.html", { type: "text/html" })),
    /not allowed/,
  );
  assert.doesNotThrow(() => assertAllowedUpload(new File(["pdf"], "invoice.pdf", { type: "application/pdf" })));
});

test("attachment links reject script URLs", () => {
  assert.equal(attachmentSchema.safeParse({
    type: "link",
    title: "bad",
    urlOrPath: "javascript:alert(1)",
  }).success, false);
  assert.equal(attachmentSchema.safeParse({
    type: "link",
    title: "good",
    urlOrPath: "https://example.com/invoice",
  }).success, true);
});

test("PWA manifest is installable and branded", () => {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "public/manifest.webmanifest"), "utf8")) as {
    name?: string;
    display?: string;
    theme_color?: string;
    icons?: Array<{ src?: string }>;
  };

  assert.equal(manifest.name, "Dealer Flow");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#0b1120");
  assert.ok(manifest.icons?.some((icon) => icon.src === "/icon.svg"));
  assert.equal(existsSync(join(process.cwd(), "public/icon.svg")), true);
});

test("activity log schema allows backup verification only", () => {
  assert.equal(activityLogSchema.safeParse({
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    action: "backup_verified",
    entityType: "backup",
    message: "Backup ZIP verified successfully.",
  }).success, true);
  assert.equal(activityLogSchema.safeParse({
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    action: "document_uploaded",
    entityType: "attachment",
    message: "not allowed through generic log route",
  }).success, false);
});

test("invitation regeneration schema requires an organization id", () => {
  assert.equal(regenerateInvitationSchema.safeParse({
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
  }).success, true);
  assert.equal(regenerateInvitationSchema.safeParse({ organizationId: "bad" }).success, false);
});

test("vehicle delete confirmation accepts DELETE or VIN case-insensitively", () => {
  assert.equal(isValidVehicleDeleteConfirmation("DELETE", "KM8JUCAC7AU031562"), true);
  assert.equal(isValidVehicleDeleteConfirmation(" delete ", "KM8JUCAC7AU031562"), true);
  assert.equal(isValidVehicleDeleteConfirmation("KM8JUCAC7AU031562", "KM8JUCAC7AU031562"), true);
  assert.equal(isValidVehicleDeleteConfirmation(" km8jucac7au031562 ", "KM8JUCAC7AU031562"), true);
  assert.equal(isValidVehicleDeleteConfirmation("wrong", "KM8JUCAC7AU031562"), false);
});

test("vehicle archive helpers hide archived inventory without removing audit data", () => {
  const activeVehicle = { ...vehicle, id: "active-vehicle", status: "listed_for_sale" as const };
  const archivedVehicle = {
    ...vehicle,
    id: "archived-vehicle",
    status: "listed_for_sale" as const,
    archivedAt: "2026-05-13T12:00:00.000Z",
  };
  const sale: Sale = {
    id: "sale-1",
    organizationId: "org-1",
    vehicleId: archivedVehicle.id,
    saleDate: "2026-05-13",
    vehicleTotalCost: 12000,
    taxableProfitAmount: 1000,
    profitTaxDue: 150,
    paperSalePrice: 13000,
    realClientPayment: 13500,
    externalCommission: 500,
    createdAt: "2026-05-13T12:00:00.000Z",
    createdBy: "user-1",
  };
  const expense: VehicleExpense = {
    id: "expense-1",
    organizationId: "org-1",
    vehicleId: archivedVehicle.id,
    category: "repair",
    amountBeforeTax: 500,
    taxRate: 0,
    taxAmount: 0,
    totalAmount: 500,
    fundingSource: "company_cash",
    date: "2026-05-12",
    createdAt: "2026-05-12T12:00:00.000Z",
    createdBy: "user-1",
  };
  const companyCashTransaction: CompanyCashTransaction = {
    id: "cash-1",
    organizationId: "org-1",
    type: "vehicle_cost_paid",
    amount: 500,
    date: "2026-05-12",
    sourceVehicleId: archivedVehicle.id,
    sourceExpenseId: expense.id,
    createdAt: "2026-05-12T12:00:00.000Z",
    createdBy: "user-1",
  };

  assert.deepEqual(activeVehiclesOnly([activeVehicle, archivedVehicle]).map((item) => item.id), [activeVehicle.id]);

  const metrics = calculateDashboardMetrics({
    vehicles: [activeVehicle, archivedVehicle],
    expenses: [expense],
    sales: [sale],
    companyCashTransactions: [companyCashTransaction],
    externalCashTransactions: [],
  });

  assert.equal(metrics.vehiclesInStock, 1);
  assert.equal(metrics.inventoryValue, activeVehicle.purchasePrice);
  assert.equal(sale.vehicleId, archivedVehicle.id);
  assert.equal(expense.vehicleId, archivedVehicle.id);
  assert.equal(companyCashTransaction.sourceVehicleId, archivedVehicle.id);
});

test("vehicle archive migration adds safe RPC and disables destructive hard delete", () => {
  const archiveSql = readFileSync(join(process.cwd(), "supabase/migrations/20260513_vehicle_archive.sql"), "utf8");

  assert.match(archiveSql, /add column if not exists archived_at timestamptz/i);
  assert.match(archiveSql, /add column if not exists archived_by uuid references profiles\(id\)/i);
  assert.match(archiveSql, /add column if not exists archive_reason text/i);
  assert.match(archiveSql, /create or replace function archive_vehicle\(\s*p_organization_id uuid,\s*p_vehicle_id uuid,\s*p_reason text default null\s*\)/i);
  assert.match(archiveSql, /for update/i);
  assert.match(archiveSql, /has_org_role\(p_organization_id, array\['owner','admin'\]::app_role\[\]\)/i);
  assert.match(archiveSql, /update vehicles\s+set archived_at = now\(\)/i);
  assert.match(archiveSql, /'vehicle_archived'/i);
  assert.match(archiveSql, /delete_vehicle_and_related_data is deprecated/i);
  assert.doesNotMatch(archiveSql, /delete from (tax_reports|attachments|company_cash_transactions|external_cash_transactions|sales|vehicle_expenses|activity_logs|vehicles)/i);
});

test("vehicle archive fields map from Supabase rows", () => {
  const mapped = mapVehicle({
    id: "vehicle-1",
    organization_id: "org-1",
    vin: "VIN",
    purchase_price: 10000,
    purchase_date: "2026-01-01",
    purchase_source: "OpenLane",
    status: "purchased",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: "user-1",
    archived_at: "2026-05-13T12:00:00.000Z",
    archived_by: "admin-1",
    archive_reason: "Duplicate unit",
  });

  assert.equal(mapped.archivedAt, "2026-05-13T12:00:00.000Z");
  assert.equal(mapped.archivedBy, "admin-1");
  assert.equal(mapped.archiveReason, "Duplicate unit");
});

test("P0 migration adds atomic vehicle and sale RPCs", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260508_p0_atomic_security.sql"), "utf8");

  assert.match(sql, /create or replace function create_vehicle_with_defaults/i);
  assert.match(sql, /create or replace function record_vehicle_sale_atomic/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /return new_vehicle_id/i);
  assert.match(sql, /return sale_id/i);
});

test("purchase tax consistency migration makes SQL source-aware", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260514_purchase_tax_consistency.sql"), "utf8");

  assert.match(sql, /create or replace function calculate_purchase_tax_rate\(p_purchase_source purchase_source\)/i);
  assert.match(sql, /when p_purchase_source = 'OpenLane'::purchase_source then 0\.05::numeric/i);
  assert.match(sql, /else 0::numeric/i);
  assert.match(sql, /purchase_tax_rate := calculate_purchase_tax_rate\(purchase_source\)/i);
  assert.match(sql, /tax_rate,\s*tax_amount,\s*total_amount/i);
  assert.match(sql, /purchase_tax_rate,\s*purchase_tax,\s*purchase_total/i);
  assert.doesNotMatch(sql, /p_purchase_price \* 0\.05/i);
  assert.doesNotMatch(sql, /'Automatic 5% purchase tax'/i);
});

test("atomic expense migration moves expense and cash impact into RPCs", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260515_atomic_expense_cash_impact.sql"), "utf8");
  const repository = readFileSync(join(process.cwd(), "src/lib/supabase/repository.ts"), "utf8");

  assert.match(sql, /create or replace function create_vehicle_expense_with_cash_impact/i);
  assert.match(sql, /create or replace function update_vehicle_expense_with_cash_impact/i);
  assert.match(sql, /from organizations\s+where id = p_organization_id\s+for update/i);
  assert.match(sql, /from vehicles[\s\S]+for update/i);
  assert.match(sql, /from vehicle_expenses[\s\S]+for update/i);
  assert.match(sql, /organization_company_cash_balance\(p_organization_id\)/i);
  assert.match(sql, /organization_external_cash_balance\(p_organization_id\)/i);
  assert.match(sql, /insert into vehicle_expenses/i);
  assert.match(sql, /insert into company_cash_transactions/i);
  assert.match(sql, /insert into external_cash_transactions/i);
  assert.match(sql, /update vehicle_expenses/i);
  assert.match(sql, /update company_cash_transactions/i);
  assert.match(sql, /update external_cash_transactions/i);
  assert.match(sql, /grant execute on function create_vehicle_expense_with_cash_impact/i);
  assert.match(sql, /grant execute on function update_vehicle_expense_with_cash_impact/i);

  assert.match(repository, /rpc\("create_vehicle_expense_with_cash_impact"/i);
  assert.match(repository, /rpc\("update_vehicle_expense_with_cash_impact"/i);
  assert.doesNotMatch(repository, /createExpenseWithCashImpact|insertExpenseCashImpact|updateExpenseCashImpact|assertFundingSourceBalance/);
  assert.doesNotMatch(repository, /\.from\("vehicle_expenses"\)\.insert/);
  assert.doesNotMatch(repository, /\.from\("vehicle_expenses"\)\.update/);
});

test("recurring expense migration replaces hardcoded plate commission with templates", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260509_recurring_expenses_funding_source.sql"), "utf8");
  const p0Sql = readFileSync(join(process.cwd(), "supabase/migrations/20260508_p0_atomic_security.sql"), "utf8");

  assert.match(sql, /create table if not exists recurring_vehicle_expense_templates/i);
  assert.match(sql, /funding_source text not null default 'company_cash'/i);
  assert.match(sql, /external_vehicle_expense_paid/i);
  assert.match(sql, /auto_apply_to_new_vehicles = true/i);
  assert.doesNotMatch(p0Sql, /Automatic non-taxable Commission Plaque fee/i);
});

test("P0 migration protects sensitive files and final owner", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260508_p0_atomic_security.sql"), "utf8");

  assert.match(sql, /assert_final_owner_preserved/i);
  assert.match(sql, /organization_memberships_final_owner/i);
  assert.match(sql, /drop policy if exists "read attachments"/i);
  assert.match(sql, /is_sensitive = false/i);
  assert.match(sql, /operational roles read private organization files/i);
  assert.match(sql, /array\['owner','admin','member'\]::app_role\[\]/i);
});

test("Market Snap production hardening restricts retention cleanup and model version writes", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260512_market_snap_production_hardening.sql"), "utf8");

  assert.match(sql, /revoke execute on function cleanup_market_snap_retention\(\) from authenticated/i);
  assert.match(sql, /grant execute on function cleanup_market_snap_retention\(\) to service_role/i);
  assert.match(sql, /drop policy if exists "admins manage model versions"/i);
  assert.match(sql, /auth\.role\(\) = 'service_role'/i);
});
