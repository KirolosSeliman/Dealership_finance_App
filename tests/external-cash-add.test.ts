import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { calculateDashboardMetrics, calculateExternalCashBalance, generateTaxReport } from "../src/lib/domain/calculations";
import { COMPANY_CASH_TRANSACTION_TYPES, EXTERNAL_CASH_TRANSACTION_TYPES } from "../src/lib/domain/constants";
import { mutationEndpoint } from "../src/features/app/mutations";
import { cashTransactionSchema } from "../src/lib/validation";
import type { ExternalCashTransaction } from "../src/types/domain";

const baseExternalTransaction = {
  organizationId: "org-1",
  date: "2026-08-21",
  createdAt: "2026-08-21T12:00:00.000Z",
  createdBy: "user-1",
};

function externalTransaction(
  id: string,
  type: string,
  amount: number,
  extra: Partial<ExternalCashTransaction> = {},
): ExternalCashTransaction {
  return {
    id,
    ...baseExternalTransaction,
    type,
    amount,
    ...extra,
  } as ExternalCashTransaction;
}

test("external cash transaction constants include manual additions and preserve existing types", () => {
  assert.deepEqual(EXTERNAL_CASH_TRANSACTION_TYPES, [
    "external_cash_added",
    "external_commission_earned",
    "external_cash_transferred_to_company",
    "external_cash_personally_removed",
    "external_vehicle_expense_paid",
  ]);
  assert.ok(COMPANY_CASH_TRANSACTION_TYPES.includes("company_cash_added"));
});

test("cash transaction validation accepts positive manual external cash and rejects zero or negative amounts", () => {
  assert.equal(cashTransactionSchema.safeParse({
    type: "external_cash_added",
    amount: 1000,
    date: "2026-08-21",
    note: "Starting external cash",
  }).success, true);
  assert.equal(cashTransactionSchema.safeParse({
    type: "external_cash_added",
    amount: 0,
    date: "2026-08-21",
  }).success, false);
  assert.equal(cashTransactionSchema.safeParse({
    type: "external_cash_added",
    amount: -1,
    date: "2026-08-21",
  }).success, false);
});

test("manual external cash routes through the external cash endpoint", () => {
  const externalForm = new FormData();
  externalForm.set("type", "external_cash_added");
  assert.deepEqual(mutationEndpoint("createCashTransaction", externalForm), {
    url: "/api/cash/external",
    method: "POST",
  });

  const companyForm = new FormData();
  companyForm.set("type", "company_cash_added");
  assert.deepEqual(mutationEndpoint("createCashTransaction", companyForm), {
    url: "/api/cash/company",
    method: "POST",
  });
});

test("external cash balance includes manual additions and subtracts transfers and personal removals", () => {
  assert.equal(calculateExternalCashBalance([
    externalTransaction("added", "external_cash_added", 2000),
    externalTransaction("transfer", "external_cash_transferred_to_company", 500),
    externalTransaction("removed", "external_cash_personally_removed", 100),
  ]), 1400);
});

test("external commission still increases external cash", () => {
  assert.equal(calculateExternalCashBalance([
    externalTransaction("commission", "external_commission_earned", 700),
  ]), 700);
});

test("external vehicle expense still decreases external cash", () => {
  assert.equal(calculateExternalCashBalance([
    externalTransaction("expense", "external_vehicle_expense_paid", 250),
  ]), -250);
});

test("deleted manual external cash does not contribute to the current balance", () => {
  assert.equal(calculateExternalCashBalance([
    externalTransaction("deleted", "external_cash_added", 1000, { deletedAt: "2026-08-22T12:00:00.000Z" }),
    externalTransaction("active", "external_cash_added", 250),
  ]), 250);
});

test("dashboard external cash increases without changing net profit", () => {
  const metrics = calculateDashboardMetrics({
    vehicles: [],
    expenses: [],
    sales: [],
    companyCashTransactions: [],
    externalCashTransactions: [externalTransaction("added", "external_cash_added", 3000)],
  });
  assert.equal(metrics.externalCash, 3000);
  assert.equal(metrics.companyCash, 0);
  assert.equal(metrics.netProfit, 0);
});

test("manual external cash is excluded from taxable report income", () => {
  const report = generateTaxReport({
    vehicles: [],
    expenses: [],
    sales: [],
    companyCashTransactions: [],
    externalCashTransactions: [externalTransaction("added", "external_cash_added", 3000)],
    startDate: "2026-08-01",
    endDate: "2026-08-31",
  });
  assert.equal(report.totalTaxableProfit, 0);
  assert.equal(report.taxDue, 0);
  assert.equal(report.totalCompanySales, 0);
  assert.equal(report.totalExternalCommission, 0);
  assert.equal(report.netProfitAfterTax, 0);
});

test("manual external cash migration expands only the external cash type constraint", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260821_external_cash_manual_add.sql"), "utf8");
  assert.match(sql, /external_cash_type_valid/i);
  for (const type of [
    "external_cash_added",
    "external_commission_earned",
    "external_cash_transferred_to_company",
    "external_cash_personally_removed",
    "external_vehicle_expense_paid",
  ]) {
    assert.match(sql, new RegExp(`'${type}'`));
  }
  assert.doesNotMatch(sql, /delete from/i);
  assert.doesNotMatch(sql, /truncate/i);
  assert.doesNotMatch(sql, /drop table/i);
});

test("cash management UI exposes manual external cash before existing actions", () => {
  const source = readFileSync(join(process.cwd(), "src/components/dealer-flow-app.tsx"), "utf8");
  const externalCard = source.slice(source.indexOf("function CashManagement"), source.indexOf("function CashLedger"));
  assert.match(externalCard, /t\.actions\.addExternalCash/);
  assert.match(externalCard, /type="external_cash_added"/);
  assert.match(externalCard, /type="external_cash_transferred_to_company"/);
  assert.match(externalCard, /type="external_cash_personally_removed"/);
  assert.match(externalCard, /mt-4 grid gap-3 xl:grid-cols-3/);
  assert.match(externalCard, /External cash added manually or earned from sales will appear here/);
});

test("manual external cash translations are available in English and French", () => {
  const en = JSON.parse(readFileSync(join(process.cwd(), "locales/en.json"), "utf8")) as { actions: { addExternalCash?: string } };
  const fr = JSON.parse(readFileSync(join(process.cwd(), "locales/fr.json"), "utf8")) as { actions: { addExternalCash?: string } };
  assert.equal(en.actions.addExternalCash, "Add external cash");
  assert.equal(fr.actions.addExternalCash, "Ajouter caisse externe");
});

test("repository records a distinct audit action for manual external cash", () => {
  const repository = readFileSync(join(process.cwd(), "src/lib/supabase/repository.ts"), "utf8");
  assert.match(repository, /if \(type === "external_cash_added"\) return "external_cash_added";/);
});
