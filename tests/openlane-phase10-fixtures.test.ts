import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { marketListingPayloadSchema } from "../src/lib/market-snap/validation";

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
const networkObserver = require("../browser-extension/src/openlane-network-observer.js") as {
  extractCandidatesFromNetworkPayload: (payload: unknown, url?: string) => {
    sanitizedKeys: string[];
    fieldCandidates: Array<{ field: string; value: unknown }>;
  };
  mergeNetworkEvidenceIntoListing: (listing: Record<string, unknown>, evidence: unknown[]) => Record<string, unknown>;
};

const organizationId = "63c47786-fb41-40c1-a573-71346969b9e0";

test("Phase 10 live OpenLane fixture matrix locks purchase outcome and active bid regressions", () => {
  const kia = extract("openlane-vdp-kia-purchase-sold-price-picked-up.html", "https://app.openlane.ca/vdp/3KPFK4A77HE123456");
  const mazda = extract("openlane-vdp-mazda-stale-bidbar-fresh-bidpanel.html", "https://app.openlane.ca/vdp/JM3KFBDM1L0123456");
  const camry = extract("openlane-vdp-camry-highest-proxy-lower-row.html", "https://app.openlane.ca/vdp/4T1G11AK8LU123456");
  const stinger = extract("openlane-vdp-stinger-bid-count-vs-current-bid.html", "https://app.openlane.ca/vdp/KNAE55LC7J6040713");
  const hyundai = extract("openlane-vdp-hyundai-qa-condition-pollution.html", "https://app.openlane.ca/vdp/KM8J3CA46HU123456");
  const pickupInstructions = extract("openlane-vdp-active-pickup-instructions-not-purchase.html", "https://app.openlane.ca/vdp/pickup-note");

  assert.equal(kia.pageType, "purchase_detail");
  assert.equal(kia.captureKind, "verified_outcome");
  assert.equal(kia.soldPriceCandidate, 4_000);
  assert.equal(kia.buyPriceAuction, 4_000);
  assert.match(JSON.stringify(kia.outcomeEvidence), /Mark as picked up|Sold price/i);

  assert.equal(mazda.captureKind, "observation");
  assert.equal(mazda.currentBid, 10_300);
  assert.notEqual(mazda.currentBid, 8_500);
  assert.ok(((mazda.extractedFields as { debug?: { staleCurrentBidCandidates?: Array<{ value?: number }> } }).debug?.staleCurrentBidCandidates || []).some((item) => item.value === 8_500));

  assert.equal(camry.currentBid, 21_000);
  assert.notEqual(camry.currentBid, 11_100);
  assert.notEqual(camry.currentBid, 2);

  assert.equal(stinger.currentBid, 13_700);
  assert.notEqual(stinger.currentBid, 4);

  assert.equal(hyundai.currentBid, 5_100);
  assert.notEqual(hyundai.currentBid, 29);
  assert.equal(hyundai.engine, undefined);
  assert.equal(hyundai.transmission, undefined);

  assert.equal(pickupInstructions.pageType, "active_listing");
  assert.equal(pickupInstructions.captureKind, "observation");
  assert.equal(pickupInstructions.soldPriceCandidate, undefined);
  assert.ok(((pickupInstructions.openlaneMetadata as { classification?: { ignoredEvidence?: Array<{ marker?: string; sourceText?: string }> } }).classification?.ignoredEvidence || [])
    .some((item) => item.marker === "rejected_purchase_marker" && /pickup/i.test(String(item.sourceText))));
});

