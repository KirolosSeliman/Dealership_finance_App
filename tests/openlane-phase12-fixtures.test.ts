import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { marketListingPayloadSchema } from "../src/lib/market-snap/validation";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
require("../browser-extension/src/copy-payload.js");
require("../browser-extension/src/openlane-extraction-contract.js");
require("../browser-extension/src/openlane-section-map.js");
require("../browser-extension/src/openlane-page-classifier.js");
require("../browser-extension/src/openlane-network-observer.js");
require("../browser-extension/src/openlane-safe-expander.js");
require("../browser-extension/src/openlane-extractor.js");

const extractor = require("../browser-extension/src/openlane-extractor.js") as {
  extractOpenLaneFixture: (html: string, href?: string) => Record<string, unknown>;
};
const networkObserver = require("../browser-extension/src/openlane-network-observer.js") as {
  extractCandidatesFromNetworkPayload: (payload: unknown, url?: string) => {
    fieldCandidates: Array<{ field: string; value: unknown }>;
    sanitizedKeys: string[];
  };
  mergeNetworkEvidenceIntoListing: (listing: Record<string, unknown>, evidence: unknown[]) => Record<string, unknown>;
  rememberNetworkPayload: (body: string, url: string, contentType?: string, eventId?: string) => unknown;
  rememberPageHookDiagnostic: (data: Record<string, unknown>) => void;
  getOpenLaneNetworkObserverStatus: () => Record<string, unknown>;
};
const copyPayload = require("../browser-extension/src/copy-payload.js") as {
  buildReadinessSummary: (listing: Record<string, unknown>) => Record<string, unknown>;
};

const organizationId = "63c47786-fb41-40c1-a573-71346969b9e0";

test("Phase 12 required OpenLane live fixtures lock latest extraction regressions", () => {
  const nissan = extract("openlane-vdp-nissan-final-minute-bid-refresh.html", "https://app.openlane.ca/vdp/1N6ED1EK0PN123456");
  const kia = extract("openlane-vdp-kia-purchase-sold-price-picked-up-live.html", "https://app.openlane.ca/vdp/3KPFK4A77HE123456");
  const condition = extract("openlane-vdp-condition-section-boundary-noise.html", "https://app.openlane.ca/vdp/KM8J3CA46HU123456");
  const carfaxTextOnly = extract("openlane-vdp-carfax-text-only-live.html", "https://app.openlane.ca/vdp/3KPFK4A77HE123456");
  const hyundai = extract("openlane-vdp-hyundai-santa-fe-sport-title.html", "https://app.openlane.ca/vdp/5XYZUDLB8EG123456");

  assert.equal(nissan.currentBid, 14_200);
  assert.notEqual(nissan.currentBid, 13_800);
  assert.notEqual(nissan.currentBid, 71);
  assert.match(JSON.stringify((nissan.extractedFields as { debug?: unknown }).debug), /stale_current_bid_candidate|bid_count_not_money/i);

  assert.equal(kia.pageType, "purchase_detail");
  assert.equal(kia.captureKind, "verified_outcome");
  assert.equal(kia.soldPriceCandidate, 4_000);
  assert.equal(kia.buyPriceAuction, 4_000);
  assert.ok(!((kia.missingData as string[] | undefined) || []).includes("listedPrice"));

  const conditionDetails = (condition.openlaneMetadata as { conditionDetails?: Record<string, unknown> }).conditionDetails || {};
  const canonicalCondition = JSON.stringify({
    mechanical: conditionDetails.mechanicalDisclosures,
    exterior: conditionDetails.exteriorDisclosures,
    interior: conditionDetails.interiorDisclosures,
    tireWheel: conditionDetails.tireWheelDisclosures,
    report: conditionDetails.conditionReportText,
  });
  assert.doesNotMatch(canonicalCondition, /Mechanical:\s*Exterior|Exterior:\s*Interior|Tire & wheels|Full bid history|OPENLANE Inc\. All rights reserved|Current bid \$5,100/i);

  assert.equal(carfaxTextOnly.carfaxUrlStatus, "text_only");
  assert.equal(carfaxTextOnly.carfaxUrl, undefined);

  assert.equal(hyundai.make, "Hyundai");
  assert.equal(hyundai.model, "Santa Fe Sport");
  assert.equal(hyundai.trim, "SE");
});

