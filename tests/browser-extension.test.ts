import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const openLaneExtractor = require("../browser-extension/src/openlane-extractor.js") as {
  extractOpenLaneFixture: (html: string, href?: string) => Record<string, unknown>;
  extractVisibleText: (doc: { body?: { innerText?: string; textContent?: string } }) => string;
};
const { extractOpenLaneFixture } = openLaneExtractor;

test("Market Snap extension injects on OpenLane Canada vehicle pages", () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "browser-extension/manifest.json"), "utf8"));
  const matches = manifest.content_scripts.flatMap((script: { matches: string[] }) => script.matches);
  const scripts = manifest.content_scripts.flatMap((script: { js: string[] }) => script.js);
  const css = manifest.content_scripts.flatMap((script: { css?: string[] }) => script.css ?? []);

  assert.ok(matches.includes("https://*.openlane.ca/*"));
  assert.ok(matches.includes("https://*.openlane.com/*"));
  assert.ok(scripts.includes("src/storage.js"));
  assert.ok(scripts.includes("src/api-client.js"));
  assert.ok(scripts.includes("src/openlane-extractor.js"));
  assert.ok(scripts.includes("src/market-snap-widget.js"));
  assert.ok(scripts.includes("src/content-script.js"));
  assert.ok(css.includes("styles/widget.css"));
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("webRequest"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);
});

test("Market Snap extension uses in-page OpenLane widget instead of popup-only analysis", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");

  assert.match(contentScript, /MutationObserver/);
  assert.match(contentScript, /createMarketSnapWidget/);
  assert.match(contentScript, /MARKET_SNAP_ANALYZE/);
  assert.match(widget, /dealer-flow-market-snap-widget/);
  assert.match(widget, /Wholesale sell/);
  assert.match(widget, /Max bid/);
  assert.match(widget, /Copy JSON/);
  assert.match(widget, /attachShadow/);
});

test("Market Snap analyze and save routes support extension CORS preflight", () => {
  const analyzeRoute = readFileSync(join(repoRoot, "src/app/api/market-snap/analyze-listing/route.ts"), "utf8");
  const saveRoute = readFileSync(join(repoRoot, "src/app/api/market-snap/save-listing/route.ts"), "utf8");
  const api = readFileSync(join(repoRoot, "src/lib/server/market-snap-api.ts"), "utf8");

  assert.match(analyzeRoute, /OPTIONS = marketSnapOptions/);
  assert.match(saveRoute, /OPTIONS = marketSnapOptions/);
  assert.match(api, /MARKET_SNAP_EXTENSION_ORIGINS/);
  assert.match(api, /access-control-allow-credentials/);
  assert.match(api, /requireOrganizationRole/);
});

test("Market Snap repository persists OpenLane media and Carfax metadata", () => {
  const repository = readFileSync(join(repoRoot, "src/lib/market-snap/repository.ts"), "utf8");
  const migration = readFileSync(join(repoRoot, "supabase/migrations/20260522_openlane_extension_payload.sql"), "utf8");

  for (const field of ["carfax_url", "photos_json", "videos_json", "openlane_metadata", "extraction_confidence_score", "raw_visible_text"]) {
    assert.match(repository, new RegExp(field));
    assert.match(migration, new RegExp(`add column if not exists ${field}`));
  }
});

test("OpenLane extractor captures core vehicle, price, and auction fields", () => {
  const html = readFileSync(join(repoRoot, "tests/fixtures/openlane/openlane-basic.html"), "utf8");
  const listing = extractOpenLaneFixture(html);

  assert.equal(listing.sourceName, "OpenLane");
  assert.equal(listing.sourceType, "auction");
  assert.equal(listing.marketType, "auction_market");
  assert.equal(listing.vin, "2T3R1RFV5MW123456");
  assert.equal(listing.year, 2021);
  assert.equal(listing.make, "Toyota");
  assert.equal(listing.model, "RAV4");
  assert.equal(listing.mileageKm, 52300);
  assert.equal(listing.currentBid, 18500);
  assert.equal(listing.buyNowPrice, 22900);
  assert.equal(listing.listedPrice, 22900);
  assert.equal(listing.runNumber, "42");
  assert.equal(listing.lane, "A");
  assert.equal(listing.imageCount, 1);
});

test("OpenLane extractor exposes the dedicated helper contract", () => {
  for (const helper of [
    "extractOpenLaneListing",
    "isOpenLaneVehiclePage",
    "extractVisibleText",
    "extractLabelValueMap",
    "extractMoneyByLabels",
    "extractMileage",
    "extractVin",
    "extractYearMakeModelTrim",
    "extractCarfaxLink",
    "extractPhotos",
    "extractVideos",
    "normalizeAbsoluteUrl",
    "dedupeMedia",
    "calculateExtractionConfidence",
    "buildMissingData",
  ]) {
    assert.equal(typeof openLaneExtractor[helper], "function", `${helper} should be exported`);
  }
});

test("OpenLane extractor caps raw visible text at the prompt limit", () => {
  const longText = `2022 Honda Civic VIN 2HGFE2F52NH123456 Mileage 41000 km Buy Now $21000 ${"x".repeat(14000)}`;
  const text = openLaneExtractor.extractVisibleText({ body: { innerText: longText } });

  assert.equal(text.length, 12000);
});

test("OpenLane extractor captures visible Carfax links without fetching reports", () => {
  const html = readFileSync(join(repoRoot, "tests/fixtures/openlane/openlane-with-carfax.html"), "utf8");
  const listing = extractOpenLaneFixture(html);

  assert.equal(listing.carfaxAvailable, true);
  assert.equal(listing.carfaxUrl, "https://www.carfax.ca/report/ABC123");
  assert.match(String(listing.conditionReportText), /Minor scratches/);
});

test("OpenLane extractor captures and deduplicates visible photos and videos", () => {
  const html = readFileSync(join(repoRoot, "tests/fixtures/openlane/openlane-with-photos-videos.html"), "utf8");
  const listing = extractOpenLaneFixture(html);

  assert.ok(Array.isArray(listing.photos));
  assert.ok(Array.isArray(listing.videos));
  assert.ok(Number(listing.imageCount) >= 3);
  assert.ok(Number(listing.videoCount) >= 2);
  assert.ok((listing.photos as Array<{ url: string }>).some((photo) => photo.url.endsWith("/photos/f150-front.jpg")));
  assert.ok((listing.photos as Array<{ source?: string }>).some((photo) => photo.source === "picture"));
  assert.ok((listing.videos as Array<{ url: string }>).some((video) => video.url.includes("f150-walkaround.mp4")));
});

test("OpenLane extractor reports missing price instead of inventing one", () => {
  const html = readFileSync(join(repoRoot, "tests/fixtures/openlane/openlane-missing-price.html"), "utf8");
  const listing = extractOpenLaneFixture(html);

  assert.equal(listing.listedPrice, undefined);
  assert.ok((listing.missingData as string[]).includes("listedPrice"));
});

test("OpenLane extractor feeds condition report and announcements into payload", () => {
  const html = readFileSync(join(repoRoot, "tests/fixtures/openlane/openlane-condition-report.html"), "utf8");
  const listing = extractOpenLaneFixture(html);

  assert.match(String(listing.conditionReportText), /Severe rust/);
  assert.match(String(listing.conditionReportText), /Transmission hesitation/);
  assert.ok((listing.declarations as string[]).some((item) => /Structural/i.test(item)));
});
