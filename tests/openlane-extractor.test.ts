import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const extractor = require("../browser-extension/src/openlane-extractor.js") as {
  extractOpenLaneFixture: (html: string, href?: string) => Record<string, unknown>;
  isOpenLaneVehiclePage: (doc: { body?: { innerText?: string; textContent?: string }; images?: unknown[] }, href?: string) => boolean;
};

test("OpenLane extractor identifies supported vehicle pages", () => {
  const html = fixture("openlane-basic.html");
  const text = visibleText(html);

  assert.equal(extractor.isOpenLaneVehiclePage({ body: { innerText: text }, images: [{}, {}] }, "https://www.openlane.ca/vehicle/123"), true);
  assert.equal(extractor.isOpenLaneVehiclePage({ body: { innerText: "Search results" }, images: [] }, "https://www.openlane.ca/search"), false);
});

test("OpenLane extractor reads core auction fields from fixture HTML", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-basic.html"), "https://www.openlane.ca/vehicle/123");

  assert.equal(listing.vin, "2T3R1RFV5MW123456");
  assert.equal(listing.year, 2021);
  assert.equal(listing.make, "Toyota");
  assert.equal(listing.model, "RAV4");
  assert.equal(listing.trim, "XLE AWD");
  assert.equal(listing.mileageKm, 52300);
  assert.equal(listing.currentBid, 18500);
  assert.equal(listing.buyNowPrice, 22900);
  assert.equal(listing.location, "Toronto, ON");
  assert.equal(listing.province, "ON");
  assert.ok(Number(listing.extractionConfidenceScore) > 50);
});

test("OpenLane extractor captures Carfax, media, and normalized relative URLs", () => {
  const carfax = extractor.extractOpenLaneFixture(fixture("openlane-with-carfax.html"));
  const media = extractor.extractOpenLaneFixture(fixture("openlane-with-photos-videos.html"), "https://www.openlane.ca/vehicle/456");
  const photos = media.photos as Array<{ url: string; source?: string }>;
  const videos = media.videos as Array<{ url: string }>;

  assert.equal(carfax.carfaxUrl, "https://www.carfax.ca/report/ABC123");
  assert.equal(carfax.carfaxAvailable, true);
  assert.ok(photos.some((photo) => photo.url === "https://www.openlane.ca/photos/f150-front.jpg"));
  assert.ok(photos.some((photo) => photo.source === "picture"));
  assert.equal(new Set(photos.map((photo) => photo.url)).size, photos.length);
  assert.ok(videos.some((video) => video.url.includes("f150-walkaround.mp4")));
  assert.ok(videos.some((video) => video.url.includes("vimeo.com")));
});

test("OpenLane extractor captures condition reports and missing data", () => {
  const condition = extractor.extractOpenLaneFixture(fixture("openlane-condition-report.html"));
  const missing = extractor.extractOpenLaneFixture(fixture("openlane-missing-data.html"));

  assert.match(String(condition.conditionReportText), /Severe rust/);
  assert.match(String(condition.conditionReportText), /Transmission hesitation/);
  assert.ok((condition.declarations as string[]).some((item) => /Structural/i.test(item)));
  assert.ok((missing.missingData as string[]).includes("vin"));
  assert.ok((missing.missingData as string[]).includes("listedPrice"));
  assert.ok((missing.warnings as string[]).some((warning) => /Carfax/i.test(warning)));
});

function fixture(name: string) {
  return readFileSync(join(repoRoot, "tests/fixtures/openlane", name), "utf8");
}

function visibleText(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}
