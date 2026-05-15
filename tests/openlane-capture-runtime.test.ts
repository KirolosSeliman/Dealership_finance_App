import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const runtimeModule = require("../browser-extension/src/capture-runtime.js") as {
  createMarketSnapCaptureRuntime: (options: { api: { captureListing: (settings: Record<string, unknown>, listing: Record<string, unknown>) => Promise<unknown> }; now: () => number; timeBucketMs?: number }) => {
    enqueueCapture: (listing: Record<string, unknown>, settings: Record<string, unknown>, options?: { force?: boolean }) => Promise<{ skipped?: boolean; reason?: string; signature?: string }>;
    captureSignature: (listing: Record<string, unknown>) => string;
  };
};

test("Market Snap capture runtime suppresses duplicate DOM mutation captures", async () => {
  let now = Date.UTC(2026, 4, 15, 12, 0, 0);
  const calls: Array<Record<string, unknown>> = [];
  const runtime = runtimeModule.createMarketSnapCaptureRuntime({
    now: () => now,
    api: { captureListing: async (_settings, listing) => calls.push(listing) },
  });

  await runtime.enqueueCapture(activeListing({ currentBid: 18_500 }), captureSettings());
  now += 1_000;
  const duplicate = await runtime.enqueueCapture(activeListing({ currentBid: 18_500 }), captureSettings());

  assert.equal(calls.length, 1);
  assert.equal(duplicate.skipped, true);
  assert.equal(duplicate.reason, "duplicate-signature");
});

test("Market Snap capture runtime treats current bid changes as meaningful observations", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const runtime = runtimeModule.createMarketSnapCaptureRuntime({
    now: () => Date.UTC(2026, 4, 15, 12, 0, 0),
    api: { captureListing: async (_settings, listing) => calls.push(listing) },
  });

  await runtime.enqueueCapture(activeListing({ currentBid: 18_500 }), captureSettings());
  await runtime.enqueueCapture(activeListing({ currentBid: 18_750 }), captureSettings());

  assert.equal(calls.length, 2);
  assert.notEqual(runtime.captureSignature(activeListing({ currentBid: 18_500 })), runtime.captureSignature(activeListing({ currentBid: 18_750 })));
});

test("Market Snap capture runtime treats offer count changes as meaningful observations", () => {
  const runtime = runtimeModule.createMarketSnapCaptureRuntime({
    now: () => Date.UTC(2026, 4, 15, 12, 0, 0),
    api: { captureListing: async () => undefined },
  });

  const before = runtime.captureSignature(activeListing({ openlaneMetadata: { disclosureCount: 2, offerCount: 1 } }));
  const after = runtime.captureSignature(activeListing({ openlaneMetadata: { disclosureCount: 2, offerCount: 2 } }));

  assert.notEqual(before, after);
});


test("Market Snap capture runtime treats fee total changes as meaningful outcomes", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const runtime = runtimeModule.createMarketSnapCaptureRuntime({
    now: () => Date.UTC(2026, 4, 15, 12, 0, 0),
    api: { captureListing: async (_settings, listing) => calls.push(listing) },
  });

  await runtime.enqueueCapture(feeOutcome({ totalInvoiceAmount: 8_166 }), captureSettings());
  await runtime.enqueueCapture(feeOutcome({ totalInvoiceAmount: 8_280 }), captureSettings());

  assert.equal(calls.length, 2);
  assert.notEqual(runtime.captureSignature(feeOutcome({ totalInvoiceAmount: 8_166 })), runtime.captureSignature(feeOutcome({ totalInvoiceAmount: 8_280 })));
});

test("Market Snap capture runtime respects disabled capture settings", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const runtime = runtimeModule.createMarketSnapCaptureRuntime({
    now: () => Date.UTC(2026, 4, 15, 12, 0, 0),
    api: { captureListing: async (_settings, listing) => calls.push(listing) },
  });

  const result = await runtime.enqueueCapture(activeListing({ currentBid: 18_500 }), captureSettings({ autoCapture: false }));

  assert.equal(calls.length, 0);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "capture-disabled");
});

test("Market Snap content script separates widget analysis from capture queue storage", () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "browser-extension/manifest.json"), "utf8"));
  const scripts = manifest.content_scripts.flatMap((script: { js: string[] }) => script.js);
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const apiClient = readFileSync(join(repoRoot, "browser-extension/src/api-client.js"), "utf8");
  const storage = readFileSync(join(repoRoot, "browser-extension/src/storage.js"), "utf8");
  const serverApi = readFileSync(join(repoRoot, "src/lib/server/market-snap-api.ts"), "utf8");

  assert.ok(scripts.includes("src/capture-runtime.js"));
  assert.match(contentScript, /createMarketSnapCaptureRuntime/);
  assert.match(contentScript, /enqueueCapture/);
  assert.match(apiClient, /\/api\/market-snap\/capture-listing/);
  assert.match(storage, /autoCapture/);
  assert.match(storage, /modelImprovementOptIn/);
  assert.match(serverApi, /export async function captureListing/);
  assert.match(serverApi, /marketListingId:\s*null/);
});

function captureSettings(overrides: Record<string, unknown> = {}) {
  return {
    dealerFlowBaseUrl: "http://localhost:3000",
    organizationId: "11111111-1111-4111-8111-111111111111",
    autoCapture: true,
    modelImprovementOptIn: false,
    ...overrides,
  };
}

function activeListing(overrides: Record<string, unknown> = {}) {
  return {
    sourceName: "OpenLane",
    pageType: "active_listing",
    captureKind: "observation",
    vin: "2T3R1RFV5MW123456",
    listingUrl: "https://www.openlane.ca/vehicle/123",
    currentBid: 18_500,
    buyNowPrice: 22_900,
    imageCount: 12,
    openlaneMetadata: { disclosureCount: 3 },
    ...overrides,
  };
}

function feeOutcome(overrides: Record<string, unknown> = {}) {
  return {
    sourceName: "OpenLane",
    pageType: "fee_details",
    captureKind: "verified_outcome",
    vin: "2T3R1RFV5MW123456",
    listingUrl: "https://www.openlane.ca/purchases/123/fees",
    buyPriceAuction: 6_900,
    totalInvoiceAmount: 8_166,
    finalAcquisitionCost: 8_166,
    ...overrides,
  };
}
