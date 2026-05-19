import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const repoRoot = process.cwd();
const organizationId = "63c47786-fb41-40c1-a573-71346969b9e0";

type ExtensionContext = {
  window: ExtensionContext & {
    DealerFlowMarketSnapApi?: {
      saveListing: (
        settings: Record<string, unknown>,
        listing: Record<string, unknown>,
        valuation?: Record<string, unknown> | null,
      ) => Promise<unknown>;
    };
    DealerFlowMarketSnapStorage?: {
      saveSettings: (values: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
  };
  [key: string]: unknown;
};

test("extension saveListing omits valuation when widget has no valuation yet", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const context = extensionContext({
    fetch: async (_url: string, init: { body?: string }) => {
      capturedBody = JSON.parse(String(init.body || "{}"));
      return { ok: true, json: async () => ({ ok: true, id: "saved", marketListingId: "market", valuation: { confidenceScore: 40 } }) };
    },
  });
  runExtensionScript(context, "browser-extension/src/api-client.js");

  await context.window.DealerFlowMarketSnapApi.saveListing(
    { dealerFlowBaseUrl: "https://dealer-flow.example", organizationId },
    { sourceName: "OpenLane", title: "2017 Hyundai Tucson" },
    null,
  );

  assert.equal(capturedBody?.organizationId, organizationId);
  assert.equal("valuation" in (capturedBody || {}), false);
});

test("extension settings save preserves existing active Deep Capture consent fields", async () => {
  const syncStore: Record<string, unknown> = {
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId,
    deepCaptureEnabled: true,
    observePageNetworkData: true,
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
    deepCaptureConsentVersion: "deep-capture-v1",
    deepCaptureConsentAcceptedAt: "2026-05-17T12:00:00.000Z",
    deepCaptureConsentStatus: "active",
  };
  const context = extensionContext({ syncStore });
  runExtensionScript(context, "browser-extension/src/deep-capture-activation.js");
  runExtensionScript(context, "browser-extension/src/storage.js");

  const saved = await context.window.DealerFlowMarketSnapStorage.saveSettings({
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId,
    autoAnalyze: true,
    autoCapture: true,
    includeMediaUrls: true,
    includeRawVisibleText: true,
  });

  assert.equal(saved.deepCaptureEnabled, true);
  assert.equal(saved.observePageNetworkData, true);
  assert.equal(saved.deepCaptureConsentStatus, "active");
  assert.equal(saved.deepCaptureConsentId, "33333333-3333-4333-8333-333333333333");
});

test("extension settings default Deep Capture on with org and URL without enabling model improvement", async () => {
  const syncStore: Record<string, unknown> = {
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId,
  };
  const context = extensionContext({ syncStore });
  runExtensionScript(context, "browser-extension/src/deep-capture-activation.js");
  runExtensionScript(context, "browser-extension/src/storage.js");

  const settings = await context.window.DealerFlowMarketSnapStorage.getSettings();

  assert.equal(settings.deepCaptureEnabled, true);
  assert.equal(settings.observePageNetworkData, true);
  assert.equal(settings.deepCaptureActivationMode, "default_enabled_pending_consent_ui");
  assert.equal(settings.consentMode, "future_download_consent_pending");
  assert.equal(settings.modelImprovementOptIn, false);
});

test("content script listens for settings changes and refreshes runtime settings", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");

  assert.match(contentScript, /chrome\.storage\.onChanged\.addListener/);
  assert.match(contentScript, /refreshRuntimeSettings/);
});

test("content script prevents duplicate save requests while save is in progress", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");

  assert.match(contentScript, /saving:\s*false/);
  assert.match(contentScript, /if\s*\(STATE\.saving\)\s*return/);
  assert.match(contentScript, /STATE\.saving\s*=\s*true/);
  assert.match(contentScript, /STATE\.saving\s*=\s*false/);
});

test("content script and widget expose Deep Capture network evidence count", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");

  assert.match(contentScript, /networkEvidenceCount/);
  assert.match(widget, /networkEvidenceCount/);
});

test("widget disables Save while saving and displays saved listing ids", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");

  assert.match(contentScript, /status:\s*"saving"/);
  assert.match(contentScript, /saveResult:\s*payload/);
  assert.match(widget, /saveButton\.disabled\s*=/);
  assert.match(widget, /state\.status === "saving"/);
  assert.match(widget, /marketListingId/);
});

function extensionContext(overrides: Record<string, unknown> = {}): ExtensionContext {
  const syncStore = (overrides.syncStore as Record<string, unknown>) || {};
  const localStore: Record<string, unknown> = {};
  const context: Record<string, unknown> = {
    URL,
    console,
    crypto: { randomUUID: () => "install-uuid" },
    fetch: overrides.fetch,
    chrome: {
      storage: {
        sync: {
          get: async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, syncStore[key]]).filter(([, value]) => value !== undefined)),
          set: async (values: Record<string, unknown>) => Object.assign(syncStore, values),
        },
        local: {
          get: async (key: string) => key in localStore ? { [key]: localStore[key] } : {},
          set: async (values: Record<string, unknown>) => Object.assign(localStore, values),
        },
      },
    },
  };
  context.window = context;
  return context as ExtensionContext;
}

function runExtensionScript(context: Record<string, unknown>, path: string) {
  vm.runInNewContext(readFileSync(join(repoRoot, path), "utf8"), context, { filename: path });
}
