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

test("Phase 1 baseline locks Kia verified purchase outcome and noisy rejected prices", () => {
  const listing = extract(
    "openlane-vdp-kia-purchase-detail-cleanup-baseline.html",
    "https://app.openlane.ca/vdp/3KPFL4A72HE119966",
  );

  assert.equal(listing.pageType, "purchase_detail");
  assert.equal(listing.captureKind, "verified_outcome");
  assert.equal(listing.outcomeConfidence, "verified");
  assert.equal(listing.vin, "3KPFL4A72HE119966");
  assert.equal(listing.year, 2017);
  assert.equal(listing.make, "Kia");
  assert.equal(listing.model, "Forte");
  assert.equal(listing.trim, "4dr Sdn");
  assert.equal(listing.mileageKm, 158_569);
  assert.equal(listing.soldPriceCandidate, 4_000);
  assert.equal(listing.buyPriceAuction, 4_000);
  assert.notEqual(listing.currentBid, 31_500);
  assert.notEqual((listing.activeAuction as { currentBid?: number } | undefined)?.currentBid, 31_500);
  assert.equal((listing.purchaseOutcome as { soldPriceCandidate?: number; buyPriceAuction?: number } | undefined)?.soldPriceCandidate, 4_000);
  assert.equal((listing.purchaseOutcome as { soldPriceCandidate?: number; buyPriceAuction?: number } | undefined)?.buyPriceAuction, 4_000);
  assert.equal(listing.imageCount, 13);
  assert.equal(listing.videoCount, 1);
  assert.equal(listing.carfaxUrlStatus, "text_only");
  assert.equal(listing.carfaxUrl, undefined);

  const debugText = JSON.stringify((listing.extractedFields as { debug?: unknown }).debug || {});
  assert.match(debugText, /active_current_bid_not_purchase_outcome/i);
  assert.match(debugText, /transport_estimate_not_purchase_outcome/i);
  assert.match(debugText, /bid_count_not_purchase_outcome_price/i);
  assert.match(JSON.stringify((listing.purchaseOutcome as { rejectedCandidates?: unknown[] } | undefined)?.rejectedCandidates || []), /\$31,500|31500/);
  assert.match(JSON.stringify((listing.purchaseOutcome as { rejectedCandidates?: unknown[] } | undefined)?.rejectedCandidates || []), /CAD \$378|378/);
  assert.match(JSON.stringify((listing.purchaseOutcome as { rejectedCandidates?: unknown[] } | undefined)?.rejectedCandidates || []), /15 Bids|15/);
});

test("Phase 1 baseline records Lexus active bid conflict and fresh bid-panel winner", () => {
  const listing = extract(
    "openlane-vdp-lexus-active-bid-conflict-baseline.html",
    "https://app.openlane.ca/vdp/JTJBARBZ7H2120574",
  );
  const fields = listing.extractedFields as {
    currentBidEvidence?: { sourceType?: string; sourceName?: string; sourceText?: string; selectionReason?: string };
    debug?: {
      currentBidDiagnostics?: {
        selectionReason?: string;
        bidPanelTopCandidate?: { value?: number; sourceText?: string };
        supersededActiveBidBarCandidate?: { value?: number; sourceType?: string; sourceText?: string };
      };
      currentBidCandidates?: Array<{ value?: number; sourceType?: string; sourceName?: string; sourceText?: string; freshnessScore?: number }>;
      staleCurrentBidCandidates?: Array<{ value?: number; sourceType?: string; sourceName?: string; rejectedReason?: string }>;
    };
  };

  assert.equal(listing.pageType, "active_listing");
  assert.equal(listing.captureKind, "observation");
  assert.equal(listing.vin, "JTJBARBZ7H2120574");
  assert.equal(listing.year, 2017);
  assert.equal(listing.make, "Lexus");
  assert.equal(listing.model, "NX");
  assert.equal(listing.trim, "200t");
  assert.equal(listing.mileageKm, 154_000);
  assert.equal(listing.currentBid, 13_200);
  assert.equal(listing.listedPrice, 13_200);
  assert.match(String(fields.currentBidEvidence?.sourceName || fields.currentBidEvidence?.sourceType || ""), /bidPanel|section_map/i);
  assert.equal(fields.currentBidEvidence?.selectionReason, "fresh_bid_panel_supersedes_lower_active_bid_bar");
  assert.equal(fields.debug?.currentBidDiagnostics?.selectionReason, "fresh_bid_panel_supersedes_lower_active_bid_bar");
  assert.equal(fields.debug?.currentBidDiagnostics?.bidPanelTopCandidate?.value, 13_200);
  assert.equal(fields.debug?.currentBidDiagnostics?.supersededActiveBidBarCandidate?.value, 13_100);
  assert.match(String(fields.currentBidEvidence?.sourceText), /Under 1 min/i);
  assert.ok((fields.debug?.staleCurrentBidCandidates || []).some((item) => item.value === 13_100 && item.sourceType === "active_bid_bar"));
});

test("Phase 1 baseline preserves raw pollution evidence for later canonical cleanup assertions", () => {
  const kiaHtml = fixture("openlane-vdp-kia-purchase-detail-cleanup-baseline.html");
  const lexusHtml = fixture("openlane-vdp-lexus-active-bid-conflict-baseline.html");
  const combinedRawFixtureText = `${kiaHtml}\n${lexusHtml}`;

  assert.match(combinedRawFixtureText, /condition, or safety of any vehicle\./i);
  assert.match(combinedRawFixtureText, />me</i);
  assert.match(combinedRawFixtureText, />g</i);
  assert.match(combinedRawFixtureText, /Expected May 22, 2026/i);
  assert.match(combinedRawFixtureText, /ZUMA MOTORS/i);
  assert.match(combinedRawFixtureText, /Transport estimate CAD \$428 \/ 185km/i);
});

function extract(name: string, href: string) {
  return extractor.extractOpenLaneFixture(fixture(name), href);
}

function fixture(name: string) {
  return readFileSync(join(repoRoot, "tests/fixtures/openlane", name), "utf8");
}
