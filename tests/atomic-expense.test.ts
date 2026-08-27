import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { expenseVoidSchema } from "../src/lib/validation";

const repoRoot = process.cwd();

function source(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

test("atomic expense migration preserves history while handling zero updates and voids", () => {
  const sql = source("supabase/migrations/20260828_atomic_expense_void.sql");

  assert.match(sql, /create or replace function create_vehicle_expense_with_cash_impact/i);
  assert.match(sql, /create or replace function update_vehicle_expense_with_cash_impact/i);
  assert.match(sql, /from organizations\s+where id = p_organization_id\s+for update/i);
  assert.match(sql, /from vehicles[\s\S]+for update/i);
  assert.match(sql, /from vehicle_expenses[\s\S]+for update/i);
  assert.match(sql, /if clean_total_amount = 0[\s\S]+set deleted_at = now\(\)/i);
  assert.doesNotMatch(sql, /set amount = coalesce\(p_total_amount, 0\)[\s\S]+where[\s\S]+p_total_amount, 0\) = 0/i);
  assert.match(sql, /create or replace function void_vehicle_expense_with_cash_reversal/i);
  assert.match(sql, /vehicle_cost_refunded/i);
  assert.match(sql, /external_vehicle_expense_refunded/i);
  assert.doesNotMatch(sql, /delete\s+from\s+vehicle_expenses/i);
});

test("expense repository uses only atomic RPCs for create, update, and void", () => {
  const repository = source("src/lib/supabase/repository.ts");
  const route = source("src/app/api/vehicles/[vehicleId]/expenses/[expenseId]/route.ts");
  const handler = source("src/lib/server/domain-mutation-handlers.ts");

  assert.match(repository, /rpc\("create_vehicle_expense_with_cash_impact"/i);
  assert.match(repository, /rpc\("update_vehicle_expense_with_cash_impact"/i);
  assert.match(repository, /rpc\("void_vehicle_expense_with_cash_reversal"/i);
  assert.match(route, /forwardDomainMutation\(request, "voidExpense"/i);
  assert.match(handler, /case "voidExpense"[\s\S]+expenseVoidSchema[\s\S]+voidVehicleExpense/i);
  assert.doesNotMatch(repository, /\.from\("vehicle_expenses"\)\.(insert|update|delete)/i);
  assert.doesNotMatch(repository, /\.from\("(?:company|external)_cash_transactions"\)\.update[\s\S]+source_expense_id/i);
});

test("voided expenses are excluded from domain cost and tax totals", () => {
  const calculations = source("src/lib/domain/calculations.ts");
  const mapper = source("src/lib/supabase/mappers.ts");

  assert.match(calculations, /expenses\.filter\(\(expense\) => !expense\.voidedAt\)/i);
  assert.match(mapper, /voidedAt: optionalString\(row\.voided_at\)/i);
});

test("expense void requests require an auditable bounded reason", () => {
  const base = {
    vehicleId: "9a2f9c7f-6d2d-4af4-bf6c-54f0c0a3f8b2",
    expenseId: "0e4d8b11-68a1-44b5-8b6a-b4c32ae6da62",
  };

  assert.equal(expenseVoidSchema.safeParse({ ...base, reason: "Wrong amount" }).success, true);
  assert.equal(expenseVoidSchema.safeParse({ ...base, reason: "no" }).success, false);
  assert.equal(expenseVoidSchema.safeParse({ ...base, reason: "x".repeat(501) }).success, false);
});
