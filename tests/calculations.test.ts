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
  calculateSaleBreakdown,
  calculateVehicleTotalCost,
} from "../src/lib/domain/calculations";
import { generateBackupExport, generateTaxReportExport, restoreBackupDryRun, verifyBackupExport } from "../src/lib/backup/export";
import { assertAllowedUpload, canExportTaxReports, canManageBackups, sanitizeCsvCell, sanitizeStorageFileName } from "../src/lib/security";
import { assertSameOrigin, checkRateLimit, resetRateLimitForTests, RouteSecurityError } from "../src/lib/server/security";
import { activityLogSchema, attachmentSchema, backupRequestSchema, expenseSchema, recurringExpenseTemplateSchema, regenerateInvitationSchema, taxExportSchema } from "../src/lib/validation";
import { dedupeOrganizationsByHighestRole, emptyAppData, mapExpense } from "../src/lib/supabase/mappers";
import { isValidVehicleDeleteConfirmation } from "../src/lib/vehicle-delete";
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
    { id: "1", organizationId: "org-1", type: "external_commission_earned", amount: 700, date: "2026-01-01", createdAt: "2026-01-01", createdBy: "user-1" },
    { id: "2", organizationId: "org-1", type: "external_cash_transferred_to_company", amount: 200, date: "2026-01-02", createdAt: "2026-01-02", createdBy: "user-1" },
    { id: "3", organizationId: "org-1", type: "external_vehicle_expense_paid", amount: 50, date: "2026-01-03", createdAt: "2026-01-03", createdBy: "user-1" },
  ];
  assert.equal(calculateCompanyCashBalance(company), 4500);
  assert.equal(calculateExternalCashBalance(external), 450);
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

test("rate limiter blocks obvious repeated route abuse", () => {
  resetRateLimitForTests();
  const request = new Request("http://localhost:3000/api/vin", {
    headers: { "x-forwarded-for": "203.0.113.10" },
  });
  assert.doesNotThrow(() => checkRateLimit(request, "test-bucket", { limit: 2, windowMs: 60_000 }));
  assert.doesNotThrow(() => checkRateLimit(request, "test-bucket", { limit: 2, windowMs: 60_000 }));
  assert.throws(() => checkRateLimit(request, "test-bucket", { limit: 2, windowMs: 60_000 }), RouteSecurityError);
  resetRateLimitForTests();
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
  assert.match(await csv.text(), /These calculations are estimates/);
  assert.equal(JSON.parse(await json.text()).report.taxDue, 220);
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

test("vehicle cascade delete migration creates the exact RPC and preserves contacts", () => {
  const baseSql = readFileSync(join(process.cwd(), "supabase/migrations/20260510_delete_vehicle_cascade.sql"), "utf8");
  const hardeningSql = readFileSync(join(process.cwd(), "supabase/migrations/20260510_delete_vehicle_cascade_hardening.sql"), "utf8");

  assert.match(baseSql, /create or replace function delete_vehicle_and_related_data\(\s*p_organization_id uuid,\s*p_vehicle_id uuid\s*\)/i);
  assert.match(hardeningSql, /drop function if exists delete_vehicle_and_related_data\(uuid, uuid\)/i);
  assert.match(hardeningSql, /grant execute on function delete_vehicle_and_related_data\(uuid, uuid\) to authenticated/i);
  assert.match(hardeningSql, /delete from company_cash_transactions/i);
  assert.match(hardeningSql, /delete from external_cash_transactions/i);
  assert.match(hardeningSql, /delete from sales/i);
  assert.match(hardeningSql, /delete from vehicle_expenses/i);
  assert.match(hardeningSql, /delete from vehicles/i);
  assert.doesNotMatch(hardeningSql, /delete from contacts/i);
});

test("P0 migration adds atomic vehicle and sale RPCs", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260508_p0_atomic_security.sql"), "utf8");

  assert.match(sql, /create or replace function create_vehicle_with_defaults/i);
  assert.match(sql, /create or replace function record_vehicle_sale_atomic/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /return new_vehicle_id/i);
  assert.match(sql, /return sale_id/i);
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
