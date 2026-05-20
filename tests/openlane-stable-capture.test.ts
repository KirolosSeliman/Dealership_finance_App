import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
require("../browser-extension/src/openlane-extraction-contract.js");
require("../browser-extension/src/deep-capture-activation.js");
require("../browser-extension/src/openlane-section-map.js");
require("../browser-extension/src/openlane-page-classifier.js");
require("../browser-extension/src/openlane-network-observer.js");
require("../browser-extension/src/openlane-safe-expander.js");
require("../browser-extension/src/openlane-extractor.js");

const stableCapture = require("../browser-extension/src/openlane-stable-capture.js") as {
  extractStableOpenLaneListing: (doc: Record<string, unknown>, href: string, settings: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{
    listing: Record<string, unknown>;
    readiness: { readyToCapture: boolean; state: string; blockedReason: string; vinStatus: string; carfaxStatus: string; attempts: number; missingData: string[] };
    debug?: Record<string, unknown>;
  }>;
  evaluateOpenLaneReadiness: (listing: Record<string, unknown>, classifier: Record<string, unknown>, options?: Record<string, unknown>) => {
    readyToCapture: boolean;
    state: string;
    blockedReason: string;
    vinStatus: string;
    identityConfidence: string;
  };
  recoverVinFromUrl: (href: string) => string | undefined;
  normalizeCarfaxStatus: (listing: Record<string, unknown>) => "url_found" | "text_only" | "missing";
  extractSafeDomAttributeText: (doc: Record<string, unknown>) => string;
};

test("OpenLane stable capture does not finalize from an SPA loading shell", async () => {
  const doc = fakeDocument("Loading OpenLane application...");
  const result = await stableCapture.extractStableOpenLaneListing(doc, "https://app.openlane.ca/vdp/loading", {}, { delaysMs: [0], sleep: async () => undefined });

  assert.equal(result.readiness.readyToCapture, false);
  assert.equal(result.readiness.state, "unsupported_page");
  assert.equal(result.readiness.vinStatus, "missing");
});

test("OpenLane stable capture finalizes after delayed SPA vehicle content appears", async () => {
  const doc = fakeDocument("Loading OpenLane application...");
  let sleeps = 0;
  const result = await stableCapture.extractStableOpenLaneListing(doc, "https://app.openlane.ca/vdp/KM8J3CA46HU123456", {}, {
    delaysMs: [0, 1],
    sleep: async () => {
      sleeps += 1;
      if (sleeps === 1) {
        setDocumentText(doc, "2017 Hyundai Tucson AWD VIN KM8J3CA46HU123456 Odometer 111,486 KM Current Bid $4,600 23 total photos CARFAX Canada");
        doc.images = Array.from({ length: 23 }, () => ({}));
      }
    },
  });

  assert.equal(result.readiness.readyToCapture, true);
  assert.equal(result.readiness.state, "ready_to_capture");
  assert.equal(result.readiness.vinStatus, "found");
  assert.equal(result.listing.vin, "KM8J3CA46HU123456");
  assert.equal(result.listing.mileageKm, 111486);
  assert.equal((result.listing.openlaneCanonicalState as { readiness?: { readyToCapture?: boolean; state?: string } }).readiness?.readyToCapture, true);
  assert.equal((result.listing.openlaneCanonicalState as { readiness?: { state?: string } }).readiness?.state, "ready_to_capture");
});

test("OpenLane stable capture blocks weak identity without VIN but allows VIN-backed capture", () => {
  const weak = stableCapture.evaluateOpenLaneReadiness(
    { sourceName: "OpenLane", title: "Vehicle details", imageCount: 1 },
    { pageType: "active_listing" },
  );
  const strong = stableCapture.evaluateOpenLaneReadiness(
    { sourceName: "OpenLane", title: "2017 Hyundai Tucson", vin: "KM8J3CA46HU123456", year: 2017, make: "Hyundai", model: "Tucson", mileageKm: 111486, currentBid: 4600 },
    { pageType: "active_listing" },
  );

  assert.equal(weak.readyToCapture, false);
  assert.equal(weak.state, "incomplete_identity");
  assert.equal(strong.readyToCapture, true);
  assert.equal(strong.vinStatus, "found");
});

test("OpenLane stable capture requires outcome price evidence on purchase pages", () => {
  const missingOutcome = stableCapture.evaluateOpenLaneReadiness(
    {
      sourceName: "OpenLane",
      pageType: "purchase_detail",
      captureKind: "verified_outcome",
      title: "2017 Kia Forte",
      vin: "3KPFL4A72HE119966",
      year: 2017,
      make: "Kia",
      model: "Forte",
      imageCount: 13,
      missingData: ["soldPriceCandidate"],
    },
    { pageType: "purchase_detail" },
  );
  const withOutcome = stableCapture.evaluateOpenLaneReadiness(
    {
      sourceName: "OpenLane",
      pageType: "purchase_detail",
      captureKind: "verified_outcome",
      title: "2017 Kia Forte",
      vin: "3KPFL4A72HE119966",
      year: 2017,
      make: "Kia",
      model: "Forte",
      soldPriceCandidate: 4000,
      outcomeEvidence: [{ evidenceType: "purchase_detail_panel" }],
    },
    { pageType: "purchase_detail" },
  );

  assert.equal(missingOutcome.readyToCapture, false);
  assert.equal(missingOutcome.blockedReason, "missing_purchase_outcome_price");
  assert.equal(withOutcome.readyToCapture, true);
});

test("OpenLane stable capture applies purchase-list and Carfax readiness by context", () => {
  const missingPurchaseList = stableCapture.evaluateOpenLaneReadiness(
    {
      sourceName: "OpenLane",
      pageType: "purchase_list",
      captureKind: "candidate_outcome",
      title: "2017 Kia Forte",
      vin: "3KPFL4A72HE119966",
      year: 2017,
      make: "Kia",
      model: "Forte",
      imageCount: 13,
      missingData: ["listedPrice"],
    },
    { pageType: "purchase_list" },
  );
  const activeMissingCarfax = stableCapture.evaluateOpenLaneReadiness(
    {
      sourceName: "OpenLane",
      pageType: "active_listing",
      captureKind: "observation",
      title: "2021 Toyota RAV4",
      vin: "2T3R1RFV5MW123456",
      year: 2021,
      make: "Toyota",
      model: "RAV4",
      imageCount: 12,
      currentBid: 18500,
      missingData: ["carfax", "carfaxUrl", "soldPriceCandidate"],
    },
    { pageType: "active_listing" },
  );

  assert.equal(missingPurchaseList.readyToCapture, false);
  assert.equal(missingPurchaseList.blockedReason, "missing_purchase_outcome_price");
  assert.ok(missingPurchaseList.missingData.includes("soldPriceCandidate"));
  assert.ok(!missingPurchaseList.missingData.includes("listedPrice"));
  assert.equal(activeMissingCarfax.readyToCapture, true);
  assert.ok(!activeMissingCarfax.missingData.includes("carfax"));
  assert.ok(!activeMissingCarfax.missingData.includes("carfaxUrl"));
  assert.ok(!activeMissingCarfax.missingData.includes("soldPriceCandidate"));
});

test("OpenLane stable capture keeps no-VIN listings preview-only even when identity is stable", async () => {
  const doc = fakeDocument("2017 Hyundai Tucson AWD Odometer 111,486 KM Current Bid $4,600 23 total photos CARFAX Canada");
  doc.images = Array.from({ length: 23 }, () => ({}));
  const result = await stableCapture.extractStableOpenLaneListing(doc, "https://app.openlane.ca/vdp/no-vin-preview", {}, { delaysMs: [0, 0], sleep: async () => undefined });

  assert.equal(result.listing.vin, undefined);
  assert.equal(result.readiness.readyToCapture, false);
  assert.equal(result.readiness.state, "incomplete_identity");
  assert.equal(result.readiness.blockedReason, "missing_vin_openlane_preview_only");
  assert.equal(result.readiness.vinStatus, "missing");
  assert.ok(result.readiness.missingData.includes("vin"));
});

test("OpenLane stable capture merges network VIN in default Deep Capture mode without formal consent id", async () => {
  const networkObserver = require("../browser-extension/src/openlane-network-observer.js") as {
    startOpenLaneNetworkObserver: (settings: Record<string, unknown>, context?: Record<string, unknown>) => { enabled: boolean };
    stopOpenLaneNetworkObserver: () => void;
    rememberNetworkPayload: (body: unknown, url?: string, contentType?: string) => unknown;
  };
  const settings = {
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    deepCaptureEnabled: true,
    observePageNetworkData: true,
  };
  const href = "https://app.openlane.ca/vdp/KM8J3CA46HU123456";
  assert.equal(networkObserver.startOpenLaneNetworkObserver(settings, { href }).enabled, true);
  networkObserver.rememberNetworkPayload(
    JSON.stringify({ vehicle: { vin: "KM8J3CA46HU123456", carfaxUrl: "/vehicle-history/report/KM8J3CA46HU123456" } }),
    "https://app.openlane.ca/api/vdp/KM8J3CA46HU123456",
    "application/json",
  );

  const doc = fakeDocument("2017 Hyundai Tucson Odometer 111,486 KM Current Bid $4,600 23 total photos CARFAX Canada");
  doc.images = Array.from({ length: 23 }, () => ({}));
  const result = await stableCapture.extractStableOpenLaneListing(doc, href, settings, { delaysMs: [0], sleep: async () => undefined });

  assert.equal(result.listing.vin, "KM8J3CA46HU123456");
  assert.equal(result.readiness.readyToCapture, true);
  assert.equal(result.readiness.vinStatus, "found");
  assert.equal(result.listing.carfaxUrlStatus, "url_found");
  networkObserver.stopOpenLaneNetworkObserver();
});

test("OpenLane stable capture clears cache between route VIN changes", async () => {
  const doc = fakeDocument("2017 Hyundai Tucson VIN KM8J3CA46HU123456 Odometer 111,486 KM Current Bid $4,600 23 total photos");
  doc.images = Array.from({ length: 23 }, () => ({}));
  const first = await stableCapture.extractStableOpenLaneListing(doc, "https://app.openlane.ca/vdp/KM8J3CA46HU123456", {}, { delaysMs: [0], sleep: async () => undefined });

  setDocumentText(doc, "2020 Toyota Camry VIN 4T1G11AK8LU123456 Odometer 88,000 KM Current Bid $15,000 18 total photos");
  doc.images = Array.from({ length: 18 }, () => ({}));
  const second = await stableCapture.extractStableOpenLaneListing(doc, "https://app.openlane.ca/vdp/4T1G11AK8LU123456", {}, { delaysMs: [0], sleep: async () => undefined });

  assert.equal(first.listing.vin, "KM8J3CA46HU123456");
  assert.equal(second.listing.vin, "4T1G11AK8LU123456");
});

test("OpenLane stable capture reruns bounded bid stabilization when bid candidates conflict", async () => {
  const extractor = (globalThis as Record<string, { extractOpenLaneListing?: unknown }>).DealerFlowOpenLaneExtractor;
  const original = extractor.extractOpenLaneListing;
  let calls = 0;
  extractor.extractOpenLaneListing = () => {
    calls += 1;
    return calls === 1
      ? activeBidListing(8_500, [{ value: 10_300, sourceType: "section_map", sourceName: "section-map:bidPanel" }, { value: 8_500, sourceType: "active_bid_bar", sourceName: "section-map:activeBidBar" }], [{ value: 8_500, sourceType: "active_bid_bar" }])
      : activeBidListing(10_300, [{ value: 10_300, sourceType: "section_map", sourceName: "section-map:bidPanel" }], []);
  };
  try {
    const result = await stableCapture.extractStableOpenLaneListing(fakeDocument("OpenLane vehicle"), "https://app.openlane.ca/vdp/JM3KFBDM1L0123456", {}, {
      delaysMs: [],
      bidStabilizationDelaysMs: [0, 0],
      sleep: async () => undefined,
    });

    const metadata = (result.listing.openlaneMetadata as Record<string, Record<string, unknown>>).bidStabilization;
    assert.equal(result.listing.currentBid, 10_300);
    assert.equal(metadata.initialCurrentBid, 8_500);
    assert.equal(metadata.finalCurrentBid, 10_300);
    assert.equal(metadata.bidStabilizationAttempts, 1);
    assert.equal(metadata.stoppedReason, "bid_updated_after_stabilization");
  } finally {
    extractor.extractOpenLaneListing = original;
  }
});

test("OpenLane stable capture cancels bid stabilization on route change", async () => {
  const extractor = (globalThis as Record<string, { extractOpenLaneListing?: unknown }>).DealerFlowOpenLaneExtractor;
  const original = extractor.extractOpenLaneListing;
  let calls = 0;
  extractor.extractOpenLaneListing = () => {
    calls += 1;
    return activeBidListing(8_500, [{ value: 10_300, sourceType: "section_map", sourceName: "section-map:bidPanel" }, { value: 8_500, sourceType: "active_bid_bar", sourceName: "section-map:activeBidBar" }], [{ value: 8_500, sourceType: "active_bid_bar" }]);
  };
  try {
    const result = await stableCapture.extractStableOpenLaneListing(fakeDocument("OpenLane vehicle"), "https://app.openlane.ca/vdp/JM3KFBDM1L0123456", {}, {
      delaysMs: [],
      bidStabilizationDelaysMs: [0, 0],
      getHref: () => "https://app.openlane.ca/vdp/ROUTECHANGED12345",
      sleep: async () => undefined,
    });

    const metadata = (result.listing.openlaneMetadata as Record<string, Record<string, unknown>>).bidStabilization;
    assert.equal(result.listing.currentBid, 8_500);
    assert.equal(metadata.bidStabilizationAttempts, 0);
    assert.equal(metadata.stoppedReason, "route_changed");
    assert.equal(calls, 1);
  } finally {
    extractor.extractOpenLaneListing = original;
  }
});

test("OpenLane stable capture exposes safe helper functions", () => {
  const doc = {
    querySelectorAll: () => [
      fakeNode({ "data-vin": "KM8J3CA46HU123456", "data-token": "secret", "aria-label": "VIN KM8J3CA46HU123456" }, ""),
    ],
  };

  assert.equal(stableCapture.recoverVinFromUrl("https://app.openlane.ca/vdp/KM8J3CA46HU123456"), "KM8J3CA46HU123456");
  assert.equal(stableCapture.normalizeCarfaxStatus({ carfaxAvailable: true }), "text_only");
  assert.match(stableCapture.extractSafeDomAttributeText(doc), /KM8J3CA46HU123456/);
  assert.doesNotMatch(stableCapture.extractSafeDomAttributeText(doc), /secret/);
});

function fakeDocument(text: string) {
  return {
    title: "OpenLane",
    body: { innerText: text, textContent: text },
    images: [] as unknown[],
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function setDocumentText(doc: Record<string, unknown>, text: string) {
  (doc.body as { innerText: string; textContent: string }).innerText = text;
  (doc.body as { innerText: string; textContent: string }).textContent = text;
}

function fakeNode(attributes: Record<string, string>, textContent: string) {
  return {
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
    getAttribute: (name: string) => attributes[name] ?? null,
    innerText: textContent,
    textContent,
  };
}

function activeBidListing(currentBid: number, priceCandidates: Array<Record<string, unknown>>, staleCurrentBidCandidates: Array<Record<string, unknown>>) {
  return {
    sourceName: "OpenLane",
    pageType: "active_listing",
    captureKind: "observation",
    vin: "JM3KFBDM1L0123456",
    year: 2020,
    make: "Mazda",
    model: "CX-5",
    mileageKm: 74512,
    currentBid,
    listedPrice: currentBid,
    carfaxUrlStatus: "text_only",
    extractionConfidenceScore: 90,
    priceSemantics: { currentBid: "observation", listedPrice: "observation_alias_current_bid" },
    extractedFields: {
      currentBidEvidence: { sourceType: "section_map", sourceName: "section-map:bidPanel", sourceText: `Current bid $${currentBid}` },
      debug: {
        priceCandidates,
        staleCurrentBidCandidates,
      },
    },
  };
}
