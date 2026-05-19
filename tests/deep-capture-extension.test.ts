import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("Deep Capture extension defaults to temporary safe activation pending installer consent UI", () => {
  const storage = readFileSync(join(repoRoot, "browser-extension/src/storage.js"), "utf8");
  const helper = readFileSync(join(repoRoot, "browser-extension/src/deep-capture-activation.js"), "utf8");

  for (const setting of [
    "deepCaptureEnabled",
    "deepCaptureConsentId",
    "deepCaptureConsentVersion",
    "deepCaptureConsentAcceptedAt",
    "deepCaptureConsentStatus",
    "extensionInstallationId",
  ]) {
    assert.match(storage, new RegExp(setting));
  }

  assert.match(storage, /deepCaptureEnabled:\s*true/);
  assert.match(storage, /observePageNetworkData:\s*true/);
  assert.match(storage, /modelImprovementOptIn:\s*false/);
  assert.match(storage, /deepCaptureConsentStatus:\s*"off"/);
  assert.match(helper, /default_enabled_pending_consent_ui/);
  assert.match(helper, /explicit_consent_active/);
  assert.match(helper, /disabled_by_user/);
  assert.match(helper, /disabled_missing_required_settings/);
  assert.match(helper, /future_download_consent_pending/);
});

test("Deep Capture API client exposes consent status, accept, and withdraw methods", () => {
  const apiClient = readFileSync(join(repoRoot, "browser-extension/src/api-client.js"), "utf8");

  for (const method of ["getDeepCaptureConsentStatus", "acceptDeepCaptureConsent", "withdrawDeepCaptureConsent"]) {
    assert.match(apiClient, new RegExp(method));
  }

  assert.match(apiClient, /\/api\/market-snap\/deep-capture-consent/);
  assert.match(apiClient, /extensionInstallationId/);
  assert.doesNotMatch(apiClient, /service_role|SUPABASE_SERVICE_ROLE|cookie|authorization/i);
});

test("Deep Capture options page shows status, independent toggles, accept, renew, and withdraw controls", () => {
  const html = readFileSync(join(repoRoot, "browser-extension/options.html"), "utf8");
  const options = readFileSync(join(repoRoot, "browser-extension/src/options.js"), "utf8");

  for (const marker of [
    "deepCaptureStatusBadge",
    "deepCaptureEnabled",
    "acceptDeepCaptureConsent",
    "withdrawDeepCaptureConsent",
    "refreshDeepCaptureConsent",
    "modelImprovementOptIn",
    "View captured JSON",
    "Copy extracted JSON",
    "Active by default - consent UI pending",
    "Off - disabled or missing settings",
    "On - active consent",
    "Paused - backend unreachable",
    "Requires renewal - consent version changed",
  ]) {
    assert.match(`${html}\n${options}`, new RegExp(marker));
  }

  assert.match(options, /acceptDeepCaptureConsent/);
  assert.match(options, /withdrawDeepCaptureConsent/);
  assert.match(options, /deepCaptureConsentStatus:\s*active \? "active"/);
  assert.match(options, /observePageNetworkData:\s*settings\.observePageNetworkData !== false/);
  assert.match(options, /Active by default - consent UI pending/);
});

test("Content script gates network observation and safe expansion through the activation helper", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const networkObserver = readFileSync(join(repoRoot, "browser-extension/src/openlane-network-observer.js"), "utf8");
  const activation = readFileSync(join(repoRoot, "browser-extension/src/deep-capture-activation.js"), "utf8");

  assert.match(contentScript, /refreshDeepCaptureConsentState/);
  assert.match(contentScript, /isDeepCaptureAllowed/);
  assert.match(contentScript, /stopOpenLaneNetworkObserver/);
  assert.match(contentScript, /applyConsentGateToListing/);
  assert.match(contentScript, /captureLevel:\s*"basic_dom"/);
  assert.match(contentScript, /captureLevel:\s*"deep_capture"/);
  assert.match(contentScript, /deepCaptureActivationMode/);
  assert.match(contentScript, /consentMode/);
  assert.match(contentScript, /sourceEvidence/);
  assert.match(networkObserver, /isDeepCaptureAllowed/);
  assert.match(activation, /disabled_non_openlane_context/);
});

test("Backend has a Market Snap consent route for extension accept and withdrawal", () => {
  const route = readFileSync(join(repoRoot, "src/app/api/market-snap/deep-capture-consent/route.ts"), "utf8");
  const api = readFileSync(join(repoRoot, "src/lib/server/market-snap-api.ts"), "utf8");

  assert.match(route, /POST = deepCaptureConsent/);
  assert.match(route, /OPTIONS = marketSnapOptions/);
  assert.match(api, /deepCaptureConsent/);
  assert.match(api, /accept/);
  assert.match(api, /withdraw/);
  assert.match(api, /recordMarketSnapConsentEvent/);
  assert.match(api, /\["owner", "admin"\]/);
});
