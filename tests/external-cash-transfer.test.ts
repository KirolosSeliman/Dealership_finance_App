import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  calculateCompanyCashBalance,
  calculateDashboardMetrics,
  calculateExternalCashBalance,
  generateTaxReport,
} from "../src/lib/domain/calculations";
import { EXTERNAL_CASH_TRANSACTION_TYPES } from "../src/lib/domain/constants";
import { deleteCashTransaction, createCashTransaction, updateCashTransaction } from "../src/lib/supabase/repository";
import { mapCompanyCashTransaction, mapExternalCashTransaction } from "../src/lib/supabase/mappers";
import type { CompanyCashTransaction, ExternalCashTransaction } from "../src/types/domain";

const migrationPath = join(process.cwd(), "supabase/migrations/20260823_atomic_external_cash_transfer.sql");
const migrationSource = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

function companyTransaction(
  id: string,
  type: CompanyCashTransaction["type"],
  amount: number,
  extra: Partial<CompanyCashTransaction> = {},
): CompanyCashTransaction {
  return {
    id,
    organizationId: "org-1",
    type,
    amount,
    date: "2026-08-23",
    createdAt: "2026-08-23T12:00:00.000Z",
    createdBy: "user-1",
    ...extra,
  };
}

function externalTransaction(
  id: string,
  type: ExternalCashTransaction["type"],
  amount: number,
  extra: Partial<ExternalCashTransaction> = {},
): ExternalCashTransaction {
  return {
    id,
    organizationId: "org-1",
    type,
    amount,
    date: "2026-08-23",
    createdAt: "2026-08-23T12:00:00.000Z",
    createdBy: "user-1",
    ...extra,
  };
}

function createMockClient(rows: Record<string, Record<string, unknown> | null> = {}) {
  const calls: { rpc: Array<{ name: string; args: Record<string, unknown> }>; inserts: Array<{ table: string; values: Record<string, unknown> }> } = {
    rpc: [],
    inserts: [],
  };

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1", email: "user@example.com", user_metadata: {} } }, error: null }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      return { data: null, error: null };
    },
    from(table: string) {
      const row = rows[table] ?? null;
      const query = {
        select() { return query; },
        eq() { return query; },
        is() { return query; },
        maybeSingle: async () => ({ data: row, error: null }),
        upsert: async () => ({ error: null }),
        insert: async (values: Record<string, unknown>) => {
          calls.inserts.push({ table, values });
          return { error: null };
        },
        update() { return query; },
        then(resolve: (value: { error: null }) => unknown) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return query;
    },
  };

  return { client, calls };
}

test("external transfer and reversal preserve the combined cash balance", () => {
  const beforeCompany = [companyTransaction("company-start", "company_cash_added", 8000)];
  const beforeExternal = [externalTransaction("external-start", "external_cash_added", 5000)];
  const afterTransferCompany = [...beforeCompany, companyTransaction("company-transfer", "external_transfer_received", 1500, { transferPairId: "pair-1" })];
  const afterTransferExternal = [...beforeExternal, externalTransaction("external-transfer", "external_cash_transferred_to_company", 1500, { transferPairId: "pair-1" })];
  const afterReversalCompany = [...afterTransferCompany, companyTransaction("company-reversal", "company_cash_withdrawn", 1500, { transferPairId: "reversal-1", correctionOfTransactionId: "company-transfer" })];
  const afterReversalExternal = [...afterTransferExternal, externalTransaction("external-reversal", "external_transfer_returned", 1500, { transferPairId: "reversal-1", correctionOfTransactionId: "external-transfer" })];

  assert.equal(calculateExternalCashBalance(afterTransferExternal), 3500);
  assert.equal(calculateCompanyCashBalance(afterTransferCompany), 9500);
  assert.equal(calculateExternalCashBalance(afterTransferExternal) + calculateCompanyCashBalance(afterTransferCompany), 13000);
  assert.equal(calculateExternalCashBalance(afterReversalExternal), 5000);
  assert.equal(calculateCompanyCashBalance(afterReversalCompany), 8000);
  assert.equal(calculateExternalCashBalance(afterReversalExternal) + calculateCompanyCashBalance(afterReversalCompany), 13000);
});

