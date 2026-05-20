import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
require("../browser-extension/src/deep-capture-activation.js");
const networkObserver = require("../browser-extension/src/openlane-network-observer.js") as {
  startOpenLaneNetworkObserver: (settings: Record<string, unknown>, context?: Record<string, unknown>) => { enabled: boolean; reason: string; observationCount?: number; activationMode?: string };
  getOpenLaneNetworkObserverStatus: () => {
    enabled: boolean;
    reason: string;
    observationCount: number;
    pageHookInstalled?: boolean;
    earlyHookInstalled?: boolean;
    earlyQueueLength?: number;
    earlyQueueFlushed?: boolean;
    pageHookEventCount?: number;
    allowedEventCount?: number;
    deniedEventCount?: number;
    irrelevantJsonCount?: number;
    duplicateEventCount?: number;
    parseErrorCount?: number;
    lastAllowedEndpointPattern?: string;
    lastDeniedEndpointPattern?: string;
    lastDeniedEndpointReason?: string;
    lastObservedEndpointSample?: string;
    candidateCounts?: { vin: number; carfax: number; media: number; condition: number; price: number; transport: number };
  };
  stopOpenLaneNetworkObserver: () => void;
  rememberNetworkPayload: (body: unknown, url?: string, contentType?: string, eventId?: string) => unknown;
  extractCandidatesFromNetworkPayload: (payload: unknown, url?: string) => {
    fieldCandidates: Array<{ field: string; value: unknown; confidence: number; endpointPattern: string; sourceText: string }>;
    vinCandidates: Array<{ field: string; value: string; vin: string; confidence: number }>;
    mediaCandidates: Array<{ field: string; value: string; url: string; confidence: number }>;
    conditionCandidates: Array<{ field: string; value: string; text: string; confidence: number }>;
    priceCandidates: Array<{ field: string; value: number; confidence: number }>;
  };
  sanitizeNetworkPayload: (payload: unknown) => unknown;
  mergeNetworkEvidenceIntoListing: (listing: Record<string, unknown>, evidence: unknown[]) => Record<string, unknown>;
};

test("OpenLane network observer enables in temporary default mode only for OpenLane with required settings", () => {
  assert.equal(networkObserver.startOpenLaneNetworkObserver({
    dealerFlowBaseUrl: "https://dealer-flow.example",
    observePageNetworkData: true,
    deepCaptureEnabled: true,
  }, { href: "https://app.openlane.ca/vdp/123" }).enabled, false);
  const pendingConsent = networkObserver.startOpenLaneNetworkObserver({
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    observePageNetworkData: true,
    deepCaptureEnabled: true,
  }, { href: "https://app.openlane.ca/vdp/123" });
  assert.equal(pendingConsent.enabled, true);
  assert.equal(pendingConsent.activationMode, "default_enabled_pending_consent_ui");
  networkObserver.stopOpenLaneNetworkObserver();

  const nonOpenLane = networkObserver.startOpenLaneNetworkObserver({
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    observePageNetworkData: true,
    deepCaptureEnabled: true,
  }, { href: "https://dealer-flow.example/market-snap" });
  assert.equal(nonOpenLane.enabled, false);
  assert.equal(nonOpenLane.reason, "disabled_non_openlane_context");

  const started = networkObserver.startOpenLaneNetworkObserver({
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    observePageNetworkData: true,
    deepCaptureEnabled: true,
    deepCaptureConsentStatus: "active",
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
  }, { href: "https://app.openlane.ca/vdp/123" });
  assert.equal(started.enabled, true);
  assert.equal(started.activationMode, "explicit_consent_active");
  assert.equal(typeof started.observationCount, "number");
  networkObserver.stopOpenLaneNetworkObserver();
});