test("Phase 10 condition and Carfax fixtures keep debug truth without unsafe promotion", () => {
  const hyundai = extract("openlane-vdp-hyundai-qa-condition-pollution.html", "https://app.openlane.ca/vdp/KM8J3CA46HU123456");
  const textOnly = extract("openlane-vdp-carfax-text-only.html", "https://app.openlane.ca/vdp/3KPFK4A77HE123456");
  const router = extract("openlane-router-carfax-url.html", "https://app.openlane.ca/vdp/KNAE55LC7J6040713");
  const networkPayload = JSON.parse(fixture("openlane-network-carfax-url.json"));
  const networkCandidates = networkObserver.extractCandidatesFromNetworkPayload(networkPayload, "https://app.openlane.ca/api/vdp/3KPFK4A77HE123456");
  const networkMerged = networkObserver.mergeNetworkEvidenceIntoListing({
    sourceName: "OpenLane",
    pageType: "active_listing",
    captureKind: "observation",
    listingUrl: "https://app.openlane.ca/vdp/3KPFK4A77HE123456",
  }, [{ endpointPattern: "app.openlane.ca/api/vdp/:id", capturedAt: "2026-05-18T12:00:00.000Z", sanitizedKeys: networkCandidates.sanitizedKeys, candidates: networkCandidates }]);

  const conditionDetails = (hyundai.openlaneMetadata as {
    conditionDetails?: {
      conditionReportText?: string;
      knownHistoryItems?: string[];
      mechanicalDisclosures?: string[];
      exteriorDisclosures?: string[];
      interiorDisclosures?: string[];
      tireWheelDisclosures?: string[];
      safetyDisclosures?: string[];
      qaSummary?: string;
    };
  }).conditionDetails || {};
  const canonicalConditionText = JSON.stringify({
    conditionReportText: conditionDetails.conditionReportText,
    knownHistoryItems: conditionDetails.knownHistoryItems,
    mechanicalDisclosures: conditionDetails.mechanicalDisclosures,
    exteriorDisclosures: conditionDetails.exteriorDisclosures,
    interiorDisclosures: conditionDetails.interiorDisclosures,
    tireWheelDisclosures: conditionDetails.tireWheelDisclosures,
    safetyDisclosures: conditionDetails.safetyDisclosures,
  });
  assert.doesNotMatch(canonicalConditionText, /Full bid history|29 Bids|Transport estimate|OPENLANE Inc\. All rights reserved/i);
  assert.match(String(conditionDetails.qaSummary), /Engine and transmission are good/i);
  assert.equal(hyundai.engine, undefined);
  assert.equal(hyundai.transmission, undefined);

  assert.equal(textOnly.carfaxUrlStatus, "text_only");
  assert.equal(textOnly.carfaxUrl, undefined);
  assert.equal(router.carfaxUrlStatus, "url_found");
  assert.match(String(router.carfaxUrl), /vehicle-history\/carfax\/STINGER123/i);
  assert.equal(networkMerged.carfaxUrlStatus, "url_found");
  assert.match(String(networkMerged.carfaxUrl), /vehicle-history\/carfax\/FORTE123/i);
});

test("Phase 10 backend rejects polluted price and outcome evidence while allowing clean Kia outcome", () => {
  const cleanKia = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "purchase_detail",
    captureKind: "verified_outcome",
    title: "2017 Kia Forte",
    year: 2017,
    make: "Kia",
    model: "Forte",
    vin: "3KPFK4A77HE123456",
    soldPriceCandidate: 4_000,
    buyPriceAuction: 4_000,
    outcomeConfidence: "verified",
    outcomeEvidence: [{
      evidenceType: "purchase_document",
      sourceText: "Order history Sold price $4,000 Mark as picked up",
      capturedAt: "2026-05-18T12:00:00.000Z",
      confidenceScore: 96,
    }],
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
      buyPriceAuction: "verified_wholesale_label",
    },
  });
  const activeOutcome = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    currentBid: 5_100,
    soldPriceCandidate: 4_000,
    priceSemantics: { currentBid: "observation", soldPriceCandidate: "candidate_wholesale_label" },
  });
  const badBidCount = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    currentBid: 59,
    priceSemantics: { currentBid: "observation" },
    fieldEvidence: {
      currentBid: [{
        field: "currentBid",
        value: 59,
        normalizedValue: 59,
        sourceType: "section_map",
        sourceText: "59 Bids",
        confidenceScore: 72,
        capturedAt: "2026-05-18T12:00:00.000Z",
      }],
    },
  });

  assert.equal(cleanKia.success, true);
  assert.equal(activeOutcome.success, false);
  assert.equal(badBidCount.success, false);
});

function extract(name: string, href: string) {
  return extractor.extractOpenLaneFixture(fixture(name), href);
}

function fixture(name: string) {
  return readFileSync(join(repoRoot, "tests/fixtures/openlane", name), "utf8");
}