test("transfers and their reversals do not affect profit, tax, sales, or commission metrics", () => {
  const externalTransactions = [
    externalTransaction("added", "external_cash_added", 3000),
    externalTransaction("transfer", "external_cash_transferred_to_company", 1000, { transferPairId: "pair-1" }),
    externalTransaction("returned", "external_transfer_returned", 1000, { transferPairId: "pair-2", correctionOfTransactionId: "transfer" }),
  ];
  const companyTransactions = [
    companyTransaction("receipt", "external_transfer_received", 1000, { transferPairId: "pair-1" }),
    companyTransaction("withdrawal", "company_cash_withdrawn", 1000, { transferPairId: "pair-2", correctionOfTransactionId: "receipt" }),
  ];
  const metrics = calculateDashboardMetrics({ vehicles: [], expenses: [], sales: [], companyCashTransactions: companyTransactions, externalCashTransactions: externalTransactions });
  const report = generateTaxReport({ vehicles: [], expenses: [], sales: [], companyCashTransactions: companyTransactions, externalCashTransactions: externalTransactions, startDate: "2026-08-01", endDate: "2026-08-31" });

  assert.equal(metrics.netProfit, 0);
  assert.equal(metrics.externalCash, 3000);
  assert.equal(metrics.companyCash, 0);
  assert.equal(report.totalTaxableProfit, 0);
  assert.equal(report.taxDue, 0);
  assert.equal(report.totalCompanySales, 0);
  assert.equal(report.totalExternalCommission, 0);
});

test("external cash constants preserve all transaction types including transfer returns", () => {
  assert.deepEqual(EXTERNAL_CASH_TRANSACTION_TYPES, [
    "external_cash_added",
    "external_commission_earned",
    "external_cash_transferred_to_company",
    "external_transfer_returned",
    "external_cash_personally_removed",
    "external_vehicle_expense_paid",
    "external_vehicle_expense_refunded",
  ]);
});

test("cash mappers expose transfer_pair_id and map null to undefined", () => {
  const shared = { id: "tx-1", organization_id: "org-1", type: "company_cash_added", amount: 5, date: "2026-08-23", created_at: "2026-08-23T12:00:00.000Z", created_by: "user-1" };
  assert.equal(mapCompanyCashTransaction({ ...shared, transfer_pair_id: "pair-1" }).transferPairId, "pair-1");
  assert.equal(mapCompanyCashTransaction({ ...shared, transfer_pair_id: null }).transferPairId, undefined);
  assert.equal(mapExternalCashTransaction({ ...shared, type: "external_cash_added", transfer_pair_id: "pair-1" }).transferPairId, "pair-1");
  assert.equal(mapExternalCashTransaction({ ...shared, type: "external_cash_added", transfer_pair_id: null }).transferPairId, undefined);
});

