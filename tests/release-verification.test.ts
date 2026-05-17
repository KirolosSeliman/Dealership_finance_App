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
    "OpenLane Live Verification Matrix",
    "OpenLane Supabase Verification Queries",
    "Role Matrix",
    "Private beta",
    "Official launch",
    "Not ready",
  ]) {
    assert.ok(checklist.includes(required), `release checklist missing ${required}`);
  }
});

test("release checklist requires real OpenLane live matrix and Supabase capture checks", () => {
  const checklist = readFileSync(join(repoRoot, "docs/release-checklist.md"), "utf8");

  for (const required of [
    "French active VDP",
    "English active VDP",
    "VDP with purchase selling price",
    "Purchase fee details",
    "Post-sale pending",
    "Post-sale accepted",
    "Carfax URL page",
    "Video page",
    "Bid update page",
    "Unsupported/search page",
    "openlane_vehicle_identities",
    "openlane_observations",
    "openlane_outcomes",
    "current bid or offer is observation-only",
    "Candidate outcomes are not training eligible",
    "Viewer/accountant roles cannot write captures",
    "duplicate overlays",
  ]) {
    assert.ok(checklist.includes(required), `release checklist missing OpenLane release item: ${required}`);
  }
});

test("Deep Capture release QA checklist covers consent, extension, persistence, deployment, and rollback", () => {
  const checklist = readFileSync(join(repoRoot, "docs/release-checklist.md"), "utf8");
  const qa = readFileSync(join(repoRoot, "docs/deep-capture-release-qa.md"), "utf8");

  assert.match(checklist, /docs\/deep-capture-release-qa\.md/);
  for (const required of [
    "Final release notes",
    "Migration checklist",
    "Vercel deployment checklist",
    "Supabase migration checklist",
    "Chrome/Brave extension packaging checklist",
    "Rollback plan",
    "Known limitations",
    "Security/privacy assurance statement",
    "Confirm Deep Capture is off before consent",
    "Confirm Deep Capture badge is active",
    "Confirm network evidence appears only in sanitized debug/copy payload",
    "Confirm backend rejects deep capture",
    "Confirm model improvement can be off while Deep Capture is on",
    "Confirm current bid is not training label",
  ]) {
    assert.ok(qa.includes(required), `Deep Capture release QA missing ${required}`);
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
    "20260522_openlane_extension_payload.sql",
    "20260523_openlane_capture_storage.sql",
    "20260524_market_snap_training_export_safety.sql",
    "20260525_market_snap_deep_capture_consent.sql",
    "20260526_deep_capture_retention_training_guards.sql",
    "20260527_deep_capture_release_security_hardening.sql",
  ];

  for (const name of required) {
    assert.ok(migrationNames.includes(name), `missing required migration ${name}`);
  }
  assert.deepEqual([...migrationNames].sort(), migrationNames);
});

test("Deep Capture retention cleanup is restricted to service role before release", () => {
  const retentionMigration = readFileSync(join(repoRoot, "supabase/migrations/20260526_deep_capture_retention_training_guards.sql"), "utf8");
  const hardeningMigration = readFileSync(join(repoRoot, "supabase/migrations/20260527_deep_capture_release_security_hardening.sql"), "utf8");
  const sql = `${retentionMigration}\n${hardeningMigration}`;

  assert.match(sql, /execute 'revoke execute on function public\.cleanup_market_snap_deep_capture_retention\(\) from public'/i);
  assert.match(sql, /where rolname = 'anon'[\s\S]+execute 'revoke execute on function public\.cleanup_market_snap_deep_capture_retention\(\) from anon'/i);
  assert.match(sql, /where rolname = 'authenticated'[\s\S]+execute 'revoke execute on function public\.cleanup_market_snap_deep_capture_retention\(\) from authenticated'/i);
  assert.match(sql, /where rolname = 'service_role'[\s\S]+execute 'grant execute on function public\.cleanup_market_snap_deep_capture_retention\(\) to service_role'/i);
  assert.doesNotMatch(sql.replace(/execute\s+'[^']+'/gi, ""), /\b(grant|revoke)\s+execute\s+on\s+function\s+(public\.)?cleanup_market_snap_deep_capture_retention\(\)/i);
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
