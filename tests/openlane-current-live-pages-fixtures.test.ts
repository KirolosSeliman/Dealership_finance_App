import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const fixtureDir = join(process.cwd(), "tests/fixtures/openlane");

test("current live page fixtures preserve Toyota Corolla active listing evidence", () => {
  const html = fixture("openlane-vdp-corolla-carfax-visible-link-condition-pollution.html");
  const payload = JSON.parse(fixture("openlane-vdp-corolla-active-listing-no-purchase-outcome-evidence.json"));
  const bidHtml = fixture("openlane-vdp-corolla-currentbid-evidence-source.html");

  assert.match(html, /5YFB4RBE9LP030604/);
  assert.match(html, /Always view the CARFAX report/);
  assert.match(html, /href="\/vehicle-history\/carfax\/5YFB4RBE9LP030604"/);
  assert.match(html, /condition, or safety of any vehicle|OPENLANE does not guarantee/i);
  assert.match(html, /Transport estimate CAD \$428 \/ 185km/);
  assert.match(html, /Current bid[\s\S]*\$5,600/);

  assert.equal(payload.pageType, "active_listing");
  assert.equal(payload.captureKind, "observation");
  assert.equal(payload.vin, "5YFB4RBE9LP030604");
  assert.equal(payload.currentBid, 5_600);
  assert.match(JSON.stringify(payload.purchaseOutcome), /visible_page_text|Always view the CARFAX report/);
  assert.match(JSON.stringify(payload.auctionObservation), /legacy_flat_field/);

  assert.match(bidHtml, /data-testid="bid-panel-current"/);
  assert.match(bidHtml, /data-testid="sticky-current-bid"/);
  assert.match(bidHtml, /\$5,600/);
});

test("current live page fixtures preserve Kia purchase CARFAX link and sold-price evidence", () => {
  const html = fixture("openlane-vdp-kia-purchase-carfax-visible-link-sold-price.html");

  assert.match(html, /3KPFL4A72HE119966/);
  assert.match(html, /Sold price[\s\S]*\$4,000/);
  assert.match(html, /Mark as picked up/);
  assert.match(html, /Always view the CARFAX report/);
  assert.match(html, /href="\/vehicle-history\/carfax\/3KPFL4A72HE119966"/);
  assert.match(html, /Current bid \$31,500/);
  assert.match(html, /CAD \$378 \/ 211km/);
  assert.match(html, /15 Bids/);
});

test("current live page audit document exists", () => {
  const auditPath = join(process.cwd(), "docs/market-snap-current-live-pages-audit.md");
  assert.equal(existsSync(auditPath), true);
  const audit = readFileSync(auditPath, "utf8");
  for (const heading of [
    "Toyota Corolla Active Listing Evidence",
    "Kia Forte Purchase Detail Evidence",
    "Carfax Link Evidence",
    "Condition Pollution Evidence",
    "Active Listing PurchaseOutcome Evidence Bug",
    "CurrentBid Evidence Provenance Bug",
    "Root Cause Summary",
    "Fixture Plan",
    "Phase Plan",
  ]) {
    assert.match(audit, new RegExp(heading));
  }
});

function fixture(name: string) {
  return readFileSync(join(fixtureDir, name), "utf8");
}
