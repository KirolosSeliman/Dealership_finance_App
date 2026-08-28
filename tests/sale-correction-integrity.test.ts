import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const migrationPath = join(repoRoot, "supabase/migrations/20260831_sale_cash_impact_integrity.sql");
const migrationSource = readFileSync(migrationPath, "utf8");

test("sale correction hardening blocks missing and duplicate original cash impacts", () => {
  assert.match(migrationSource, /create or replace function void_vehicle_sale_atomic/i);
  assert.match(migrationSource, /company_cash_impact_count/i);
  assert.match(migrationSource, /external_cash_impact_count/i);
  assert.match(migrationSource, /sale cash impact is missing/i);
  assert.match(migrationSource, /multiple active .*cash impacts/i);
  assert.match(migrationSource, /reversed_transaction_id is null/i);
  assert.match(migrationSource, /voided_at is null/i);
  assert.doesNotMatch(migrationSource, /delete\s+from\s+(?:sales|company_cash_transactions|external_cash_transactions)/i);
});

test("sale correction preserves the existing buyer link when no replacement buyer is entered", () => {
  assert.match(migrationSource, /create or replace function correct_vehicle_sale_atomic/i);
  assert.match(migrationSource, /new_sale_id[\s\S]+contact_id = old_sale\.contact_id/i);
  assert.match(migrationSource, /nullif\(trim\(coalesce\(p_buyer_name, ''\)\), ''\) is null/i);
  assert.match(migrationSource, /corrected_by_sale_id/i);
  assert.match(migrationSource, /correction_of_sale_id/i);
});

test("sale correction API, repository, UI, and Market Snap remain workflow-based", () => {
  const route = readFileSync(join(repoRoot, "src/lib/server/domain-mutation-handlers.ts"), "utf8");
  const repository = readFileSync(join(repoRoot, "src/lib/supabase/repository.ts"), "utf8");
  const component = readFileSync(join(repoRoot, "src/features/app/feature-views.tsx"), "utf8");
  const training = readFileSync(join(repoRoot, "src/lib/market-snap/training-export.ts"), "utf8");
  assert.match(route, /case "voidSale"/);
  assert.match(route, /case "correctSale"/);
  assert.match(route, /\["owner", "admin", "member"\]/);
  assert.match(repository, /void_vehicle_sale_accounting_v2/);
  assert.match(repository, /correct_vehicle_sale_accounting_v2/);
  assert.match(component, /Void only for cancelled or accidental sales/);
  assert.match(component, /Correction reason/);
  assert.match(training, /voided_sale/i);
});
