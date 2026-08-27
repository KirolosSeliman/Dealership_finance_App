import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cashTransactionSchema } from "../src/lib/validation";

const repoRoot = process.cwd();

test("cash validation accepts manual entries but rejects system-generated types", () => {
  const common = { amount: 100, date: "2026-08-27" };
  for (const type of [
    "company_cash_added",
    "company_cash_withdrawn",
    "external_cash_added",
    "external_cash_transferred_to_company",
    "external_cash_personally_removed",
  ]) {
    assert.equal(cashTransactionSchema.safeParse({ ...common, type }).success, true, type);
  }

  for (const type of [
    "vehicle_cost_paid",
    "vehicle_cost_refunded",
    "paper_sale_received",
    "external_commission_earned",
    "external_transfer_received",
    "external_transfer_returned",
    "external_vehicle_expense_paid",
    "external_vehicle_expense_refunded",
  ]) {
    assert.equal(cashTransactionSchema.safeParse({ ...common, type }).success, false, type);
  }
});

test("validation hardening protects manual cash inserts and concurrent active VIN uniqueness", () => {
  const sql = readFileSync(join(repoRoot, "supabase/migrations/20260832_validation_domain_integrity_hardening.sql"), "utf8");

  assert.match(sql, /drop policy if exists "write company cash"/i);
  assert.match(sql, /drop policy if exists "write external cash"/i);
  assert.match(sql, /create policy "insert manual company cash"/i);
  assert.match(sql, /create policy "insert manual external cash"/i);
  assert.match(sql, /company_cash_added.*company_cash_withdrawn/is);
  assert.match(sql, /external_cash_added.*external_cash_personally_removed/is);
  assert.match(sql, /create or replace function prevent_duplicate_active_vehicle_vin/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /Another active vehicle already uses this VIN/i);
  assert.match(sql, /create trigger prevent_duplicate_active_vehicle_vin/i);
});
