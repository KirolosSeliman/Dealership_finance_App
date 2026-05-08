import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
  calculateCompanyCashBalance,
  calculateDashboardMetrics,
  calculateExpenseTax,
  calculateExternalCashBalance,
  calculateSaleBreakdown,
  calculateVehicleTotalCost,
} from "../src/lib/domain/calculations";
import { generateBackupExport, restoreBackupDryRun, verifyBackupExport } from "../src/lib/backup/export";
import { assertAllowedUpload, canManageBackups, sanitizeCsvCell, sanitizeStorageFileName } from "../src/lib/security";
import { attachmentSchema } from "../src/lib/validation";
import { emptyAppData } from "../src/lib/supabase/mappers";
import type {
  CompanyCashTransaction,
  ExternalCashTransaction,
  Sale,
  Vehicle,
  VehicleExpense,
} from "../src/types/domain";

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

test("OpenLane tax rules are applied", () => {
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
      purchaseSource: "OpenLane",
      category: "auction_fee",
      amountBeforeTax: 1000,
    }),
    { taxRate: 0.15, taxAmount: 150, totalAmount: 1150 },
  );
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
    { id: "1", organizationId: "org-1", type: "external_commission_earned", amount: 700, date: "2026-01-01", createdAt: "2026-01-01", createdBy: "user-1" },
    { id: "2", organizationId: "org-1", type: "external_cash_transferred_to_company", amount: 200, date: "2026-01-02", createdAt: "2026-01-02", createdBy: "user-1" },
  ];
  assert.equal(calculateCompanyCashBalance(company), 4500);
  assert.equal(calculateExternalCashBalance(external), 500);
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

test("CSV export escapes formula injection", () => {
  assert.equal(sanitizeCsvCell("=cmd|' /C calc'!A0"), "\"'=cmd|' /C calc'!A0\"");
  assert.equal(sanitizeCsvCell("+SUM(A1:A2)"), "\"'+SUM(A1:A2)\"");
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