test("atomic transfer migration defines the required creation RPC safeguards", () => {
  assert.match(migrationSource, /create or replace function transfer_external_cash_to_company/i);
  assert.match(migrationSource, /p_organization_id uuid,\s*p_amount numeric,\s*p_date date,\s*p_note text/i);
  assert.match(migrationSource, /auth\.uid\(\) is null/i);
  assert.match(migrationSource, /has_org_role\(p_organization_id, array\['owner','admin'\]/i);
  assert.match(migrationSource, /from organizations[\s\S]*for update/i);
  assert.match(migrationSource, /organization_external_cash_balance\(p_organization_id\)/i);
  assert.match(migrationSource, /gen_random_uuid\(\)/i);
  assert.match(migrationSource, /current_setting\('dealer_flow\.atomic_transfer_rpc', true\)/i);
  assert.match(migrationSource, /set_config\('dealer_flow\.atomic_transfer_rpc', 'on', true\)/i);
  assert.match(migrationSource, /external_cash_transferred_to_company/i);
  assert.match(migrationSource, /external_transfer_received/i);
  assert.match(migrationSource, /transfer_pair_id/i);
  assert.match(migrationSource, /insert into activity_logs/i);
  assert.match(migrationSource, /revoke execute on function transfer_external_cash_to_company/i);
  assert.match(migrationSource, /grant execute on function transfer_external_cash_to_company/i);
});

test("atomic transfer migration defines the required reversal RPC safeguards", () => {
  assert.match(migrationSource, /create or replace function reverse_external_cash_transfer_pair/i);
  assert.match(migrationSource, /organization_company_cash_balance\(p_organization_id\)/i);
  assert.match(migrationSource, /external_transfer_returned/i);
  assert.match(migrationSource, /company_cash_withdrawn/i);
  assert.match(migrationSource, /correction_of_transaction_id/i);
  assert.match(migrationSource, /reversed_transaction_id/i);
  assert.match(migrationSource, /voided_at/i);
  assert.match(migrationSource, /voided_by/i);
  assert.match(migrationSource, /void_reason/i);
  assert.match(migrationSource, /external_cash_transfer_reversed/i);
  assert.match(migrationSource, /revoke execute on function reverse_external_cash_transfer_pair/i);
  assert.match(migrationSource, /grant execute on function reverse_external_cash_transfer_pair/i);
});

test("atomic transfer migration preserves legacy rows and protects paired rows without destructive SQL", () => {
  assert.match(migrationSource, /add column if not exists transfer_pair_id uuid/i);
  assert.match(migrationSource, /company_cash_transfer_pair_unique_idx/i);
  assert.match(migrationSource, /external_cash_transfer_pair_unique_idx/i);
  assert.match(migrationSource, /external_transfer_returned/i);
  assert.match(migrationSource, /before insert/i);
  assert.match(migrationSource, /before update/i);
  assert.match(migrationSource, /transfer_pair_id is null/i);
  assert.doesNotMatch(migrationSource, /delete\s+from\s+(?:company|external)_cash_transactions/i);
  assert.doesNotMatch(migrationSource, /truncate/i);
  assert.doesNotMatch(migrationSource, /drop table/i);
});

test("repository routes transfer creation to one RPC and rejects system-generated manual types", async () => {
  const { client, calls } = createMockClient();
  await createCashTransaction(client as never, "org-1", "external_cash_transferred_to_company", 500, "Move cash", "2026-08-23");
  assert.equal(calls.rpc[0]?.name, "transfer_external_cash_to_company");
  assert.equal(calls.inserts.length, 0);
  await assert.rejects(
    () => createCashTransaction(client as never, "org-1", "external_transfer_received", 500, "fake", "2026-08-23"),
    /system-generated/i,
  );
  await assert.rejects(
    () => createCashTransaction(client as never, "org-1", "external_transfer_returned", 500, "fake", "2026-08-23"),
    /system-generated/i,
  );
});

test("repository routes both paired original ledgers to the paired reversal RPC", async () => {
  for (const [account, table, type] of [
    ["external", "external_cash_transactions", "external_cash_transferred_to_company"],
    ["company", "company_cash_transactions", "external_transfer_received"],
  ] as const) {
    const { client, calls } = createMockClient({
      [table]: { id: "tx-1", type, transfer_pair_id: "pair-1", correction_of_transaction_id: null, reversed_transaction_id: null, voided_at: null },
    });
    await deleteCashTransaction(client as never, "org-1", account, "tx-1", "Wrong amount");
    assert.equal(calls.rpc[0]?.name, "reverse_external_cash_transfer_pair");
    assert.equal(calls.rpc[0]?.args.p_transfer_pair_id, "pair-1");
  }
});

test("repository keeps legacy unpaired reversals on the existing generic path and rejects reversal rows", async () => {
  const legacy = createMockClient({ external_cash_transactions: { id: "legacy", type: "external_cash_transferred_to_company", transfer_pair_id: null, correction_of_transaction_id: null, reversed_transaction_id: null, voided_at: null } });
  await deleteCashTransaction(legacy.client as never, "org-1", "external", "legacy", "Legacy correction");
  assert.equal(legacy.calls.rpc[0]?.name, "reverse_external_cash_transaction");

  const reversal = createMockClient({ external_cash_transactions: { id: "reversal", type: "external_transfer_returned", transfer_pair_id: "pair-1", correction_of_transaction_id: "original", reversed_transaction_id: null, voided_at: null } });
  await assert.rejects(
    () => deleteCashTransaction(reversal.client as never, "org-1", "external", "reversal", "No"),
    /Transfer reversal entries cannot be reversed directly/i,
  );
  assert.equal(reversal.calls.rpc.length, 0);
});

test("repository refuses to edit paired transactions", async () => {
  const { client, calls } = createMockClient({
    external_cash_transactions: { id: "tx-1", transfer_pair_id: "pair-1" },
  });
  const form = new FormData();
  form.set("amount", "600");
  form.set("date", "2026-08-23");
  await assert.rejects(
    () => updateCashTransaction(client as never, "org-1", "external", "tx-1", form),
    /Paired external transfers cannot be edited directly/i,
  );
  assert.equal(calls.inserts.length, 0);
});

test("API and ledger UI include defense-in-depth pair protection", () => {
  const route = readFileSync(join(process.cwd(), "src/app/api/mutations/route.ts"), "utf8");
  const component = readFileSync(join(process.cwd(), "src/components/dealer-flow-app.tsx"), "utf8");
  const ledger = component.slice(component.indexOf("function CashLedger"), component.indexOf("function CashActionForm"));
  assert.match(route, /transferPairId/);
  assert.match(route, /Paired external transfers cannot be edited directly/i);
  assert.match(ledger, /transaction\.transferPairId/);
  assert.match(ledger, /transaction\.correctionOfTransactionId/);
  assert.match(ledger, /transaction\.reversedTransactionId/);
  assert.match(ledger, /Reverse transfer/);
  assert.match(ledger, /Edit/);
});
