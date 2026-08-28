import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { vehicleAnyUpdateSchema } from "../src/lib/validation";

const repoRoot = process.cwd();

test("purchase correction excludes voided payments and detects duplicate cash impacts", () => {
  const sql = readFileSync(join(repoRoot, "supabase/migrations/20260830_vehicle_correction_integrity.sql"), "utf8");
  assert.match(sql, /voided_at is null[\s\S]+reversed_transaction_id is null/i);
  assert.match(sql, /cash_impact_count/i);
  assert.match(sql, /multiple active cash impacts/i);
  assert.match(sql, /cash_impact_count = 0 and new_total > 0/i);
});

test("purchase correction recreates a missing linked cash impact instead of silently drifting", () => {
  const sql = readFileSync(join(repoRoot, "supabase/migrations/20260830_vehicle_correction_integrity.sql"), "utf8");
  const purchaseFunction = sql.slice(sql.indexOf("create or replace function correct_vehicle_purchase"));
  assert.match(purchaseFunction, /if cash_impact_count = 0 and new_total > 0/i);
  assert.match(purchaseFunction, /insert into company_cash_transactions/i);
  assert.match(purchaseFunction, /source_expense_id/i);
  assert.match(purchaseFunction, /vehicle_purchase_corrected/i);
});

test("vehicle edit schema keeps basic, status, and purchase correction modes separate", () => {
  const basicWithFinancialFields = vehicleAnyUpdateSchema.parse({
    updateMode: "basic",
    vin: "1HGCM82633A004352",
    listedPrice: 18995,
    notes: "Updated listing",
    purchasePrice: 10000,
    purchaseDate: "2026-08-29",
    purchaseSource: "OpenLane",
  });
  assert.equal(basicWithFinancialFields.updateMode, "basic");
  assert.equal("purchasePrice" in basicWithFinancialFields, false);
  assert.equal(vehicleAnyUpdateSchema.safeParse({
    updateMode: "purchase",
    purchasePrice: 10000,
    purchaseDate: "2026-08-29",
    purchaseSource: "OpenLane",
    purchaseTaxRate: 0.13,
    reason: "Corrected invoice",
  }).success, true);
  assert.equal(vehicleAnyUpdateSchema.safeParse({
    updateMode: "status",
    status: "sold",
  }).success, true);
});

test("vehicle correction UI and repository keep financial fields out of basic edits", () => {
  const component = readFileSync(join(repoRoot, "src/features/app/feature-views.tsx"), "utf8");
  const repository = readFileSync(join(repoRoot, "src/lib/supabase/repository.ts"), "utf8");
  const details = component.slice(component.indexOf("function VehicleDetailsTab"), component.indexOf("function Expenses"));
  assert.match(details, /name="updateMode" value="basic"/);
  assert.match(details, /name="updateMode" value="status"/);
  assert.match(details, /name="updateMode" value="purchase"/);
  assert.match(details, /Correct purchase details/);
  assert.match(details, /Sold vehicle purchase details are locked/);
  const updateVehicleBody = repository.slice(repository.indexOf("export async function updateVehicle"));
  assert.doesNotMatch(updateVehicleBody.slice(0, updateVehicleBody.indexOf('if (updateMode === "status")')), /\bpurchase_price:/);
  assert.match(updateVehicleBody, /rpc\("correct_vehicle_purchase_accounting_v2"/);
  assert.match(updateVehicleBody, /rpc\("transition_vehicle_status"/);
});
