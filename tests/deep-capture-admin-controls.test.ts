import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("Deep Capture consent schema exposes admin audit, export, delete, and model controls", () => {
  const validation = readFileSync(join(repoRoot, "src/lib/market-snap/validation.ts"), "utf8");

  for (const action of [
    "status",
    "accept",
    "withdraw",
    "list_events",
    "export_audit",
    "delete_eligible_captures",
    "disable_model_improvement",
  ]) {
    assert.match(validation, new RegExp(`"${action}"`));
  }
});

test("Deep Capture backend keeps status readable but restricts mutating controls to owners/admins", () => {
  const api = readFileSync(join(repoRoot, "src/lib/server/market-snap-api.ts"), "utf8");

  assert.match(api, /payload\.action === "status"/);
  assert.match(api, /\["owner", "admin", "member", "accountant", "viewer"\]/);
  assert.match(api, /payload\.action === "list_events"/);
  assert.match(api, /payload\.action === "export_audit"/);
  assert.match(api, /payload\.action === "delete_eligible_captures"/);
  assert.match(api, /payload\.action === "disable_model_improvement"/);
  assert.match(api, /requireOrganizationRole\(client, userId, payload\.organizationId, \["owner", "admin"\]\)/);
  assert.match(api, /recordMarketSnapConsentEvent/);
  assert.match(api, /model_improvement_disabled/);
});

test("Deep Capture delete/export controls avoid business-record deletion", () => {
  const api = readFileSync(join(repoRoot, "src/lib/server/market-snap-api.ts"), "utf8");

  assert.match(api, /exportDeepCaptureAudit/);
  assert.match(api, /deleteEligibleDeepCaptureData/);
  assert.match(api, /openlane_observations/);
  assert.match(api, /openlane_outcomes/);
  assert.match(api, /market_listings/);
  assert.match(api, /is_saved_to_deal_radar/);
  assert.doesNotMatch(api, /\.from\("deal_radar_saved_listings"\)\.delete/);
  assert.doesNotMatch(api, /\.from\("sales"\)\.delete/);
  assert.doesNotMatch(api, /\.from\("vehicles"\)\.delete/);
});

test("Dealer Flow settings page exposes Deep Capture transparency and admin controls", () => {
  const app = readFileSync(join(repoRoot, "src/components/dealer-flow-app.tsx"), "utf8");

  for (const marker of [
    "Market Snap / Deep Capture",
    "Deep Capture improves accuracy by reading structured vehicle/listing data already loaded in your browser session.",
    "It does not collect passwords, cookies, authorization headers, or unrelated browsing data.",
    "You can turn it off anytime.",
    "Model improvement is separate.",
    "Enable Deep Capture",
    "Withdraw Deep Capture",
    "Disable Model Improvement",
    "Export Deep Capture Audit",
    "Delete eligible unsaved capture data",
    "/terms",
    "/privacy",
  ]) {
    assert.match(app, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(app, /deep-capture-consent/);
  assert.match(app, /export_audit/);
  assert.match(app, /delete_eligible_captures/);
});

test("Extension still treats withdrawn consent as inactive unless the user explicitly reconfigures it later", () => {
  const activation = readFileSync(join(repoRoot, "browser-extension/src/deep-capture-activation.js"), "utf8");
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");

  assert.match(activation, /deepCaptureConsentStatus === "withdrawn"/);
  assert.match(activation, /deep_capture_consent_withdrawn/);
  assert.match(contentScript, /isDeepCaptureAllowed/);
  assert.match(contentScript, /stopOpenLaneNetworkObserver/);
});
