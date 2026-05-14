import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("release verification script chains lint, tests, and production build", () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> };

  assert.equal(packageJson.scripts?.lint, "eslint");
  assert.equal(packageJson.scripts?.test, "tsx --test tests/*.test.ts");
  assert.equal(packageJson.scripts?.build, "next build");
  assert.equal(packageJson.scripts?.["verify:release"], "npm run lint && npm test && npm run build");
});

test("release checklist covers automated, migration, deployment, role, desktop, and mobile gates", () => {
  const checklist = readFileSync(join(repoRoot, "docs/release-checklist.md"), "utf8");

  for (const required of [
    "npm run verify:release",
    "Migration Readiness",
    "Supabase And Storage Checklist",
    "Vercel And Runtime Checklist",
    "Manual Desktop Browser Checklist",
    "Manual Mobile Checklist",
    "Role Matrix",
    "Private beta",
    "Official launch",
    "Not ready",
  ]) {
    assert.ok(checklist.includes(required), `release checklist missing ${required}`);
  }
});

test("release verification workflow is CI-ready without production credentials", () => {
  const workflowPath = join(repoRoot, ".github/workflows/release-verification.yml");
  assert.equal(existsSync(workflowPath), true);
  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run verify:release/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|R2_SECRET_ACCESS_KEY|CRON_SECRET/);
});

test("all hardening migrations required for release are present in filename order", () => {
  const migrationNames = readdirSync(join(repoRoot, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
  const required = [
    "20260513_vehicle_archive.sql",
    "20260514_purchase_tax_consistency.sql",
    "20260515_atomic_expense_cash_impact.sql",
    "20260516_cash_ledger_reversal_integrity.sql",
    "20260517_vehicle_financial_corrections.sql",
    "20260518_sale_void_correction_workflow.sql",
    "20260519_validation_domain_integrity.sql",
    "20260520_persistent_rate_limiting.sql",
    "20260521_market_snap_calibration_guardrails.sql",
  ];

  for (const name of required) {
    assert.ok(migrationNames.includes(name), `missing required migration ${name}`);
  }
  assert.deepEqual([...migrationNames].sort(), migrationNames);
});

test("release hardening migrations do not contain unguarded destructive core data operations", () => {
  const migrationDir = join(repoRoot, "supabase/migrations");
  const coreTables = [
    "vehicles",
    "sales",
    "vehicle_expenses",
    "company_cash_transactions",
    "external_cash_transactions",
    "contacts",
    "activity_logs",
    "attachments",
  ].join("|");

  for (const name of readdirSync(migrationDir).filter((item) => item.endsWith(".sql") && item >= "20260513")) {
    const sql = readFileSync(join(migrationDir, name), "utf8").replace(/--.*$/gm, "");
    assert.doesNotMatch(sql, new RegExp(`\\btruncate\\s+(table\\s+)?(${coreTables})\\b`, "i"), `${name} truncates core data`);
    assert.doesNotMatch(sql, new RegExp(`\\bdelete\\s+from\\s+(${coreTables})\\b`, "i"), `${name} deletes core data`);
    assert.doesNotMatch(sql, new RegExp(`\\bdrop\\s+table\\s+(if\\s+exists\\s+)?(${coreTables})\\b`, "i"), `${name} drops core tables`);
  }
});
