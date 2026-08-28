import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  calculateAccountingV2SaleBreakdown,
  calculateCompanyCashBalance,
  calculateExternalCashBalance,
  calculateExternalVehicleCost,
  calculatePendingRecoverableCompanyTax,
  calculateVehicleCompanyCostBasis,
  calculateVehicleCompanyGrossCashInvested,
} from "../src/lib/domain/calculations";
import { generateTaxReportExport } from "../src/lib/backup/export";
import { emptyAppData, mapSale } from "../src/lib/supabase/mappers";
import { saleSchema, vehiclePurchaseCorrectionSchema, vehicleV2Schema, vehicleSchema } from "../src/lib/validation";
import type { CompanyCashTransaction, ExternalCashTransaction, Vehicle, VehicleExpense } from "../src/types/domain";

const vehicle: Vehicle = {
  id: "vehicle-v2",
  organizationId: "org-v2",
  vin: "1HGCM82633A004352",
  purchasePrice: 1900,
  purchaseDate: "2026-08-28",
  purchaseSource: "other",
  status: "listed_for_sale",
  accountingModelVersion: 2,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  createdBy: "user-v2",
};

function expense(
  id: string,
  category: VehicleExpense["category"],
  amountBeforeTax: number,
  taxRate: number,
  fundingSource: VehicleExpense["fundingSource"] = "company_cash",
): VehicleExpense {
  const taxAmount = Math.round(amountBeforeTax * taxRate * 100) / 100;
  return {
    id,
    organizationId: vehicle.organizationId,
    vehicleId: vehicle.id,
    category,
    amountBeforeTax,
    taxRate,
    taxAmount,
    totalAmount: Math.round((amountBeforeTax + taxAmount) * 100) / 100,
    fundingSource,
    date: "2026-08-28",
    createdAt: "2026-08-28T00:00:00.000Z",
    createdBy: "user-v2",
  };
}

const expenses = [
  expense("purchase", "vehicle_purchase_price", 1900, 0.13),
  expense("fees", "auction_fee", 165, 0.15),
  expense("transport", "transport", 125, 0.15),
  expense("carfax", "other", 46.55, 0.15),
  expense("inspection", "inspection", 220, 0.15),
  expense("external-repair", "repair", 910, 0, "external_cash"),
];

test("Accounting V2 canonical example separates basis, gross cash, recoverable tax, and external cost", () => {
  assert.equal(calculateVehicleCompanyCostBasis(vehicle, expenses), 2456.55);
  assert.equal(calculateVehicleCompanyGrossCashInvested(vehicle, expenses), 2787.03);
  assert.equal(calculatePendingRecoverableCompanyTax(vehicle, expenses), 330.48);
  assert.equal(calculateExternalVehicleCost(vehicle, expenses), 910);
});

test("Accounting V2 sale calculation matches the canonical all-company and split routes", () => {
  const allCompany = calculateAccountingV2SaleBreakdown({
    vehicle,
    expenses,
    salePriceBeforeTax: 6300,
    salesTaxRate: 0.05,
    companyPaymentAmount: 6615,
    externalPaymentAmount: 0,
  });
  const split = calculateAccountingV2SaleBreakdown({
    vehicle,
    expenses,
    salePriceBeforeTax: 6300,
    salesTaxRate: 0.05,
    companyPaymentAmount: 5000,
    externalPaymentAmount: 1615,
  });

  assert.deepEqual(allCompany, {
    salePriceBeforeTax: 6300,
    salesTaxRate: 0.05,
    salesTaxAmount: 315,
    customerTotal: 6615,
    companyPaymentAmount: 6615,
    externalPaymentAmount: 0,
    companyCostBasis: 2456.55,
    companyGrossCashInvested: 2787.03,
    recoverableCompanyTax: 330.48,
    taxSettlementAmount: 15.48,
    profitTaxRate: 0.22,
    grossProfit: 3843.45,
    externalVehicleCost: 910,
    profitTaxDue: 845.56,
    trackedNetProfit: 2087.89,
  });
  assert.equal(split.companyPaymentAmount, 5000);
  assert.equal(split.externalPaymentAmount, 1615);
  assert.equal(split.trackedNetProfit, allCompany.trackedNetProfit);
  assert.equal(split.taxSettlementAmount, allCompany.taxSettlementAmount);
  assert.equal(split.profitTaxDue, allCompany.profitTaxDue);
});

