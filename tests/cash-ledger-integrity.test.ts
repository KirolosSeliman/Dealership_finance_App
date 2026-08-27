import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { calculateCompanyCashBalance, calculateExternalCashBalance } from "../src/lib/domain/calculations";
import { deleteCashTransaction, updateCashTransaction } from "../src/lib/supabase/repository";

const repoRoot = process.cwd();
const migrationPath = join(repoRoot, "supabase/migrations/20260829_cash_ledger_reversal_hardening.sql");
const migrationSource = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

function createMockClient(rows: Record<string, Record<string, unknown> | null> = {}) {
  const calls: { rpc: Array<{ name: string; args: Record<string, unknown> }>; updates: string[] } = { rpc: [], updates: [] };
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
        update() {
          calls.updates.push(table);
          return query;
        },
        then(resolve: (value: { error: null }) => unknown) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return query;
    },
  };
  return { client, calls };
}

test("cash hardening migration removes direct ledger updates and defines atomic manual edit RPCs", () => {
  assert.match(migrationSource, /drop policy if exists "update company cash"/i);
  assert.match(migrationSource, /drop policy if exists "update company expense cash impact"/i);
  assert.match(migrationSource, /drop policy if exists "update external cash"/i);
  assert.match(migrationSource, /drop policy if exists "update external expense cash impact"/i);
  assert.match(migrationSource, /create or replace function update_manual_company_cash_transaction/i);
  assert.match(migrationSource, /create or replace function update_manual_external_cash_transaction/i);
  assert.match(migrationSource, /organization_company_cash_balance\(p_organization_id\)/i);
  assert.match(migrationSource, /organization_external_cash_balance\(p_organization_id\)/i);
  assert.match(migrationSource, /original\.source_vehicle_id is not null[\s\S]+original\.source_expense_id is not null[\s\S]+original\.source_sale_id is not null/i);
  assert.match(migrationSource, /correction_of_transaction_id is not null/i);
  assert.match(migrationSource, /reversed_transaction_id is not null/i);
  assert.match(migrationSource, /voided_at is not null/i);
  assert.doesNotMatch(migrationSource, /delete\s+from\s+(?:company|external)_cash_transactions/i);
});

test("cash hardening migration prevents generic reversal of sale-linked rows", () => {
  assert.match(migrationSource, /prevent_unlinked_system_cash_reversal/i);
  assert.match(migrationSource, /source_sale_id is not null/i);
  assert.match(migrationSource, /correction_of_transaction_id = old\.id/i);
  assert.match(migrationSource, /source_sale_id is not null[\s\S]+raise exception/i);
});

test("repository routes manual cash edits through account-specific atomic RPCs", async () => {
  for (const account of ["company", "external"] as const) {
    const table = account === "company" ? "company_cash_transactions" : "external_cash_transactions";
    const { client, calls } = createMockClient({
      [table]: {
        id: "tx-1",
        transfer_pair_id: null,
        source_vehicle_id: null,
        source_expense_id: null,
        source_sale_id: null,
        correction_of_transaction_id: null,
        reversed_transaction_id: null,
        voided_at: null,
        deleted_at: null,
      },
    });
    const form = new FormData();
    form.set("amount", "125.50");
    form.set("date", "2026-08-29");
    form.set("note", "Corrected amount");
    await updateCashTransaction(client as never, "org-1", account, "tx-1", form);
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.rpc[0]?.name, `update_manual_${account}_cash_transaction`);
    assert.equal(calls.rpc[0]?.args.p_amount, 125.5);
    assert.equal(calls.rpc[0]?.args.p_date, "2026-08-29");
  }
});

test("repository blocks direct reverse and edit attempts for system-linked cash rows", async () => {
  const systemRow = {
    id: "tx-1",
    type: "paper_sale_received",
    transfer_pair_id: null,
    source_vehicle_id: null,
    source_expense_id: null,
    source_sale_id: "sale-1",
    correction_of_transaction_id: null,
    reversed_transaction_id: null,
    voided_at: null,
    deleted_at: null,
  };
  const reverseClient = createMockClient({ company_cash_transactions: systemRow });
  await assert.rejects(
    () => deleteCashTransaction(reverseClient.client as never, "org-1", "company", "tx-1", "Wrong sale"),
    /system-generated cash transactions must be corrected through the vehicle or sale workflow/i,
  );
  assert.equal(reverseClient.calls.rpc.length, 0);

  const editClient = createMockClient({ company_cash_transactions: systemRow });
  const form = new FormData();
  form.set("amount", "10");
  form.set("date", "2026-08-29");
  await assert.rejects(
    () => updateCashTransaction(editClient.client as never, "org-1", "company", "tx-1", form),
    /system-generated cash transactions cannot be edited/i,
  );
  assert.equal(editClient.calls.rpc.length, 0);
});

test("cash balance remains deterministic when original entries stay beside reversals", () => {
  assert.equal(calculateCompanyCashBalance([
    { id: "a", organizationId: "org-1", type: "company_cash_added", amount: 100, date: "2026-08-29", createdAt: "2026-08-29", createdBy: "user-1" },
    { id: "b", organizationId: "org-1", type: "company_cash_withdrawn", amount: 30, date: "2026-08-29", createdAt: "2026-08-29", createdBy: "user-1", correctionOfTransactionId: "a", voidedAt: "2026-08-29" },
  ]), 70);
  assert.equal(calculateExternalCashBalance([
    { id: "a", organizationId: "org-1", type: "external_commission_earned", amount: 100, date: "2026-08-29", createdAt: "2026-08-29", createdBy: "user-1" },
    { id: "b", organizationId: "org-1", type: "external_cash_personally_removed", amount: 100, date: "2026-08-29", createdAt: "2026-08-29", createdBy: "user-1", correctionOfTransactionId: "a", voidedAt: "2026-08-29" },
  ]), 0);
});

test("API and ledger UI carry the system-generated and reversal protections", () => {
  const route = readFileSync(join(repoRoot, "src/lib/server/domain-mutation-handlers.ts"), "utf8");
  const repository = readFileSync(join(repoRoot, "src/lib/supabase/repository.ts"), "utf8");
  const component = readFileSync(join(repoRoot, "src/features/app/feature-views.tsx"), "utf8");
  const ledger = component.slice(component.indexOf("function CashLedger"), component.indexOf("function CashActionForm"));
  assert.match(route, /sourceSaleId/);
  assert.match(route, /system-generated cash transactions cannot be edited/i);
  assert.match(repository, /source_vehicle_id,source_expense_id,source_sale_id/);
  assert.match(repository, /update_manual_company_cash_transaction/);
  assert.match(repository, /update_manual_external_cash_transaction/);
  assert.match(component, /sourceVehicleId/);
  assert.match(component, /sourceExpenseId/);
  assert.match(component, /sourceSaleId/);
  assert.match(ledger, /reversedTransactionId/);
  assert.match(ledger, /voidedAt/);
});