test("OpenLane network observer status reports current evidence count", () => {
  networkObserver.startOpenLaneNetworkObserver({
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    observePageNetworkData: true,
    deepCaptureEnabled: true,
  }, { href: "https://app.openlane.ca/vdp/KM8J3CA46HU123456" });
  const before = networkObserver.getOpenLaneNetworkObserverStatus().observationCount;
  networkObserver.rememberNetworkPayload(JSON.stringify({ vehicle: { vin: "KM8J3CA46HU123456" } }), "https://app.openlane.ca/api/vdp/KM8J3CA46HU123456", "application/json");
  const after = networkObserver.getOpenLaneNetworkObserverStatus();

  assert.equal(after.enabled, true);
  assert.equal(after.observationCount, before + 1);
  assert.equal(after.lastAllowedEndpointPattern, "app.openlane.ca/api/vdp/:id");
  assert.ok(Number(after.allowedEventCount || 0) >= 1);
  assert.equal(after.lastObservedEndpointSample, "app.openlane.ca/api/vdp/:id");
  assert.equal(after.candidateCounts?.vin, 1);
  networkObserver.stopOpenLaneNetworkObserver();
});

test("OpenLane network observer flushes early page hook queue when active and clears it when stopped", async () => {
  const previousPostMessage = globalThis.postMessage;
  const messages: Array<{ source?: string; type?: string }> = [];
  globalThis.postMessage = ((message: { source?: string; type?: string }) => {
    messages.push(message);
  }) as typeof globalThis.postMessage;

  try {
    networkObserver.startOpenLaneNetworkObserver({
      dealerFlowBaseUrl: "https://dealer-flow.example",
      organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
      observePageNetworkData: true,
      deepCaptureEnabled: true,
      deepCaptureConsentStatus: "active",
      deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
    }, { href: "https://app.openlane.ca/vdp/123" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(messages.some((message) => message.source === "dealer-flow-openlane-network-control" && message.type === "flush"));

    networkObserver.stopOpenLaneNetworkObserver();
    assert.ok(messages.some((message) => message.source === "dealer-flow-openlane-network-control" && message.type === "clear"));
  } finally {
    globalThis.postMessage = previousPostMessage;
  }
});

test("OpenLane network observer ignores duplicate page-hook replay events", () => {
  networkObserver.startOpenLaneNetworkObserver({
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    observePageNetworkData: true,
    deepCaptureEnabled: true,
  }, { href: "https://app.openlane.ca/vdp/KM8J3CA46HU123456" });
  const body = JSON.stringify({ vehicle: { vin: "KM8J3CA46HU123456" } });
  const first = networkObserver.rememberNetworkPayload(body, "https://app.openlane.ca/api/vdp/KM8J3CA46HU123456", "application/json", "early-event-1");
  const afterFirst = networkObserver.getOpenLaneNetworkObserverStatus().observationCount;
  const duplicate = networkObserver.rememberNetworkPayload(body, "https://app.openlane.ca/api/vdp/KM8J3CA46HU123456", "application/json", "early-event-1");

  assert.ok(first);
  assert.equal(duplicate, undefined);
  assert.equal(networkObserver.getOpenLaneNetworkObserverStatus().observationCount, afterFirst);
  assert.ok(Number(networkObserver.getOpenLaneNetworkObserverStatus().duplicateEventCount || 0) >= 1);
  networkObserver.stopOpenLaneNetworkObserver();
});

test("OpenLane network observer ignores irrelevant and auth/session endpoints", () => {
  const body = JSON.stringify({ vehicle: { vin: "2T3R1RFV5MW123456" } });
  const beforeDenied = Number(networkObserver.getOpenLaneNetworkObserverStatus().deniedEventCount || 0);

  assert.equal(networkObserver.rememberNetworkPayload(body, "https://app.openlane.ca/api/profile/me", "application/json"), undefined);
  assert.equal(networkObserver.getOpenLaneNetworkObserverStatus().lastDeniedEndpointReason, "denied_sensitive_endpoint");
  assert.equal(networkObserver.getOpenLaneNetworkObserverStatus().lastDeniedEndpointPattern, "app.openlane.ca/api/profile/me");
  assert.equal(networkObserver.rememberNetworkPayload(body, "https://app.openlane.ca/oauth/session", "application/json"), undefined);
  assert.equal(networkObserver.rememberNetworkPayload(body, "https://app.openlane.ca/api/user/vehicles/123", "application/json"), undefined);
  assert.ok(Number(networkObserver.getOpenLaneNetworkObserverStatus().deniedEventCount || 0) >= beforeDenied + 3);
  assert.equal(networkObserver.rememberNetworkPayload(body, "https://app.openlane.ca/api/vdp/123", "application/json") !== undefined, true);
});

test("OpenLane network observer counts irrelevant JSON and parse errors without storing sensitive URL details", () => {
  const before = networkObserver.getOpenLaneNetworkObserverStatus();
  assert.equal(networkObserver.rememberNetworkPayload(JSON.stringify({ ok: true }), "https://app.openlane.ca/api/vdp/123?token=secret-token", "application/json"), undefined);
  assert.equal(networkObserver.rememberNetworkPayload("{bad json", "https://app.openlane.ca/api/vdp/123?authorization=secret-token", "application/json"), undefined);
  const after = networkObserver.getOpenLaneNetworkObserverStatus();

  assert.ok(Number(after.irrelevantJsonCount || 0) >= Number(before.irrelevantJsonCount || 0) + 1);
  assert.ok(Number(after.parseErrorCount || 0) >= Number(before.parseErrorCount || 0) + 1);
  assert.equal(after.lastObservedEndpointSample, "app.openlane.ca/api/vdp/:id");
  assert.doesNotMatch(JSON.stringify(after), /secret-token|authorization=|token=/i);
});

test("OpenLane network observer stops when Deep Capture or network observation is disabled", () => {
  const settings = {
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    observePageNetworkData: true,
    deepCaptureEnabled: true,
  };
  assert.equal(networkObserver.startOpenLaneNetworkObserver(settings, { href: "https://app.openlane.ca/vdp/123" }).enabled, true);
  const deepCaptureOff = networkObserver.startOpenLaneNetworkObserver({ ...settings, deepCaptureEnabled: false }, { href: "https://app.openlane.ca/vdp/123" });
  assert.equal(deepCaptureOff.enabled, false);
  assert.equal(deepCaptureOff.reason, "deep_capture_disabled_by_user");

  assert.equal(networkObserver.startOpenLaneNetworkObserver(settings, { href: "https://app.openlane.ca/vdp/123" }).enabled, true);
  const networkOff = networkObserver.startOpenLaneNetworkObserver({ ...settings, observePageNetworkData: false }, { href: "https://app.openlane.ca/vdp/123" });
  assert.equal(networkOff.enabled, false);
  assert.equal(networkOff.reason, "disabled");
});

test("OpenLane network observer redacts token, cookie, email, and phone values", () => {
  const sanitized = JSON.stringify(networkObserver.sanitizeNetworkPayload({
    authToken: "eyJaaaaaaaaaaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccccc",
    cookie: "openlane_session=abc",
    contact: { email: "buyer@example.com", phone: "514-555-1212" },
    vehicle: { vin: "2T3R1RFV5MW123456" },
  }));

  assert.doesNotMatch(sanitized, /eyJaaaaaaaa|openlane_session|buyer@example\.com|514-555-1212/);
  assert.match(sanitized, /\[redacted/);
});

test("OpenLane network observer creates structured candidates for vehicle JSON", () => {
  const candidates = networkObserver.extractCandidatesFromNetworkPayload({
    vehicle: {
      vin: "2T3R1RFV5MW123456",
      year: 2021,
      make: "Toyota",
      model: "RAV4",
      odometerKm: 52300,
      currentBid: 18500,
      buyNowPrice: 22900,
      photos: ["https://pub-us.kar-media.com/vehicle/2T3R1RFV5MW123456/front.jpg"],
      condition: { disclosure: "Check engine light on" },
    },
  }, "https://app.openlane.ca/api/vdp/123");

  assert.ok(candidates.fieldCandidates.some((item) => item.field === "vin" && item.value === "2T3R1RFV5MW123456" && item.confidence >= 90));
  assert.ok(candidates.fieldCandidates.some((item) => item.field === "currentBid" && item.value === 18500));
  assert.ok(candidates.mediaCandidates.some((item) => item.url.includes("pub-us.kar-media.com")));
  assert.ok(candidates.conditionCandidates.some((item) => /Check engine/i.test(item.text)));
});

test("OpenLane network observer maps Carfax URL evidence and strips sensitive query params", () => {
  const candidates = networkObserver.extractCandidatesFromNetworkPayload({
    vehicle: {
      vin: "2T3R1RFV5MW123456",
      carfaxReportUrl: "/vehicle-history/carfax/RAV4?token=secret-token&view=summary",
    },
  }, "https://app.openlane.ca/api/vdp/123");
  const candidate = candidates.fieldCandidates.find((item) => item.field === "carfaxUrl");

  assert.equal(candidate?.value, "https://app.openlane.ca/vehicle-history/carfax/RAV4");
  assert.doesNotMatch(JSON.stringify(candidates), /secret-token|token=/i);
});

test("OpenLane network observer maps Phase 7 fixture CARFAX URL evidence", () => {
  const payload = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/openlane/openlane-network-carfax-url.json"), "utf8"));
  const candidates = networkObserver.extractCandidatesFromNetworkPayload(payload, "https://app.openlane.ca/api/vdp/3KPFK4A77HE123456");
  const candidate = candidates.fieldCandidates.find((item) => item.field === "carfaxUrl");

  assert.equal(candidate?.value, "https://app.openlane.ca/vehicle-history/carfax/FORTE123");
  assert.ok(candidate?.sourceText.includes("vehicle-history/carfax/FORTE123"));
});

test("OpenLane network observer allows safe CARFAX report endpoints and strips sensitive query params", () => {
  const payload = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/openlane/openlane-network-carfax-url-live.json"), "utf8"));
  const observed = networkObserver.rememberNetworkPayload(
    JSON.stringify(payload),
    "https://app.openlane.ca/api/carfax/report/FORTE-LIVE-123",
    "application/json",
    "phase-6-carfax-report-endpoint",
  ) as { candidates?: { fieldCandidates?: Array<{ field?: string; value?: unknown }> } } | undefined;
  const after = networkObserver.getOpenLaneNetworkObserverStatus();
  const carfaxCandidate = observed?.candidates?.fieldCandidates?.find((item) => item.field === "carfaxUrl");

  assert.ok(observed);
  assert.equal(after.lastAllowedEndpointPattern, "app.openlane.ca/api/carfax/report/:id");
  assert.equal(carfaxCandidate?.value, "https://app.openlane.ca/vehicle-history/carfax/FORTE-LIVE-123");
  assert.doesNotMatch(JSON.stringify(observed), /token=|redacted-by-test/i);
});

test("OpenLane network merge fills missing fields but preserves verified fee outcomes", () => {
  const candidates = networkObserver.extractCandidatesFromNetworkPayload({
    vehicle: {
      vin: "2T3R1RFV5MW123456",
      currentBid: 18500,
      buyPriceAuction: 6500,
      photos: ["https://pub-us.kar-media.com/vehicle/2T3R1RFV5MW123456/front.jpg"],
      condition: { disclosure: "Transmission hesitation" },
    },
  }, "https://app.openlane.ca/api/vdp/123");
  const merged = networkObserver.mergeNetworkEvidenceIntoListing({
    captureKind: "verified_outcome",
    buyPriceAuction: 7000,
    priceSemantics: { buyPriceAuction: "verified_wholesale_label" },
  }, [{
    capturedAt: "2026-05-16T12:00:00.000Z",
    endpointPattern: "app.openlane.ca/api/vdp/:id",
    sanitizedKeys: ["vehicle.vin"],
    candidates,
  }]);

  assert.equal(merged.vin, "2T3R1RFV5MW123456");
  assert.equal(merged.currentBid, 18500);
  assert.equal(merged.buyPriceAuction, 7000);
  assert.match(String(merged.conditionReportText), /Transmission hesitation/);
});

test("OpenLane network sanitizer caps depth, arrays, strings, and stored payload summaries", () => {
  const sanitized = networkObserver.sanitizeNetworkPayload({
    vehicle: {
      photos: Array.from({ length: 100 }, (_, index) => `https://pub-us.kar-media.com/vehicle/photo-${index}.jpg`),
      note: "x".repeat(2000),
      nested: { a: { b: { c: { d: { e: { f: "too deep" } } } } } },
    },
  }) as { vehicle: { photos: string[]; note: string; nested: unknown } };

  assert.equal(sanitized.vehicle.photos.length, 40);
  assert.equal(sanitized.vehicle.note.length, 800);
  assert.match(JSON.stringify(sanitized), /\[depth_capped\]/);
});