test("Accounting V2 excludes external-funded tax from settlement and supports the 5% purchase variant", () => {
  const fivePercentExpenses = expenses.map((row) => row.id === "purchase" ? expense("purchase", "vehicle_purchase_price", 1900, 0.05) : row);
  assert.equal(calculateVehicleCompanyGrossCashInvested(vehicle, fivePercentExpenses), 2635.03);
  assert.equal(calculatePendingRecoverableCompanyTax(vehicle, fivePercentExpenses), 178.48);

  const breakdown = calculateAccountingV2SaleBreakdown({
    vehicle,
    expenses: fivePercentExpenses,
    salePriceBeforeTax: 6300,
    salesTaxRate: 0.05,
    companyPaymentAmount: 6615,
    externalPaymentAmount: 0,
  });
  assert.equal(breakdown.taxSettlementAmount, -136.52);
});

test("Accounting V2 never recovers tax paid from external cash", () => {
  const externallyTaxed = expenses.map((row) => row.id === "external-repair"
    ? expense("external-repair", "repair", 910, 0.15, "external_cash")
    : row);
  assert.equal(calculatePendingRecoverableCompanyTax(vehicle, externallyTaxed), 330.48);
  assert.equal(calculateExternalVehicleCost(vehicle, externallyTaxed), 1046.5);
});

test("Accounting V2 cash effects include tax settlement and profit tax with exact cent signs", () => {
  const company: CompanyCashTransaction[] = [
    { id: "start", organizationId: vehicle.organizationId, type: "company_cash_added", amount: 322, date: "2026-08-28", createdAt: "2026-08-28", createdBy: "user-v2" },
    { id: "sale", organizationId: vehicle.organizationId, type: "sale_payment_received", amount: 6615, date: "2026-08-28", createdAt: "2026-08-28", createdBy: "user-v2" },
    { id: "refund", organizationId: vehicle.organizationId, type: "vehicle_tax_refund_received", amount: 15.48, date: "2026-08-28", createdAt: "2026-08-28", createdBy: "user-v2" },
    { id: "profit-tax", organizationId: vehicle.organizationId, type: "profit_tax_paid", amount: 845.56, date: "2026-08-28", createdAt: "2026-08-28", createdBy: "user-v2" },
  ];
  const external: ExternalCashTransaction[] = [
    { id: "start", organizationId: vehicle.organizationId, type: "external_cash_added", amount: 0, date: "2026-08-28", createdAt: "2026-08-28", createdBy: "user-v2" },
    { id: "sale", organizationId: vehicle.organizationId, type: "external_sale_payment_received", amount: 1615, date: "2026-08-28", createdAt: "2026-08-28", createdBy: "user-v2" },
    { id: "repair", organizationId: vehicle.organizationId, type: "external_vehicle_expense_paid", amount: 910, date: "2026-08-28", createdAt: "2026-08-28", createdBy: "user-v2" },
  ];
  assert.equal(calculateCompanyCashBalance(company), 6106.92);
  assert.equal(calculateExternalCashBalance(external), 705);
});

