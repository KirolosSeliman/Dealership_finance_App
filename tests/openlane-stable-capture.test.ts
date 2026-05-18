import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
require("../browser-extension/src/openlane-extraction-contract.js");
require("../browser-extension/src/openlane-section-map.js");
require("../browser-extension/src/openlane-page-classifier.js");
require("../browser-extension/src/openlane-network-observer.js");
require("../browser-extension/src/openlane-safe-expander.js");
require("../browser-extension/src/openlane-extractor.js");

const stableCapture = require("../browser-extension/src/openlane-stable-capture.js") as {
  extractStableOpenLaneListing: (doc: Record<string, unknown>, href: string, settings: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{
    listing: Record<string, unknown>;
    readiness: { readyToCapture: boolean; state: string; vinStatus: string; carfaxStatus: string; attempts: number; missingData: string[] };
  }>;
  evaluateOpenLaneReadiness: (listing: Record<string, unknown>, classifier: Record<string, unknown>, options?: Record<string, unknown>) => {
    readyToCapture: boolean;
    state: string;
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
