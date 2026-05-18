import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const networkObserver = require("../browser-extension/src/openlane-network-observer.js") as {
  startOpenLaneNetworkObserver: (settings: Record<string, unknown>) => { enabled: boolean; reason: string; observationCount?: number };
  getOpenLaneNetworkObserverStatus: () => { enabled: boolean; reason: string; observationCount: number };
  stopOpenLaneNetworkObserver: () => void;
  rememberNetworkPayload: (body: unknown, url?: string, contentType?: string) => unknown;
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

test("OpenLane network observer consent gate fails closed and enables only with active consent", () => {
  assert.equal(networkObserver.startOpenLaneNetworkObserver({ observePageNetworkData: true }).enabled, false);
  const started = networkObserver.startOpenLaneNetworkObserver({
    observePageNetworkData: true,
    deepCaptureEnabled: true,
    deepCaptureConsentStatus: "active",
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
  });
  assert.equal(started.enabled, true);
  assert.equal(typeof started.observationCount, "number");
  networkObserver.stopOpenLaneNetworkObserver();
});

test("OpenLane network observer status reports current evidence count", () => {
  networkObserver.startOpenLaneNetworkObserver({
    observePageNetworkData: true,
    deepCaptureEnabled: true,
    deepCaptureConsentStatus: "active",
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
  });
  const before = networkObserver.getOpenLaneNetworkObserverStatus().observationCount;
  networkObserver.rememberNetworkPayload(JSON.stringify({ vehicle: { vin: "KM8J3CA46HU123456" } }), "https://app.openlane.ca/api/vdp/KM8J3CA46HU123456", "application/json");
  const after = networkObserver.getOpenLaneNetworkObserverStatus();

  assert.equal(after.enabled, true);
  assert.equal(after.observationCount, before + 1);
  networkObserver.stopOpenLaneNetworkObserver();
});

test("OpenLane network observer ignores irrelevant and auth/session endpoints", () => {
  const body = JSON.stringify({ vehicle: { vin: "2T3R1RFV5MW123456" } });

  assert.equal(networkObserver.rememberNetworkPayload(body, "https://app.openlane.ca/api/profile/me", "application/json"), undefined);
  assert.equal(networkObserver.rememberNetworkPayload(body, "https://app.openlane.ca/oauth/session", "application/json"), undefined);
  assert.equal(networkObserver.rememberNetworkPayload(body, "https://app.openlane.ca/api/user/vehicles/123", "application/json"), undefined);
  assert.equal(networkObserver.rememberNetworkPayload(body, "https://app.openlane.ca/api/vdp/123", "application/json") !== undefined, true);
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