test("Accounting V2 validation requires explicit purchase tax and exact payment routing", () => {
  assert.equal(vehicleSchema.safeParse({
    vin: "",
    purchasePrice: 1900,
    purchaseDate: "2026-08-28",
    purchaseSource: "other",
    purchaseTaxRate: 0.13,
    status: "purchased",
  }).success, true);
  assert.equal(vehicleV2Schema.safeParse({
    vin: "",
    purchasePrice: 1900,
    purchaseDate: "2026-08-28",
    purchaseSource: "OpenLane",
    status: "purchased",
  }).success, false);
  assert.equal(vehiclePurchaseCorrectionSchema.safeParse({
    updateMode: "purchase",
    purchasePrice: 1900,
    purchaseDate: "2026-08-28",
    purchaseSource: "other",
    purchaseTaxRate: 0.13,
    reason: "Corrected invoice tax rate",
  }).success, true);
  assert.equal(saleSchema.safeParse({
    saleDate: "2026-08-28",
    salePriceBeforeTax: 6300,
    salesTaxRate: 0.05,
    companyPaymentAmount: 6615,
    externalPaymentAmount: 0,
    buyerName: "Buyer",
  }).success, true);
  assert.equal(saleSchema.safeParse({
    salePriceBeforeTax: 6300,
    salesTaxRate: 0.05,
    companyPaymentAmount: 6614.99,
    externalPaymentAmount: 0,
    buyerName: "Buyer",
  }).success, false);
  assert.throws(() => calculateAccountingV2SaleBreakdown({
    vehicle,
    expenses,
    salePriceBeforeTax: 6300,
    salesTaxRate: 0.05,
    companyPaymentAmount: 6614.99,
    externalPaymentAmount: 0,
  }), /exactly|routing|customer total/i);
});

test("legacy sales map without fabricated V2 fields and V2 exports preserve the new fields", async () => {
  const legacy = mapSale({
    id: "legacy-sale",
    organization_id: vehicle.organizationId,
    vehicle_id: vehicle.id,
    sale_date: "2026-08-28",
    vehicle_total_cost: 2000,
    taxable_profit_amount: 1000,
    profit_tax_due: 220,
    paper_sale_price: 3000,
    real_client_payment: 3000,
    external_commission: 0,
    created_at: "2026-08-28T00:00:00.000Z",
    created_by: "user-v2",
  });
  assert.equal(legacy.accountingModelVersion, undefined);
  assert.equal(legacy.salePriceBeforeTax, undefined);

  const v2Sale = {
    ...legacy,
    id: "v2-sale",
    accountingModelVersion: 2 as const,
    salePriceBeforeTax: 6300,
    salesTaxRate: 0.05,
    salesTaxAmount: 315,
    customerTotal: 6615,
    companyPaymentAmount: 6615,
    externalPaymentAmount: 0,
    companyCostBasis: 2456.55,
    companyGrossCashInvested: 2787.03,
    recoverableCompanyTax: 330.48,
    taxSettlementAmount: 15.48,
    profitTaxRate: 0.22,
    grossProfit: 3843.45,
    externalVehicleCost: 910,
    trackedNetProfit: 2087.89,
  };
  const blob = await generateTaxReportExport({
    ...emptyAppData,
    activeOrganizationId: vehicle.organizationId,
    vehicles: [vehicle],
    expenses,
    sales: [v2Sale],
  }, { format: "json" });
  const exported = await blob.text();
  assert.match(exported, /totalSalePriceBeforeTax/);
  assert.match(exported, /totalTrackedNetProfit/);
});

test("legacy sales remain separate and V2 migration is additive", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260833_accounting_model_v2.sql"), "utf8");
  assert.match(migration, /add column if not exists accounting_model_version/i);
  assert.match(migration, /record_vehicle_sale_accounting_v2/i);
  assert.match(migration, /void_vehicle_sale_accounting_v2/i);
  assert.match(migration, /correct_vehicle_sale_accounting_v2/i);
  assert.match(migration, /sale_payment_received/i);
  assert.match(migration, /external_sale_payment_received/i);
  assert.match(migration, /correction_of_transaction_id/i);
  assert.match(migration, /grant execute on function record_vehicle_sale_accounting_v2[\s\S]+to authenticated/i);
  assert.match(migration, /company_original\.type[\s\S]+vehicle_tax_refund_received[\s\S]+vehicle_tax_payment_made/i);
  assert.match(migration, /expected_company[\s\S]+company_count/i);
  assert.doesNotMatch(migration, /delete\s+from\s+(sales|vehicle_expenses|company_cash_transactions|external_cash_transactions)/i);
});