test("Phase 12 CARFAX network fixture recovers only safe URL metadata", () => {
  const payload = JSON.parse(fixture("openlane-network-carfax-url-live.json"));
  const candidates = networkObserver.extractCandidatesFromNetworkPayload(payload, "https://app.openlane.ca/api/vehicle-history/carfax/3KPFK4A77HE123456?token=secret");
  const merged = networkObserver.mergeNetworkEvidenceIntoListing({
    sourceName: "OpenLane",
    listingUrl: "https://app.openlane.ca/vdp/3KPFK4A77HE123456",
    pageType: "active_listing",
    captureKind: "observation",
  }, [{ endpointPattern: "app.openlane.ca/api/vehicle-history/carfax/:id", capturedAt: "2026-05-20T12:00:00.000Z", sanitizedKeys: candidates.sanitizedKeys, candidates }]);

  assert.equal(merged.carfaxUrlStatus, "url_found");
  assert.match(String(merged.carfaxUrl), /vehicle-history\/carfax\/FORTE-LIVE-123/i);
  assert.doesNotMatch(String(merged.carfaxUrl), /token|secret/i);
  assert.ok(candidates.fieldCandidates.some((item) => item.field === "carfaxUrl"));
});

test("Phase 12 network diagnostics explain zero evidence and endpoint allow/deny decisions", () => {
  const zero = JSON.parse(fixture("openlane-network-observer-zero-evidence-live.json"));
  const readiness = copyPayload.buildReadinessSummary({
    sourceName: "OpenLane",
    pageType: "active_listing",
    captureKind: "observation",
    openlaneMetadata: {
      deepCaptureRuntime: {
        active: true,
        networkEvidenceCount: 0,
        networkObserver: zero.status,
      },
    },
  });
  const safeBody = JSON.stringify(JSON.parse(fixture("openlane-network-carfax-url-live.json")));
  const allowed = networkObserver.rememberNetworkPayload(safeBody, "https://app.openlane.ca/api/vehicle-history/carfax/3KPFK4A77HE123456", "application/json", "phase12-allowed");
  networkObserver.rememberPageHookDiagnostic({
    type: "endpoint_denied",
    pageHookInstalled: true,
    earlyHookInstalled: true,
    endpointPattern: "app.openlane.ca/api/profile/me",
    reason: "denied_sensitive_endpoint",
  });
  const status = networkObserver.getOpenLaneNetworkObserverStatus();

  assert.match(String(readiness.networkObserverMessage), /no OpenLane vehicle JSON has been observed yet/i);
  assert.ok(allowed);
  assert.ok(Number(status.allowedEventCount || 0) >= 1);
  assert.ok(Number(status.deniedEventCount || 0) >= 1);
  assert.equal(status.lastDeniedEndpointReason, "denied_sensitive_endpoint");
  assert.doesNotMatch(JSON.stringify(status), /responseText|authorization=|cookie=|token=secret/i);
});

test("Phase 12 backend guards accept clean OpenLane observations/outcomes and reject polluted labels", () => {
  const cleanObservation = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2020 Nissan Frontier Crew Cab",
    year: 2020,
    make: "Nissan",
    model: "Frontier",
    currentBid: 14_200,
    priceSemantics: { currentBid: "observation" },
    fieldEvidence: {
      currentBid: [{
        field: "currentBid",
        value: 14_200,
        normalizedValue: 14_200,
        sourceType: "section_map",
        sourceText: "Current bid $14,200 Under 1 min 71 Bids",
        confidenceScore: 96,
        capturedAt: "2026-05-20T12:00:00.000Z",
      }],
    },
  });
  const cleanOutcome = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "purchase_detail",
    captureKind: "verified_outcome",
    title: "2017 Kia Forte",
    vin: "3KPFK4A77HE123456",
    soldPriceCandidate: 4_000,
    buyPriceAuction: 4_000,
    outcomeConfidence: "verified",
    outcomeEvidence: [{
      evidenceType: "purchase_document",
      sourceText: "Order history Sold price $4,000 Mark as picked up",
      capturedAt: "2026-05-20T12:00:00.000Z",
      confidenceScore: 96,
    }],
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
      buyPriceAuction: "verified_wholesale_label",
    },
  });
  const pollutedBidCount = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    currentBid: 71,
    priceSemantics: { currentBid: "observation" },
    fieldEvidence: {
      currentBid: [{
        field: "currentBid",
        value: 71,
        normalizedValue: 71,
        sourceType: "section_map",
        sourceText: "71 Bids",
        confidenceScore: 72,
        capturedAt: "2026-05-20T12:00:00.000Z",
      }],
    },
  });

  assert.equal(cleanObservation.success, true);
  assert.equal(cleanOutcome.success, true);
  assert.equal(pollutedBidCount.success, false);
});

function extract(name: string, href: string) {
  return extractor.extractOpenLaneFixture(fixture(name), href);
}

function fixture(name: string) {
  return readFileSync(join(repoRoot, "tests/fixtures/openlane", name), "utf8");
}
