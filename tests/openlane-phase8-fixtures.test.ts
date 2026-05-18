import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
require("../browser-extension/src/openlane-extraction-contract.js");
require("../browser-extension/src/openlane-section-map.js");
require("../browser-extension/src/openlane-page-classifier.js");
require("../browser-extension/src/openlane-network-observer.js");
require("../browser-extension/src/openlane-safe-expander.js");
require("../browser-extension/src/openlane-extractor.js");

const extractor = require("../browser-extension/src/openlane-extractor.js") as {
  extractOpenLaneFixture: (html: string, href?: string) => Record<string, unknown>;
};
const stableCapture = require("../browser-extension/src/openlane-stable-capture.js") as {
  extractStableOpenLaneListing: (doc: Record<string, unknown>, href: string, settings: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{
    listing: Record<string, unknown>;
    readiness: { readyToCapture: boolean; state: string; blockedReason?: string; vinStatus: string; carfaxStatus: string; missingData: string[] };
  }>;
};
const networkObserver = require("../browser-extension/src/openlane-network-observer.js") as {
  extractCandidatesFromNetworkPayload: (payload: unknown, url?: string) => {
    fieldCandidates: Array<{ field: string; value: unknown }>;
    vinCandidates: Array<{ vin: string }>;
    sanitizedKeys: string[];
  };
  sanitizeNetworkPayload: (payload: unknown) => unknown;
  mergeNetworkEvidenceIntoListing: (listing: Record<string, unknown>, evidence: unknown[]) => Record<string, unknown>;
};

test("Phase 8 fixtures protect VIN extraction sources and invalid VIN rejection", () => {
  const visibleVin = extractor.extractOpenLaneFixture(fixture("openlane-basic.html"), "https://app.openlane.ca/vdp/visible");
  const urlOnlyVin = extractor.extractOpenLaneFixture(fixture("openlane-vdp-vin-in-url-only.html"), "https://app.openlane.ca/vdp/3KPFL4A72HE119966");
  const attributeVin = extractor.extractOpenLaneFixture(fixture("openlane-vdp-vin-data-attribute-only.html"), "https://app.openlane.ca/vdp/data-attribute");
  const invalidVin = extractor.extractOpenLaneFixture(fixture("openlane-invalid-vin.html"), "https://app.openlane.ca/vdp/invalid-vin");
  const networkPayload = JSON.parse(fixture("openlane-network-carfax-response.json"));
  const networkCandidates = networkObserver.extractCandidatesFromNetworkPayload(networkPayload, "https://app.openlane.ca/api/vdp/KM8J3CA46HU123456");

  assert.equal(visibleVin.vin, "2T3R1RFV5MW123456");
  assert.ok(((visibleVin.fieldEvidence as { vin?: unknown[] }).vin || []).length > 0);
  assert.ok(((visibleVin.extractedFields as { debug?: { vinCandidates?: unknown[] } }).debug?.vinCandidates || []).length > 0);
  assert.equal(urlOnlyVin.vin, "3KPFL4A72HE119966");
  assert.match(String(((urlOnlyVin.fieldEvidence as { vin?: Array<{ sourceText?: string }> }).vin || [])[0]?.sourceText || ""), /3KPFL4A72HE119966/);
  assert.equal(attributeVin.vin, "3KPFL4A72HE119966");
  assert.ok(((attributeVin.fieldEvidence as { vin?: Array<{ sourceType?: string }> }).vin || []).some((item) => item.sourceType === "dom_attribute"));
  assert.equal(networkCandidates.vinCandidates[0]?.vin, "KM8J3CA46HU123456");
  assert.equal(invalidVin.vin, undefined);
  assert.ok((invalidVin.missingData as string[]).includes("vin"));
});

test("Phase 8 fixtures protect CARFAX URL, text-only, missing, and network evidence paths", () => {
  const direct = extractor.extractOpenLaneFixture(fixture("openlane-carfax-url.html"), "https://app.openlane.ca/vdp/rav4");
  const dataHref = extractor.extractOpenLaneFixture(fixture("openlane-carfax-data-href.html"), "https://app.openlane.ca/vdp/hyundai-tucson");
  const dataUrl = extractor.extractOpenLaneFixture(fixture("openlane-carfax-data-url.html"), "https://app.openlane.ca/vdp/hyundai-tucson");
  const textOnly = extractor.extractOpenLaneFixture(fixture("openlane-carfax-text-only.html"), "https://app.openlane.ca/vdp/hyundai-tucson");
  const missing = extractor.extractOpenLaneFixture(fixture("openlane-no-carfax.html"), "https://app.openlane.ca/vdp/hyundai-tucson");
  const networkPayload = JSON.parse(fixture("openlane-network-carfax-response.json"));
  const candidates = networkObserver.extractCandidatesFromNetworkPayload(networkPayload, "https://app.openlane.ca/api/vdp/KM8J3CA46HU123456");
  const merged = networkObserver.mergeNetworkEvidenceIntoListing({
    sourceName: "OpenLane",
    listingUrl: "https://app.openlane.ca/vdp/KM8J3CA46HU123456",
    captureKind: "observation",
    pageType: "active_listing",
  }, [{ endpointPattern: "app.openlane.ca/api/vdp/:id", capturedAt: "2026-05-18T12:00:00.000Z", sanitizedKeys: candidates.sanitizedKeys, candidates }]);
  const sanitized = JSON.stringify(networkObserver.sanitizeNetworkPayload(networkPayload));

  assert.equal(direct.carfaxUrlStatus, "url_found");
  assert.match(String(direct.carfaxUrl), /carfax/i);
  assert.equal(dataHref.carfaxUrl, "https://app.openlane.ca/reports/carfax/TUCSON123");
  assert.equal(dataUrl.carfaxUrl, "https://app.openlane.ca/vehicle-history/carfax/TUCSON456");
  assert.equal(textOnly.carfaxUrlStatus, "text_only");
  assert.equal(textOnly.carfaxUrl, undefined);
  assert.equal(missing.carfaxUrlStatus, "missing");
  assert.equal(missing.carfaxUrl, undefined);
  assert.equal(merged.carfaxUrl, "https://app.openlane.ca/vehicle-history/carfax/TUCSON999");
  assert.equal(merged.carfaxUrlStatus, "url_found");
  assert.ok(((merged.fieldEvidence as { carfaxUrl?: Array<{ sourceType?: string }> }).carfaxUrl || []).some((item) => item.sourceType === "network_json"));
  assert.ok(((merged.fieldEvidence as { vin?: Array<{ sourceType?: string }> }).vin || []).some((item) => item.sourceType === "network_json"));
  assert.doesNotMatch(sanitized, /Bearer should-not-appear|session=secret|buyer@example\.com|eyJaaaaaaaa/i);
});

test("Phase 8 fixtures protect SPA readiness and route-change cache clearing", async () => {
  const shellDoc = fakeDocument(fixture("openlane-spa-loading-shell.html"));
  const shell = await stableCapture.extractStableOpenLaneListing(shellDoc, "https://app.openlane.ca/vdp/loading", {}, { delaysMs: [0], sleep: async () => undefined });

  const delayedDoc = fakeDocument(fixture("openlane-spa-loading-shell.html"));
  let sleeps = 0;
  const loaded = await stableCapture.extractStableOpenLaneListing(delayedDoc, "https://app.openlane.ca/vdp/KM8J3CA46HU123456", {}, {
    delaysMs: [0, 1],
    sleep: async () => {
      sleeps += 1;
      if (sleeps === 1) setDocumentHtml(delayedDoc, fixture("openlane-route-change-a.html"));
    },
  });

  const routeDoc = fakeDocument(fixture("openlane-route-change-a.html"));
  const first = await stableCapture.extractStableOpenLaneListing(routeDoc, "https://app.openlane.ca/vdp/KM8J3CA46HU123456", {}, { delaysMs: [0], sleep: async () => undefined });
  setDocumentHtml(routeDoc, fixture("openlane-route-change-b.html"));
  const second = await stableCapture.extractStableOpenLaneListing(routeDoc, "https://app.openlane.ca/vdp/4T1G11AK8LU123456", {}, { delaysMs: [0], sleep: async () => undefined });

  assert.equal(shell.readiness.readyToCapture, false);
  assert.equal(shell.readiness.state, "unsupported_page");
  assert.equal((shell.listing.openlaneMetadata as { stableCaptureReadiness?: { readyToCapture?: boolean; state?: string } }).stableCaptureReadiness?.readyToCapture, false);
  assert.equal(loaded.readiness.readyToCapture, true);
  assert.equal(loaded.listing.vin, "KM8J3CA46HU123456");
  assert.equal((loaded.listing.openlaneMetadata as { stableCaptureReadiness?: { readyToCapture?: boolean; vinStatus?: string } }).stableCaptureReadiness?.readyToCapture, true);
  assert.equal((loaded.listing.openlaneMetadata as { stableCaptureReadiness?: { vinStatus?: string } }).stableCaptureReadiness?.vinStatus, "found");
  assert.equal(first.listing.vin, "KM8J3CA46HU123456");
  assert.equal(second.listing.vin, "4T1G11AK8LU123456");
  assert.equal((second.listing.openlaneMetadata as { stableCaptureReadiness?: { readyToCapture?: boolean } }).stableCaptureReadiness?.readyToCapture, true);
});

test("Phase 8 fixtures protect active observation and post-sale outcome semantics", () => {
  const activeBid = extractor.extractOpenLaneFixture(fixture("openlane-vdp-active-en.html"), "https://app.openlane.ca/vdp/silverado?tab=active");
  const activeOffer = extractor.extractOpenLaneFixture(fixture("openlane-vdp-active-fr-touareg.html"), "https://app.openlane.ca/vdp/touareg?tab=active");
  const accepted = extractor.extractOpenLaneFixture(fixture("openlane-post-sale-accepted.html"), "https://app.openlane.ca/post-sale/camry");
  const pending = extractor.extractOpenLaneFixture(fixture("openlane-post-sale-pending.html"), "https://app.openlane.ca/post-sale/camry");
  const rejected = extractor.extractOpenLaneFixture(fixture("openlane-post-sale-rejected.html"), "https://app.openlane.ca/post-sale/civic");

  assert.equal(activeBid.captureKind, "observation");
  assert.equal(activeBid.currentBid, 50_700);
  assert.equal(activeBid.finalBidAmount, undefined);
  assert.equal(activeOffer.captureKind, "observation");
  assert.equal(activeOffer.currentOffer, 6500);
  assert.equal(activeOffer.finalBidAmount, undefined);
  assert.equal(accepted.captureKind, "verified_outcome");
  assert.equal(accepted.outcomeEvidence && Array.isArray(accepted.outcomeEvidence), true);
  assert.equal(accepted.finalBidAmount, 17_900);
  assert.equal(pending.captureKind, "candidate_outcome");
  assert.equal(pending.finalBidAmount, undefined);
  assert.equal(rejected.captureKind, "candidate_outcome");
  assert.equal(rejected.finalBidAmount, undefined);
});

test("Phase 8 widget debug contract includes capture readiness state", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");

  for (const marker of ["readinessSummary", "readyToCapture", "readinessState", "blockedReason", "vinStatus", "carfaxStatus"]) {
    assert.match(contentScript, new RegExp(marker));
  }
  for (const marker of ["Readiness", "Capture blocked reason", "VIN status", "Carfax status"]) {
    assert.match(widget, new RegExp(marker));
  }
});

function fixture(name: string) {
  return readFileSync(join(repoRoot, "tests/fixtures/openlane", name), "utf8");
}

function fakeDocument(html: string) {
  const text = visibleText(html);
  return {
    title: "OpenLane",
    body: { innerText: text, textContent: text },
    images: Array.from({ length: imageCount(html) }, () => ({})),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function setDocumentHtml(doc: Record<string, unknown>, html: string) {
  const text = visibleText(html);
  (doc.body as { innerText: string; textContent: string }).innerText = text;
  (doc.body as { innerText: string; textContent: string }).textContent = text;
  doc.images = Array.from({ length: imageCount(html) }, () => ({}));
}

function visibleText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function imageCount(html: string) {
  return html.match(/<img\b/gi)?.length ?? 0;
}
