import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
require("../browser-extension/src/openlane-extraction-contract.js");
const sectionMap = require("../browser-extension/src/openlane-section-map.js") as {
  buildOpenLaneSectionMapFromHtml: (html: string, href?: string) => {
    mainText: string;
    ignoredEvidence: Array<{ marker: string; zone?: string; sourceText?: string }>;
    zones: Record<string, { text?: string; ignored?: boolean; evidence?: unknown[] }>;
  };
  clearOpenLaneExtractionCache: (doc: Record<string, unknown>) => void;
};
const classifier = require("../browser-extension/src/openlane-page-classifier.js") as {
  classifyOpenLanePageFromHtml: (html: string, href?: string) => {
    pageType: string;
    captureKind: string;
    confidenceScore: number;
    evidence: Array<{ marker: string }>;
    warnings: string[];
  };
  classifyOpenLanePage: (doc: Record<string, unknown>, href?: string) => {
    pageType: string;
    evidence: Array<{ marker: string }>;
  };
};
const extractor = require("../browser-extension/src/openlane-extractor.js") as {
  extractOpenLaneListing: (doc: Record<string, unknown>, href?: string) => Record<string, unknown>;
  extractOpenLaneFixture: (html: string, href?: string) => Record<string, unknown>;
  isOpenLaneVehiclePage: (doc: { body?: { innerText?: string; textContent?: string }; images?: unknown[] }, href?: string) => boolean;
};
const networkObserver = require("../browser-extension/src/openlane-network-observer.js") as {
  extractCandidatesFromNetworkPayload: (payload: unknown, url?: string) => {
    fieldCandidates: Array<{ field: string; value: unknown }>;
    vinCandidates: Array<{ vin: string }>;
    mediaCandidates: Array<{ url: string }>;
    conditionCandidates: Array<{ text: string }>;
    transportCandidates: Array<{ field: string; value: unknown }>;
    sanitizedKeys: string[];
  };
  sanitizeNetworkPayload: (payload: unknown) => unknown;
  mergeNetworkEvidenceIntoListing: (listing: Record<string, unknown>, evidence: unknown[]) => Record<string, unknown>;
};

test("OpenLane extractor identifies supported vehicle pages", () => {
  const html = fixture("openlane-basic.html");
  const text = visibleText(html);

  assert.equal(extractor.isOpenLaneVehiclePage({ body: { innerText: text }, images: [{}, {}] }, "https://www.openlane.ca/vehicle/123"), true);
  assert.equal(extractor.isOpenLaneVehiclePage({ body: { innerText: "Search results" }, images: [] }, "https://www.openlane.ca/search"), false);
});

test("OpenLane public homepage is not widget eligible even with generic vehicle marketing text", () => {
  const homepageText = "Accueil Browse inventory 2021 Toyota RAV4 Current Bid $18,500 photos Search vehicles";

  assert.equal(
    extractor.isOpenLaneVehiclePage({ body: { innerText: homepageText, textContent: homepageText }, images: [{}, {}, {}] }, "https://openlane.ca/en/"),
    false,
  );
});

test("OpenLane extraction cache can be cleared when a dynamic VDP shell loads vehicle content", () => {
  const doc = fakeDocument("Loading OpenLane application...");
  const href = "https://app.openlane.ca/vdp/3KPFL4A72HE119966";

  assert.equal(classifier.classifyOpenLanePage(doc, href).pageType, "unknown");
  doc.body.innerText = "2017 Kia Forte 4dr Sdn. VIN 3KPFL4A72HE119966 Odometer 158,569 KM Current Bid 4 000 $ 13 total photos";
  doc.body.textContent = doc.body.innerText;
  doc.images = [{}, {}, {}];

  assert.equal(classifier.classifyOpenLanePage(doc, href).pageType, "unknown");
  sectionMap.clearOpenLaneExtractionCache(doc);

  assert.equal(classifier.classifyOpenLanePage(doc, href).pageType, "active_listing");
  assert.equal(extractor.isOpenLaneVehiclePage(doc, href), true);
});

test("OpenLane extraction cache clearing refreshes data between VDP route changes", () => {
  const firstHref = "https://app.openlane.ca/vdp/2T3R1RFV5MW123456";
  const secondHref = "https://app.openlane.ca/vdp/1GCUDEE88RZ142915";
  const doc = fakeDocument("2021 Toyota RAV4 VIN 2T3R1RFV5MW123456 Odometer 52,300 KM Current Bid $18,500 4 total photos");

  assert.equal(extractor.extractOpenLaneListing(doc, firstHref).vin, "2T3R1RFV5MW123456");
  assert.equal(classifier.classifyOpenLanePage(doc, firstHref).pageType, "active_listing");

  doc.body.innerText = "2024 Chevrolet Silverado VIN 1GCUDEE88RZ142915 Odometer 40,100 KM Current Bid $50,700 21 total photos";
  doc.body.textContent = doc.body.innerText;
  sectionMap.clearOpenLaneExtractionCache(doc);

  assert.equal(extractor.isOpenLaneVehiclePage(doc, secondHref), true);
  assert.equal(extractor.extractOpenLaneListing(doc, secondHref).vin, "1GCUDEE88RZ142915");
  assert.equal(classifier.classifyOpenLanePage(doc, secondHref).evidence.some((item) => item.marker === "vehicle_identity"), true);
});

test("OpenLane extractor rejects VIN barcode label noise and keeps rejection reasons", () => {
  const listing = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <section class="vehicle-hero">
        <h1>2017 Hyundai Tucson AWD</h1>
        <button aria-label="VIN barcode">VIN barcode</button>
        <button data-testid="copy-vin" data-vin="KM8J3CA46HU123456">Copy VIN KM8J3CA46HU123456</button>
      </section>
      <section class="vehicle-specs">Odometer 111,486 KM</section>
      <section class="bid-panel">Current Bid $4,600</section>
      <span>23 total photos</span>
    </main>
  `, "https://app.openlane.ca/vdp/hyundai-tucson");
  const debug = listing.extractedFields as { debug?: { vinCandidates?: Array<{ vin?: string; rejectedReason?: string; sourceText?: string }> } };

  assert.equal(listing.vin, "KM8J3CA46HU123456");
  assert.ok(debug.debug?.vinCandidates?.some((candidate) => /barcode/i.test(String(candidate.sourceText)) && candidate.rejectedReason));
  assert.equal(debug.debug?.vinCandidates?.some((candidate) => candidate.vin === "BARCODE"), false);
});

test("OpenLane extractor recovers VIN from URL path and query when page metadata is delayed", () => {
  const html = `
    <main class="vdp-page">
      <h1>2017 Kia Forte LX</h1>
      <p>Odometer 158,569 KM</p>
      <section class="bid-panel">Current Bid $4,000</section>
      <span>13 total photos</span>
    </main>
  `;
  const fromPath = extractor.extractOpenLaneFixture(html, "https://app.openlane.ca/vdp/3KPFL4A72HE119966");
  const fromQuery = extractor.extractOpenLaneFixture(html, "https://app.openlane.ca/vdp/details?vin=3KPFL4A72HE119966");

  assert.equal(fromPath.vin, "3KPFL4A72HE119966");
  assert.equal(fromQuery.vin, "3KPFL4A72HE119966");
  assert.match(String((fromPath.fieldEvidence as Record<string, Array<{ sourceText?: string }>>).vin?.[0]?.sourceText || ""), /vdp\/3KPFL4A72HE119966/);
});

test("OpenLane extractor recovers VIN from generic safe parent data attributes and aria labels", () => {
  const fromDataAttribute = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <div data-vehicle='{"vin":"3KPFL4A72HE119966"}'>
        <h1>2017 Kia Forte LX</h1>
        <p>Odometer 158,569 KM</p>
      </div>
      <section class="bid-panel">Current Bid $4,000</section>
      <span>13 total photos</span>
    </main>
  `, "https://app.openlane.ca/vdp/details");
  const fromAriaLabel = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <h1>2017 Kia Forte LX</h1>
      <button aria-label="Copy VIN 3KPFL4A72HE119966">Copy</button>
      <p>Odometer 158,569 KM</p>
      <section class="bid-panel">Current Bid $4,000</section>
      <span>13 total photos</span>
    </main>
  `, "https://app.openlane.ca/vdp/details");

  assert.equal(fromDataAttribute.vin, "3KPFL4A72HE119966");
  assert.equal(fromAriaLabel.vin, "3KPFL4A72HE119966");
});

test("OpenLane extractor safe DOM attribute path is self-contained and redacts sensitive attributes", () => {
  assert.equal((globalThis as { DealerFlowOpenLaneStableCapture?: unknown }).DealerFlowOpenLaneStableCapture, undefined);

  const listing = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <section
        class="vehicle-hero"
        data-vehicle='{"vin":"3KPFL4A72HE119966"}'
        data-token="secret-token-value"
        data-session="openlane-session-value">
        <h1>2017 Kia Forte LX</h1>
        <p>Odometer 158,569 KM</p>
      </section>
      <button
        aria-label="View CARFAX Canada report"
        data-href="/vehicle-history/carfax/FORTE123"
        data-token="secret-token-value">
        CARFAX Canada
      </button>
      <section class="bid-panel">Current Bid $4,000</section>
      <span>13 total photos</span>
    </main>
  `, "https://app.openlane.ca/vdp/data-attribute-only");
  const serializedEvidence = JSON.stringify({
    fieldEvidence: listing.fieldEvidence,
    extractedFields: listing.extractedFields,
    openlaneMetadata: listing.openlaneMetadata,
  });

  assert.equal(listing.vin, "3KPFL4A72HE119966");
  assert.equal(listing.carfaxUrl, "https://app.openlane.ca/vehicle-history/carfax/FORTE123");
  assert.equal(listing.carfaxUrlStatus, "url_found");
  assert.match(serializedEvidence, /safe_dom_attributes/);
  assert.doesNotMatch(serializedEvidence, /secret-token-value|openlane-session-value|data-token|data-session/i);
});

test("OpenLane extractor rejects invalid VIN candidates containing I O or Q", () => {
  const listing = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <section class="vehicle-hero">
        <h1>2017 Hyundai Tucson AWD</h1>
        <p>VIN KM8JICA4OHU12345Q</p>
      </section>
      <section class="vehicle-specs">Odometer 111,486 KM</section>
      <section class="bid-panel">Current Bid $4,600</section>
      <span>23 total photos</span>
    </main>
  `, "https://app.openlane.ca/vdp/hyundai-tucson");
  const debug = listing.extractedFields as { debug?: { vinCandidates?: Array<{ candidate?: string; rejectedReason?: string }> } };

  assert.equal(listing.vin, undefined);
  assert.ok(debug.debug?.vinCandidates?.some((candidate) => candidate.candidate === "KM8JICA4OHU12345Q" && /invalid/i.test(String(candidate.rejectedReason))));
});

test("OpenLane mileage resolver chooses odometer over transport distance", () => {
  const listing = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <section class="transport">Transport estimate CAD $428 / 185km pickup to delivery</section>
      <section class="vehicle-hero">
        <h1>2017 Hyundai Tucson AWD</h1>
        <p>VIN KM8J3CA46HU123456</p>
      </section>
      <section class="vehicle-specs">Vehicle information 111,486 KM</section>
      <section class="bid-panel">Current Bid $4,600</section>
      <span>23 total photos</span>
    </main>
  `, "https://app.openlane.ca/vdp/hyundai-tucson");
  const debug = listing.extractedFields as { debug?: { mileageCandidates?: Array<{ mileageKm?: number; rejectedReason?: string; sourceText?: string }> } };

  assert.equal(listing.title, "2017 Hyundai Tucson AWD");
  assert.equal(listing.currentBid, 4600);
  assert.equal(listing.mileageKm, 111486);
  assert.equal(listing.imageCount, 23);
  assert.ok(debug.debug?.mileageCandidates?.some((candidate) => candidate.mileageKm === 185 && /transport/i.test(String(candidate.rejectedReason))));
});

test("OpenLane CARFAX resolver extracts relative and data URL metadata without fetching reports", () => {
  const listing = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <h1>2017 Hyundai Tucson AWD</h1>
      <p>VIN KM8J3CA46HU123456</p>
      <p>Odometer 111,486 KM</p>
      <button aria-label="View CARFAX Canada report" data-href="/reports/carfax/TUCSON123">CARFAX Canada</button>
      <section class="bid-panel">Current Bid $4,600</section>
      <span>23 total photos</span>
    </main>
  `, "https://app.openlane.ca/vdp/hyundai-tucson");

  assert.equal(listing.carfaxUrl, "https://app.openlane.ca/reports/carfax/TUCSON123");
  assert.equal(listing.carfaxUrlStatus, "url_found");
});

test("OpenLane CARFAX resolver extracts data-url metadata", () => {
  const listing = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <h1>2017 Hyundai Tucson AWD</h1>
      <p>VIN KM8J3CA46HU123456</p>
      <p>Odometer 111,486 KM</p>
      <button aria-label="View CARFAX Canada report" data-url="/vehicle-history/carfax/TUCSON456">CARFAX Canada</button>
      <section class="bid-panel">Current Bid $4,600</section>
      <span>23 total photos</span>
    </main>
  `, "https://app.openlane.ca/vdp/hyundai-tucson");

  assert.equal(listing.carfaxUrl, "https://app.openlane.ca/vehicle-history/carfax/TUCSON456");
  assert.equal(listing.carfaxUrlStatus, "url_found");
});

test("OpenLane CARFAX resolver scans safe generic attributes and rejects asset URLs", () => {
  const genericAttribute = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <h1>2017 Hyundai Tucson AWD</h1>
      <p>VIN KM8J3CA46HU123456</p>
      <p>Odometer 111,486 KM</p>
      <div data-vehicle-history='{"provider":"CARFAX","reportUrl":"/history/carfax/TUCSON789"}'>History available</div>
      <section class="bid-panel">Current Bid $4,600</section>
    </main>
  `, "https://app.openlane.ca/vdp/hyundai-tucson");
  const logoOnly = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <h1>2017 Hyundai Tucson AWD</h1>
      <p>VIN KM8J3CA46HU123456</p>
      <p>Odometer 111,486 KM</p>
      <img src="https://www.carfax.ca/assets/carfax-logo.svg" alt="CARFAX logo" />
      <section class="bid-panel">Current Bid $4,600</section>
    </main>
  `, "https://app.openlane.ca/vdp/hyundai-tucson");

  assert.equal(genericAttribute.carfaxUrl, "https://app.openlane.ca/history/carfax/TUCSON789");
  assert.equal(genericAttribute.carfaxUrlStatus, "url_found");
  assert.ok((genericAttribute.openlaneMetadata as { carfaxEvidence?: Array<{ source?: string }> }).carfaxEvidence?.some((item) => item.source === "safe_dom_attributes"));
  assert.equal(logoOnly.carfaxUrl, undefined);
  assert.equal(logoOnly.carfaxUrlStatus, "text_only");
});

test("OpenLane CARFAX status is explicit for button text and missing pages", () => {
  const textOnly = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <h1>2017 Hyundai Tucson AWD</h1>
      <p>VIN KM8J3CA46HU123456</p>
      <p>Odometer 111,486 KM</p>
      <button>View CARFAX Canada report</button>
      <section class="bid-panel">Current Bid $4,600</section>
    </main>
  `, "https://app.openlane.ca/vdp/hyundai-tucson");
  const missing = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <h1>2017 Hyundai Tucson AWD</h1>
      <p>VIN KM8J3CA46HU123456</p>
      <p>Odometer 111,486 KM</p>
      <section class="bid-panel">Current Bid $4,600</section>
    </main>
  `, "https://app.openlane.ca/vdp/hyundai-tucson");

  assert.equal(textOnly.carfaxMentioned, true);
  assert.equal(textOnly.carfaxAvailable, true);
  assert.equal(textOnly.carfaxUrl, undefined);
  assert.equal(textOnly.carfaxUrlStatus, "text_only");
  assert.equal(missing.carfaxMentioned, false);
  assert.equal(missing.carfaxAvailable, false);
  assert.equal(missing.carfaxUrl, undefined);
  assert.equal(missing.carfaxUrlStatus, "missing");
});

test("OpenLane section map isolates noisy English VDP regions", () => {
  const html = fixture("openlane-vdp-purchased-selling-price.html");
  const map = sectionMap.buildOpenLaneSectionMapFromHtml(html, "https://app.openlane.ca/vdp/3KPFL4A72HE119966");
  const classification = classifier.classifyOpenLanePageFromHtml(html, "https://app.openlane.ca/vdp/3KPFL4A72HE119966");

  assert.match(String(map.zones.vehicleHero.text), /2017 Kia Forte/);
  assert.match(String(map.zones.gallery.text), /13 total/);
  assert.match(String(map.zones.disclosuresCondition.text), /CARFAX report/);
  assert.match(String(map.zones.purchasePanel.text), /Selling price\s+4 000 \$/);
  assert.match(String(map.zones.marketGuide.text), /Sales history of similar vehicles/);
  assert.equal(map.zones.marketGuide.ignored, true);
  assert.equal(map.zones.sidebar.ignored, true);
  assert.doesNotMatch(map.mainText, /Sales history of similar vehicles/);
  assert.ok(map.ignoredEvidence.some((item) => item.zone === "sidebar"));
  assert.ok(map.ignoredEvidence.some((item) => item.zone === "marketGuide"));
  assert.notEqual(classification.pageType, "purchase_list");
});

test("OpenLane section map isolates noisy French VDP regions", () => {
  const html = fixture("openlane-french-vdp-noisy-sidebar.html");
  const map = sectionMap.buildOpenLaneSectionMapFromHtml(html, "https://app.openlane.ca/vdp/fr-vehicle?tab=active");
  const classification = classifier.classifyOpenLanePageFromHtml(html, "https://app.openlane.ca/vdp/fr-vehicle?tab=active");

  assert.match(String(map.zones.vehicleHero.text), /2020 Honda Civic/);
  assert.match(String(map.zones.bidPanel.text), /Offre actuelle\s+15 200 \$/);
  assert.match(String(map.zones.vehicleSpecs.text), /Odomètre\s+82 100 KM/);
  assert.match(String(map.zones.disclosuresCondition.text), /Divulgations et condition/);
  assert.match(String(map.zones.dealerNotes.text), /Note du concessionnaire vendeur/);
  assert.match(String(map.zones.marketGuide.text), /Historique des ventes/);
  assert.doesNotMatch(map.mainText, /ACHATS\s+Parcourir\s+En attente\s+Fermeture\s+Achats/);
  assert.doesNotMatch(map.mainText, /Historique des ventes/);
  assert.equal(classification.pageType, "active_listing");
});

test("OpenLane identity scoring rejects auction datetime titles and chooses vehicle identity", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-touareg-identity-noise.html"), "https://app.openlane.ca/vdp/touareg?tab=active");
  const debug = listing.extractedFields as { debug?: { titleCandidates?: Array<{ text?: string; score?: number; rejectedReason?: string }>; vinCandidates?: unknown[]; mileageCandidates?: unknown[] } };

  assert.equal(listing.title, "2013 Volkswagen Touareg 4dr TDI");
  assert.equal(listing.year, 2013);
  assert.equal(listing.make, "Volkswagen");
  assert.equal(listing.model, "Touareg");
  assert.match(String(listing.trim), /4dr TDI/);
  assert.equal(listing.vin, "WVGEP9BP4DD012345");
  assert.equal(listing.mileageKm, 176240);
  assert.ok((debug.debug?.vinCandidates || []).length > 0);
  assert.ok((debug.debug?.mileageCandidates || []).length > 0);
  assert.ok((debug.debug?.titleCandidates || []).some((candidate) => /2026/.test(String(candidate.text)) && candidate.rejectedReason));
});

test("OpenLane identity debug explains missing VIN when no candidate exists", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-missing-data.html"), "https://www.openlane.ca/vehicle/missing");
  const fields = listing.extractedFields as { debug?: { vinCandidates?: unknown[] } };

  assert.equal(listing.vin, undefined);
  assert.deepEqual(fields.debug?.vinCandidates, []);
  assert.ok((listing.missingData as string[]).includes("vin"));
});

test("OpenLane active offer labels remain observation-only and separate from current bid", () => {
  const listing = extractor.extractOpenLaneFixture(`
    <main class="vdp-page">
      <section class="vehicle-hero" data-vin="2T3R1RFV5MW123456">
        <h1>2021 Toyota RAV4 LE</h1>
        <p>Odometer 52,300 KM</p>
      </section>
      <section class="bid-panel">
        <dl>
          <dt>Current offer</dt>
          <dd>$13,400</dd>
          <dt>Best Offer</dt>
          <dd>$13,900</dd>
        </dl>
      </section>
    </main>
  `, "https://app.openlane.ca/vdp/offer-observation?tab=active");

  assert.equal(listing.pageType, "active_listing");
  assert.equal(listing.captureKind, "observation");
  assert.equal(listing.currentBid, undefined);
  assert.equal(listing.currentOffer, 13400);
  assert.equal(listing.bestOffer, 13900);
  assert.equal(listing.buyPriceAuction, undefined);
  assert.equal(listing.finalAcquisitionCost, undefined);
});

test("OpenLane realistic fixture suite protects critical live extraction regressions", () => {
  const activeEn = extractor.extractOpenLaneFixture(fixture("openlane-vdp-active-en.html"), "https://app.openlane.ca/vdp/silverado?tab=active");
  const activeFr = extractor.extractOpenLaneFixture(fixture("openlane-vdp-active-fr-touareg.html"), "https://app.openlane.ca/vdp/touareg?tab=active");
  const purchased = extractor.extractOpenLaneFixture(fixture("openlane-vdp-purchased-selling-price.html"), "https://app.openlane.ca/vdp/3KPFL4A72HE119966");
  const fees = extractor.extractOpenLaneFixture(fixture("openlane-fee-details-realistic.html"), "https://app.openlane.ca/purchases/hyundai/fees");
  const carfax = extractor.extractOpenLaneFixture(fixture("openlane-carfax-url.html"), "https://app.openlane.ca/vdp/rav4");
  const media = extractor.extractOpenLaneFixture(fixture("openlane-media-lazy-gallery.html"), "https://app.openlane.ca/vdp/rav4");
  const hiddenDisclosures = extractor.extractOpenLaneFixture(fixture("openlane-hidden-tabs-disclosures.html"), "https://app.openlane.ca/vdp/santa-fe");
  const pending = extractor.extractOpenLaneFixture(fixture("openlane-post-sale-pending.html"), "https://app.openlane.ca/post-sale/camry");
  const accepted = extractor.extractOpenLaneFixture(fixture("openlane-post-sale-accepted.html"), "https://app.openlane.ca/post-sale/camry");

  assert.equal(activeEn.pageType, "active_listing");
  assert.equal(activeEn.captureKind, "observation");
  assert.equal(activeEn.vin, "1GCUDEE88RZ142915");
  assert.match(String(activeEn.title), /2024 Chevrolet Silverado/);
  assert.doesNotMatch(String(activeEn.title), /2026 at 8:00 pm/);
  assert.equal(activeEn.currentBid, 50_700);
  assert.equal(activeEn.buyPriceAuction, undefined);
  assert.equal(activeEn.carfaxUrl, "https://www.carfax.ca/report/SILVERADO123");
  assert.ok((activeEn.photos as Array<{ url: string }>).every((photo) => !/openlane-logo/i.test(photo.url)));

  assert.equal(activeFr.pageType, "active_listing");
  assert.notEqual(activeFr.pageType, "purchase_list");
  assert.match(String(activeFr.title), /2013 Volkswagen Touareg/);
  assert.equal(activeFr.vin, "WVGEP9BP4DD012345");
  assert.equal(activeFr.mileageKm, 176240);
  assert.equal(activeFr.currentOffer, 6500);
  assert.equal(activeFr.bestOffer, 6800);

  assert.notEqual(purchased.pageType, "purchase_list");
  assert.equal(purchased.buyPriceAuction, 4000);
  assert.equal(purchased.currentBid, undefined);

  assert.equal(fees.buyPriceAuction, 6_900);
  assert.equal(fees.totalInvoiceAmount, 8_166);
  assert.notEqual(fees.buyPriceAuction, fees.totalInvoiceAmount);

  assert.equal(carfax.carfaxUrl, "https://www.carfax.ca/report/REALCARFAX123");
  assert.equal(carfax.carfaxUrlStatus, "url_found");

  assert.equal(media.imageCount, 13);
  assert.equal(media.videoCount, 1);
  assert.ok((media.photos as Array<{ url: string }>).some((photo) => /pub-us\.kar-media\.com/.test(photo.url)));
  assert.ok((media.photos as Array<{ url: string }>).every((photo) => !/openlane-logo|\/vdp\/null|fonts\.gstatic\.com/i.test(photo.url)));

  const condition = hiddenDisclosures.condition as { dealerNotes?: string; mechanicalDisclosures?: string[]; highRiskTerms?: string[] };
  assert.match(String(condition.dealerNotes), /Mechanical inspection recommended/i);
  assert.ok(condition.mechanicalDisclosures?.some((item) => /Check engine light/i.test(item)));
  assert.ok(condition.highRiskTerms?.some((term) => /engine/i.test(term)));
  assert.equal((hiddenDisclosures.warnings as string[]).some((warning) => /Condition report text was not visible/i.test(warning)), false);

  assert.equal(pending.captureKind, "candidate_outcome");
  assert.equal(pending.finalBidAmount, undefined);
  assert.equal(accepted.captureKind, "verified_outcome");
  assert.equal(accepted.finalBidAmount, 17_900);
});

test("OpenLane network fixture extracts sanitized vehicle evidence without private fields", () => {
  const payload = JSON.parse(fixture("openlane-network-vdp-response.json"));
  const candidates = networkObserver.extractCandidatesFromNetworkPayload(payload, "https://app.openlane.ca/api/vdp/5NMS3CAD8LH123456");
  const sanitized = JSON.stringify(networkObserver.sanitizeNetworkPayload(payload));
  const merged = networkObserver.mergeNetworkEvidenceIntoListing({ sourceName: "OpenLane", listingUrl: "https://app.openlane.ca/vdp/santa-fe" }, [{
    capturedAt: "2026-05-15T12:00:00.000Z",
    endpointPattern: "app.openlane.ca/api/vdp/:id",
    sanitizedKeys: candidates.sanitizedKeys,
    candidates,
  }]);

  assert.equal(candidates.vinCandidates[0]?.vin, "5NMS3CAD8LH123456");
  assert.ok(candidates.mediaCandidates.some((item) => /pub-us\.kar-media\.com/.test(item.url)));
  assert.equal(candidates.mediaCandidates.some((item) => /openlane-logo/i.test(item.url)), false);
  assert.ok(candidates.conditionCandidates.some((item) => /Check engine light/i.test(item.text)));
  assert.doesNotMatch(sanitized, /buyer@example\.com|eyJaaaaaaaa/i);
  assert.equal(merged.vin, "5NMS3CAD8LH123456");
  assert.match(String(merged.conditionReportText), /Check engine light/);
});

test("OpenLane network observer extracts DevTools-style vehicle JSON candidates without secrets", () => {
  const payload = {
    listing: {
      vin: "KM8J3CA46HU123456",
      year: 2017,
      make: "Hyundai",
      model: "Tucson",
      trim: "Limited AWD",
      odometer: 111486,
      sellerName: "OpenLane Montreal",
      location: "Montreal, QC",
      currentBidAmount: 4600,
      transportEstimate: {
        costCad: 428,
        distanceKm: 185,
      },
      carfaxReportUrl: "/reports/carfax/TUCSON123",
      photos: ["https://pub-us.kar-media.com/vehicle/KM8J3CA46HU123456/front.jpg"],
    },
    authToken: "eyJaaaaaaaaaaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccccc",
    requestHeaders: { authorization: "Bearer should-not-appear", cookie: "session=secret" },
  };

  const candidates = networkObserver.extractCandidatesFromNetworkPayload(payload, "https://app.openlane.ca/api/vdp/KM8J3CA46HU123456");
  const serialized = JSON.stringify(candidates);

  assert.equal(candidates.vinCandidates[0]?.vin, "KM8J3CA46HU123456");
  assert.ok(candidates.fieldCandidates.some((item) => item.field === "mileageKm" && item.value === 111486));
  assert.ok(candidates.fieldCandidates.some((item) => item.field === "currentBid" && item.value === 4600));
  assert.ok(candidates.fieldCandidates.some((item) => item.field === "sellerName" && item.value === "OpenLane Montreal"));
  assert.ok(candidates.fieldCandidates.some((item) => item.field === "location" && item.value === "Montreal, QC"));
  assert.ok(candidates.fieldCandidates.some((item) => item.field === "carfaxUrl" && String(item.value).endsWith("/reports/carfax/TUCSON123")));
  assert.ok(candidates.transportCandidates.some((item) => item.field === "transportDistanceKm" && item.value === 185));
  assert.doesNotMatch(serialized, /Bearer should-not-appear|session=secret|authToken/i);
});

test("OpenLane network merge reapplies canonical field evidence after Deep Capture", () => {
  const candidates = networkObserver.extractCandidatesFromNetworkPayload({
    vehicle: {
      vin: "KM8J3CA46HU123456",
      odometerKm: 111486,
      currentBid: 4600,
      carfaxUrl: "https://www.carfax.ca/report/TUCSON123",
    },
  }, "https://app.openlane.ca/api/vdp/KM8J3CA46HU123456");
  const merged = networkObserver.mergeNetworkEvidenceIntoListing({
    sourceName: "OpenLane",
    listingUrl: "https://app.openlane.ca/vdp/tucson",
    capturedAt: "2026-05-17T12:00:00.000Z",
    captureKind: "observation",
    pageType: "active_listing",
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
    title: "2017 Hyundai Tucson",
    year: 2017,
    make: "Hyundai",
    model: "Tucson",
  }, [{
    capturedAt: "2026-05-17T12:00:00.000Z",
    endpointPattern: "app.openlane.ca/api/vdp/:id",
    sanitizedKeys: candidates.sanitizedKeys,
    candidates,
  }]) as { fieldEvidence?: Record<string, Array<{ sourceType?: string; endpointPattern?: string; consentId?: string }>>; vin?: string; carfaxUrl?: string; mileageKm?: number; openlaneMetadata?: { networkEvidence?: Array<{ candidateCounts?: { carfax?: number } }> } };

  assert.equal(merged.vin, "KM8J3CA46HU123456");
  assert.equal(merged.mileageKm, 111486);
  assert.equal(merged.carfaxUrl, "https://www.carfax.ca/report/TUCSON123");
  assert.ok(merged.fieldEvidence?.vin?.some((item) => item.sourceType === "network_json" && item.endpointPattern === "app.openlane.ca/api/vdp/:id"));
  assert.ok(merged.fieldEvidence?.carfaxUrl?.some((item) => item.sourceType === "network_json"));
  assert.equal(merged.openlaneMetadata?.networkEvidence?.[0]?.candidateCounts?.carfax, 1);
});

test("OpenLane network VIN candidate beats visible fallback after Deep Capture merge", () => {
  const candidates = networkObserver.extractCandidatesFromNetworkPayload({
    vehicle: {
      vin: "KM8J3CA46HU123456",
      odometerKm: 111486,
    },
  }, "https://app.openlane.ca/api/vdp/KM8J3CA46HU123456");
  const merged = networkObserver.mergeNetworkEvidenceIntoListing({
    sourceName: "OpenLane",
    listingUrl: "https://app.openlane.ca/vdp/3KPFL4A72HE119966",
    capturedAt: "2026-05-17T12:00:00.000Z",
    captureKind: "observation",
    pageType: "active_listing",
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
    title: "2017 Kia Forte",
    year: 2017,
    make: "Kia",
    model: "Forte",
    vin: "3KPFL4A72HE119966",
  }, [{
    endpointPattern: "app.openlane.ca/api/vdp/:id",
    capturedAt: "2026-05-17T12:00:00.000Z",
    sanitizedKeys: candidates.sanitizedKeys,
    candidates,
  }]) as { fieldEvidence?: Record<string, Array<{ sourceType?: string }>>; vin?: string };

  assert.equal(merged.vin, "KM8J3CA46HU123456");
  assert.equal(merged.fieldEvidence?.vin?.[0]?.sourceType, "network_json");
});

test("OpenLane weak network VIN candidate does not overwrite stronger verified evidence", () => {
  const candidates = networkObserver.extractCandidatesFromNetworkPayload({
    text: "Vehicle reference KM8J3CA46HU123456",
  }, "https://app.openlane.ca/api/vdp/context");
  const merged = networkObserver.mergeNetworkEvidenceIntoListing({
    sourceName: "OpenLane",
    listingUrl: "https://app.openlane.ca/vdp/3KPFL4A72HE119966",
    capturedAt: "2026-05-17T12:00:00.000Z",
    captureKind: "manual_confirmation",
    pageType: "active_listing",
    vin: "3KPFL4A72HE119966",
    fieldEvidence: {
      vin: [{
        field: "vin",
        value: "3KPFL4A72HE119966",
        normalizedValue: "3KPFL4A72HE119966",
        sourceType: "manual_confirmation",
        sourceText: "User-confirmed VIN",
        confidenceScore: 98,
        capturedAt: "2026-05-17T12:00:00.000Z",
      }],
    },
  }, [{
    endpointPattern: "app.openlane.ca/api/vdp/context",
    capturedAt: "2026-05-17T12:00:00.000Z",
    sanitizedKeys: candidates.sanitizedKeys,
    candidates,
  }]) as { vin?: string; fieldEvidence?: Record<string, Array<{ sourceType?: string }>> };

  assert.equal(merged.vin, "3KPFL4A72HE119966");
  assert.equal(merged.fieldEvidence?.vin?.[0]?.sourceType, "manual_confirmation");
});

test("OpenLane network CARFAX candidate normalizes status and evidence after Deep Capture merge", () => {
  const candidates = networkObserver.extractCandidatesFromNetworkPayload({
    vehicle: {
      vin: "KM8J3CA46HU123456",
      carfax: {
        provider: "CARFAX Canada",
        reportUrl: "/vehicle-history/carfax/TUCSON999",
      },
    },
  }, "https://app.openlane.ca/api/vdp/KM8J3CA46HU123456");
  const merged = networkObserver.mergeNetworkEvidenceIntoListing({
    sourceName: "OpenLane",
    listingUrl: "https://app.openlane.ca/vdp/KM8J3CA46HU123456",
    capturedAt: "2026-05-17T12:00:00.000Z",
    captureKind: "observation",
    pageType: "active_listing",
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
    title: "2017 Hyundai Tucson",
    year: 2017,
    make: "Hyundai",
    model: "Tucson",
  }, [{
    endpointPattern: "app.openlane.ca/api/vdp/:id",
    capturedAt: "2026-05-17T12:00:00.000Z",
    sanitizedKeys: candidates.sanitizedKeys,
    candidates,
  }]) as {
    carfaxMentioned?: boolean;
    carfaxAvailable?: boolean;
    carfaxUrl?: string;
    carfaxUrlStatus?: string;
    fieldEvidence?: Record<string, Array<{ sourceType?: string; endpointPattern?: string }>>;
    openlaneMetadata?: { carfaxEvidence?: Array<{ source?: string }> };
  };

  assert.equal(merged.carfaxMentioned, true);
  assert.equal(merged.carfaxAvailable, true);
  assert.equal(merged.carfaxUrl, "https://app.openlane.ca/vehicle-history/carfax/TUCSON999");
  assert.equal(merged.carfaxUrlStatus, "url_found");
  assert.equal(merged.fieldEvidence?.carfaxUrl?.[0]?.sourceType, "network_json");
  assert.ok(merged.openlaneMetadata?.carfaxEvidence?.some((item) => item.source === "network_json"));
});

test("OpenLane extractor reads core auction fields from fixture HTML", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-basic.html"), "https://www.openlane.ca/vehicle/123");
  const pageContext = listing.pageContext as Record<string, unknown>;
  const identity = listing.identity as { vin?: string; year?: number; make?: string; model?: string; evidence?: unknown[] };
  const auctionObservation = listing.auctionObservation as { currentBid?: number; buyNowPrice?: number; evidence?: unknown[] };
  const media = listing.media as { photoCountVisible?: number; photos?: unknown[]; evidence?: unknown[] };
  const carfax = listing.carfax as { mentioned?: boolean; available?: boolean; urlStatus?: string; evidence?: unknown[] };
  const debug = listing.debug as { warnings?: unknown[]; sectionMapSummary?: Record<string, unknown> };

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
  assert.equal(pageContext.pageType, "active_listing");
  assert.equal(pageContext.captureKind, "observation");
  assert.ok(Array.isArray(pageContext.decisiveEvidence));
  assert.equal(identity.vin, "2T3R1RFV5MW123456");
  assert.equal(identity.year, 2021);
  assert.equal(identity.make, "Toyota");
  assert.equal(identity.model, "RAV4");
  assert.ok(Array.isArray(identity.evidence));
  assert.equal(auctionObservation.currentBid, 18500);
  assert.equal(auctionObservation.buyNowPrice, 22900);
  assert.ok(Array.isArray(auctionObservation.evidence));
  assert.equal(media.photoCountVisible, 1);
  assert.ok(Array.isArray(media.photos));
  assert.ok(Array.isArray(media.evidence));
  assert.equal(carfax.available, listing.carfaxAvailable);
  assert.equal(carfax.urlStatus, listing.carfaxUrlStatus);
  assert.ok(Array.isArray(carfax.evidence));
  assert.ok(debug.sectionMapSummary);
  assert.ok(Array.isArray(debug.warnings));
  assert.ok(Number(listing.extractionConfidenceScore) > 50);
});

test("OpenLane extraction contract caps raw text and excludes secrets", () => {
  const listing = extractor.extractOpenLaneFixture(
    `${fixture("openlane-basic.html")}<section>session_token=abc123 SUPABASE_SERVICE_ROLE_KEY secret password hunter2 ${"x".repeat(14000)}</section>`,
    "https://www.openlane.ca/vehicle/123",
  );
  const text = JSON.stringify(listing);

  assert.ok(String(listing.rawVisibleText).length <= 12000);
  assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY|session_token|hunter2|password/i);
});

test("OpenLane extractor captures Carfax, media, and normalized relative URLs", () => {
  const carfax = extractor.extractOpenLaneFixture(fixture("openlane-with-carfax.html"));
  const media = extractor.extractOpenLaneFixture(fixture("openlane-with-photos-videos.html"), "https://www.openlane.ca/vehicle/456");
  const photos = media.photos as Array<{ url: string; source?: string }>;
  const videos = media.videos as Array<{ url: string }>;
  const carfaxContract = carfax.carfax as { url?: string; urlStatus?: string; evidence?: unknown[] };

  assert.equal(carfax.carfaxUrl, "https://www.carfax.ca/report/ABC123");
  assert.equal(carfax.carfaxAvailable, true);
  assert.equal(carfaxContract.url, "https://www.carfax.ca/report/ABC123");
  assert.equal(carfaxContract.urlStatus, "url_found");
  assert.ok((carfaxContract.evidence || []).length > 0);
  assert.ok(photos.some((photo) => photo.url === "https://www.openlane.ca/photos/f150-front.jpg"));
  assert.ok(photos.some((photo) => photo.source === "picture"));
  assert.equal(new Set(photos.map((photo) => photo.url)).size, photos.length);
  assert.ok(videos.some((video) => video.url.includes("f150-walkaround.mp4")));
  assert.ok(videos.some((video) => video.url.includes("vimeo.com")));
});

test("OpenLane Carfax and media extraction stays truthful for text-only and junk assets", () => {
  const textOnly = extractor.extractOpenLaneFixture(fixture("openlane-vdp-purchased-selling-price.html"), "https://app.openlane.ca/vdp/3KPFL4A72HE119966");
  const dataHref = extractor.extractOpenLaneFixture(`
    <main>
      <h1>2021 Toyota RAV4 LE</h1>
      <p>VIN 2T3R1RFV5MW123456</p>
      <p>Odometer 52,300 KM</p>
      <button data-href="https://www.carfax.ca/report/DATAHREF123" aria-label="Open CARFAX report">CARFAX</button>
      <img src="data:image/png;base64,AAA" alt="inline junk" width="1200" height="900" />
      <img src="/favicon.ico" width="16" height="16" />
      <img src="https://pub-us.kar-media.com/vehicle/2T3R1RFV5MW123456/front.jpg" width="1280" height="960" />
      <span>13 total</span>
    </main>
  `, "https://app.openlane.ca/vdp/rav4");
  const textOnlyCarfax = textOnly.carfax as { url?: string; urlStatus?: string };
  const dataHrefCarfax = dataHref.carfax as { url?: string; urlStatus?: string };
  const photos = dataHref.photos as Array<{ url: string }>;

  assert.equal(textOnlyCarfax.url, undefined);
  assert.equal(textOnlyCarfax.urlStatus, "text_only");
  assert.equal(dataHrefCarfax.url, "https://www.carfax.ca/report/DATAHREF123");
  assert.equal(dataHrefCarfax.urlStatus, "url_found");
  assert.equal(dataHref.imageCount, 13);
  assert.ok(photos.some((photo) => photo.url.includes("pub-us.kar-media.com")));
  assert.ok(photos.every((photo) => !/data:image|favicon|openlane-logo|\/vdp\/null|fonts\.gstatic\.com|translate/i.test(photo.url)));
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

test("OpenLane extractor structures bilingual condition disclosures and dealer notes", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-condition-disclosures-french.html"), "https://app.openlane.ca/vdp/french-condition");
  const condition = listing.condition as {
    knownHistoryItems?: string[];
    safetyDisclosures?: string[];
    mechanicalDisclosures?: string[];
    exteriorDisclosures?: string[];
    interiorDisclosures?: string[];
    tireWheelDisclosures?: string[];
    obd2Status?: string;
    dealerNotes?: string;
    qaSummary?: string;
    conditionReportText?: string;
    highRiskTerms?: string[];
    evidence?: unknown[];
  };

  assert.ok(condition.knownHistoryItems?.some((item) => /Historique D.accidents Antécédents - Oui/i.test(item)));
  assert.ok(condition.knownHistoryItems?.some((item) => /Rien n.a été signalé/i.test(item)));
  assert.ok(condition.safetyDisclosures?.some((item) => /Pare-Brise - Fissuré/i.test(item)));
  assert.ok(condition.mechanicalDisclosures?.some((item) => /Moteur Requiert Réparations/i.test(item)));
  assert.ok(condition.mechanicalDisclosures?.some((item) => /check engine light on/i.test(item)));
  assert.ok(condition.exteriorDisclosures?.some((item) => /Travaux De Peinture Antérieurs/i.test(item)));
  assert.ok(condition.interiorDisclosures?.some((item) => /Rien n.a été signalé/i.test(item)));
  assert.ok(condition.tireWheelDisclosures?.some((item) => /Deux pneus usés/i.test(item)));
  assert.equal(condition.obd2Status, "not_visible");
  assert.match(String(condition.dealerNotes), /inspection mécanique est recommandée/);
  assert.match(String(condition.qaSummary), /voyant check engine/i);
  assert.match(String(condition.conditionReportText), /Pare-Brise - Fissuré/);
  assert.ok(condition.highRiskTerms?.some((term) => /engine|moteur/i.test(term)));
  assert.ok((condition.evidence || []).length > 0);
  assert.equal((listing.warnings as string[]).some((warning) => /Condition report text was not visible/i.test(warning)), false);
});

test("OpenLane page classifier separates active observations from outcome pages", () => {
  const active = classifier.classifyOpenLanePageFromHtml(fixture("openlane-basic.html"), "https://www.openlane.ca/vehicle/123");
  const purchaseList = classifier.classifyOpenLanePageFromHtml(fixture("openlane-purchase-list.html"), "https://www.openlane.ca/purchases");
  const feeDetails = classifier.classifyOpenLanePageFromHtml(fixture("openlane-fee-details.html"), "https://www.openlane.ca/purchases/123/fees");
  const postSalePending = classifier.classifyOpenLanePageFromHtml(fixture("openlane-post-sale-pending.html"), "https://www.openlane.ca/post-sale/123");
  const postSaleAccepted = classifier.classifyOpenLanePageFromHtml(fixture("openlane-post-sale-accepted.html"), "https://www.openlane.ca/post-sale/456");
  const unknown = classifier.classifyOpenLanePageFromHtml(fixture("openlane-unknown.html"), "https://www.openlane.ca/search");

  assert.equal(active.pageType, "active_listing");
  assert.equal(active.captureKind, "observation");
  assert.ok(active.evidence.some((item) => item.marker === "current_bid"));
  assert.equal(purchaseList.pageType, "purchase_list");
  assert.equal(purchaseList.captureKind, "candidate_outcome");
  assert.equal(feeDetails.pageType, "fee_details");
  assert.equal(feeDetails.captureKind, "verified_outcome");
  assert.ok(feeDetails.confidenceScore >= 80);
  assert.equal(postSalePending.pageType, "post_sale");
  assert.equal(postSalePending.captureKind, "candidate_outcome");
  assert.equal(postSaleAccepted.pageType, "post_sale");
  assert.equal(postSaleAccepted.captureKind, "verified_outcome");
  assert.equal(unknown.pageType, "unknown");
  assert.equal(unknown.captureKind, "observation");
  assert.ok(unknown.warnings.some((warning) => /not enough OpenLane page markers/i.test(warning)));
});

test("OpenLane extractor includes classifier result in listing payload", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-fee-details.html"), "https://www.openlane.ca/purchases/123/fees");

  assert.equal(listing.pageType, "fee_details");
  assert.equal(listing.captureKind, "verified_outcome");
  assert.equal(listing.outcomeConfidence, "verified");
  assert.ok(Array.isArray(listing.outcomeEvidence));
  assert.equal((listing.openlaneMetadata as { classification?: { pageType?: string } }).classification?.pageType, "fee_details");
});

test("OpenLane active extractor reads Silverado page without confusing trim digits for mileage", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-active-silverado.html"), "https://www.openlane.ca/vehicle/silverado");
  const metadata = listing.openlaneMetadata as { disclosureCount?: number; mediaCountEvidence?: Record<string, unknown> };
  const fields = listing.extractedFields as { vinEvidence?: { sourceText?: string }; mileageEvidence?: { sourceText?: string } };

  assert.equal(listing.pageType, "active_listing");
  assert.equal(listing.captureKind, "observation");
  assert.equal(listing.vin, "1GCUDEE88RZ142915");
  assert.equal(listing.mileageKm, 40100);
  assert.notEqual(listing.mileageKm, 4157);
  assert.equal(listing.year, 2024);
  assert.equal(listing.make, "Chevrolet");
  assert.equal(listing.model, "Silverado");
  assert.match(String(listing.trim), /1500 Crew Cab/);
  assert.equal(listing.currentBid, 50_700);
  assert.equal(listing.buyNowPrice, 58_900);
  assert.equal(listing.imageCount, 21);
  assert.equal(listing.videoCount, 0);
  assert.equal(metadata.disclosureCount, 12);
  assert.ok((listing.declarations as string[]).some((item) => /daily rental/i.test(item)));
  assert.equal(listing.carfaxUrl, "https://www.carfax.ca/report/SILVERADO123");
  assert.match(String(fields.vinEvidence?.sourceText), /1GCUDEE88RZ142915/);
  assert.match(String(fields.mileageEvidence?.sourceText), /40,100 KM/i);
  assert.equal(metadata.mediaCountEvidence?.photoCount, 21);
});

test("OpenLane active extractor reads Kia page with lazy media counts and visible Carfax text", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-active-kia-forte.html"), "https://www.openlane.ca/vehicle/kia-forte");
  const metadata = listing.openlaneMetadata as { disclosureCount?: number; mediaCountEvidence?: Record<string, unknown> };
  const photos = listing.photos as Array<{ url: string }>;

  assert.equal(listing.vin, "3KPFL4A78JE224744");
  assert.equal(listing.mileageKm, 163042);
  assert.equal(listing.year, 2018);
  assert.equal(listing.make, "Kia");
  assert.equal(listing.model, "Forte");
  assert.equal(listing.currentBid, 6_200);
  assert.equal(listing.imageCount, 56);
  assert.equal(listing.videoCount, 0);
  assert.equal(metadata.disclosureCount, 22);
  assert.ok((listing.declarations as string[]).some((item) => /Accident repair/i.test(item)));
  assert.equal(listing.carfaxAvailable, true);
  assert.equal(listing.carfaxUrl, undefined);
  assert.ok(photos.some((photo) => photo.url.includes("kia-forte-front")));
  assert.equal(metadata.mediaCountEvidence?.videoCount, 0);
});

test("OpenLane VDP purchase outcome ignores sidebar text and extracts hero vehicle plus selling price", () => {
  const listing = extractor.extractOpenLaneFixture(
    fixture("openlane-vdp-purchased-selling-price.html"),
    "https://app.openlane.ca/vdp/3KPFL4A72HE119966?tab=active",
  );
  const metadata = listing.openlaneMetadata as {
    disclosureCount?: number;
    classification?: { pageType?: string; decisiveEvidence?: Array<{ marker?: string }>; ignoredEvidence?: Array<{ marker?: string }> };
    mediaFiltering?: { rejected?: Array<{ reason?: string; url?: string }> };
  };
  const fields = listing.extractedFields as {
    vinEvidence?: { sourceText?: string };
    debug?: {
      classifierDecision?: { pageType?: string };
      ignoredEvidence?: Array<{ marker?: string }>;
      titleCandidates?: Array<{ text?: string; rejectedReason?: string }>;
      vinCandidates?: Array<{ vin?: string }>;
      priceCandidates?: Array<{ label?: string; value?: number }>;
      mediaRejected?: Array<{ reason?: string; url?: string }>;
    };
  };
  const photos = listing.photos as Array<{ url: string }>;

  assert.notEqual(listing.pageType, "purchase_list");
  assert.equal(listing.pageType, "purchase_detail");
  assert.notEqual(listing.captureKind, "observation");
  assert.match(String(listing.title), /2017 Kia Forte/);
  assert.equal(listing.year, 2017);
  assert.equal(listing.make, "Kia");
  assert.equal(listing.model, "Forte");
  assert.match(String(listing.trim), /4dr Sdn\./);
  assert.equal(listing.vin, "3KPFL4A72HE119966");
  assert.equal(listing.mileageKm, 158569);
  assert.equal(listing.imageCount, 13);
  assert.equal(metadata.disclosureCount, 2);
  assert.equal(listing.videoCount, 1);
  assert.equal(listing.buyPriceAuction, 4000);
  assert.equal(listing.currentBid, undefined);
  assert.equal(listing.totalInvoiceAmount, undefined);
  assert.equal(listing.finalAcquisitionCost, undefined);
  assert.ok(["candidate_wholesale_label", "verified_wholesale_label"].includes((listing.priceSemantics as Record<string, string>).buyPriceAuction));
  assert.equal(listing.carfaxAvailable, true);
  assert.equal(listing.carfaxUrl, undefined);
  assert.equal(listing.carfaxUrlStatus, "text_only");
  assert.ok(photos.some((photo) => photo.url.includes("pub-us.kar-media.com")));
  assert.ok(photos.every((photo) => !/openlane-logo\.svg|\/vdp\/null|fonts\.gstatic\.com/i.test(photo.url)));
  assert.ok(metadata.classification?.ignoredEvidence?.some((item) => item.marker === "sidebar_purchase_navigation"));
  assert.ok(fields.vinEvidence?.sourceText?.includes("3KPFL4A72HE119966"));
  assert.ok(fields.debug?.classifierDecision?.pageType === "purchase_detail");
  assert.ok(fields.debug?.ignoredEvidence?.some((item) => item.marker === "sidebar_purchase_navigation"));
  assert.ok(fields.debug?.titleCandidates?.some((item) => /Sales history/i.test(String(item.text)) && item.rejectedReason));
  assert.ok(fields.debug?.vinCandidates?.some((item) => item.vin === "3KPFL4A72HE119966"));
  assert.ok(fields.debug?.priceCandidates?.some((item) => item.label === "Selling price" && item.value === 4000));
  assert.ok(fields.debug?.mediaRejected?.some((item) => /openlane-logo|fonts\.gstatic|\/vdp\/null/i.test(String(item.url))));
});

test("OpenLane purchase fee extractor maps verified auction economics without merging fees into buy price", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-purchase-fee-details-panel.html"), "https://www.openlane.ca/purchases/forte/fees");
  const metadata = listing.openlaneMetadata as { purchaseStatus?: string; purchaseEconomics?: Record<string, unknown> };

  assert.equal(listing.pageType, "fee_details");
  assert.equal(listing.captureKind, "verified_outcome");
  assert.equal(listing.outcomeConfidence, "verified");
  assert.equal(listing.vin, "3KPF24AD7LE123456");
  assert.equal(listing.title, "2020 Kia Forte LX");
  assert.equal(listing.saleDate, "May 14, 2026");
  assert.equal(listing.sellerName, "Auto Group Montreal");
  assert.equal(listing.auctionStatus, "Paid");
  assert.equal(metadata.purchaseStatus, "Paid");
  assert.equal(listing.buyPriceAuction, 6_900);
  assert.equal(listing.transactionFee, 280);
  assert.equal(listing.vehicleHistoryFee, 46.55);
  assert.equal(listing.subtotal, 7_226.55);
  assert.equal(listing.taxes, 939.45);
  assert.equal(listing.totalInvoiceAmount, 8_166);
  assert.equal(listing.finalAcquisitionCost, 8_166);
  assert.notEqual(listing.buyPriceAuction, listing.totalInvoiceAmount);
  assert.equal((listing.priceSemantics as Record<string, string>).buyPriceAuction, "verified_wholesale_label");
  assert.equal((listing.priceSemantics as Record<string, string>).totalInvoiceAmount, "final_acquisition_cost");
  assert.ok((listing.outcomeEvidence as Array<{ evidenceType?: string }>).some((item) => item.evidenceType === "fee_details_page"));
  assert.equal(metadata.purchaseEconomics?.currency, "CAD");
});

test("OpenLane realistic Hyundai fee details fixture maps invoice economics exactly", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-fee-details-hyundai-realistic.html"), "https://www.openlane.ca/purchases/hyundai/fees");
  const metadata = listing.openlaneMetadata as { purchaseStatus?: string; purchaseEconomics?: Record<string, unknown> };

  assert.equal(listing.pageType, "fee_details");
  assert.equal(listing.captureKind, "verified_outcome");
  assert.equal(listing.vin, "KMHD84LF8LU123456");
  assert.equal(listing.year, 2020);
  assert.equal(listing.make, "Hyundai");
  assert.equal(listing.model, "Elantra");
  assert.equal(listing.buyPriceAuction, 6_900);
  assert.equal(listing.transactionFee, 280);
  assert.equal(listing.vehicleHistoryFee, 46.55);
  assert.equal(listing.taxes, 939.45);
  assert.equal(listing.totalInvoiceAmount, 8_166);
  assert.equal(listing.finalAcquisitionCost, 8_166);
  assert.equal(metadata.purchaseStatus, "Paid");
  assert.equal(metadata.purchaseEconomics?.currency, "CAD");
});

test("OpenLane realistic Kia purchase detail fixture preserves media/disclosures and candidate post-sale price", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-purchase-detail-kia-realistic.html"), "https://www.openlane.ca/purchases/kia-forte");
  const metadata = listing.openlaneMetadata as { disclosureCount?: number; mediaCountEvidence?: Record<string, unknown> };

  assert.equal(listing.pageType, "post_sale");
  assert.equal(listing.captureKind, "candidate_outcome");
  assert.equal(listing.vin, "3KPFL4A78JE224744");
  assert.equal(listing.mileageKm, 163042);
  assert.equal(listing.imageCount, 56);
  assert.equal(metadata.disclosureCount, 22);
  assert.equal(listing.soldPriceCandidate, 6_400);
  assert.equal(listing.finalBidAmount, undefined);
  assert.equal((listing.priceSemantics as Record<string, string>).soldPriceCandidate, "candidate_wholesale_label");
  assert.equal(metadata.mediaCountEvidence?.photoCount, 56);
});

test("OpenLane purchase list without fee details remains candidate context only", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-purchase-list.html"), "https://www.openlane.ca/purchases");

  assert.equal(listing.pageType, "purchase_list");
  assert.equal(listing.captureKind, "candidate_outcome");
  assert.equal(listing.buyPriceAuction, undefined);
  assert.equal(listing.totalInvoiceAmount, undefined);
  assert.equal(listing.finalAcquisitionCost, undefined);
});

test("OpenLane post-sale pending negotiation keeps sold and counter amounts as candidate labels", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-post-sale-pending.html"), "https://www.openlane.ca/post-sale/camry");
  const metadata = listing.openlaneMetadata as { negotiation?: Record<string, unknown> };
  const semantics = listing.priceSemantics as Record<string, string>;

  assert.equal(listing.pageType, "post_sale");
  assert.equal(listing.captureKind, "candidate_outcome");
  assert.equal(listing.outcomeConfidence, "medium");
  assert.equal(listing.vin, "4T1G11AK8LU123456");
  assert.equal(listing.soldPriceCandidate, 18_250);
  assert.equal(listing.counterOfferAmount, 17_750);
  assert.equal(listing.acceptedAmount, undefined);
  assert.equal(listing.negotiatedAmount, undefined);
  assert.equal(listing.finalBidAmount, undefined);
  assert.equal(semantics.soldPriceCandidate, "candidate_wholesale_label");
  assert.equal(semantics.counterOfferAmount, "candidate_wholesale_label");
  assert.equal(metadata.negotiation?.negotiationStatus, "Pending");
  assert.ok((listing.outcomeEvidence as Array<{ evidenceType?: string }>).every((item) => item.evidenceType !== "accepted_negotiation"));
});

test("OpenLane accepted post-sale negotiation promotes accepted amount to verified outcome", () => {
  const listing = extractor.extractOpenLaneFixture(fixture("openlane-post-sale-accepted.html"), "https://www.openlane.ca/post-sale/camry");
  const metadata = listing.openlaneMetadata as { negotiation?: Record<string, unknown> };
  const semantics = listing.priceSemantics as Record<string, string>;

  assert.equal(listing.pageType, "post_sale");
  assert.equal(listing.captureKind, "verified_outcome");
  assert.equal(listing.outcomeConfidence, "verified");
  assert.equal(listing.soldPriceCandidate, 18_250);
  assert.equal(listing.counterOfferAmount, 17_900);
  assert.equal(listing.acceptedAmount, 17_900);
  assert.equal(listing.negotiatedAmount, 17_900);
  assert.equal(listing.finalBidAmount, 17_900);
  assert.equal(semantics.soldPriceCandidate, "candidate_wholesale_label");
  assert.equal(semantics.acceptedAmount, "verified_wholesale_label");
  assert.equal(semantics.negotiatedAmount, "verified_wholesale_label");
  assert.equal(semantics.finalBidAmount, "verified_wholesale_label");
  assert.equal(metadata.negotiation?.negotiationStatus, "Accepted");
  assert.ok((listing.outcomeEvidence as Array<{ evidenceType?: string }>).some((item) => item.evidenceType === "accepted_negotiation"));
});

test("OpenLane rejected and ambiguous post-sale prices never become verified labels", () => {
  const rejected = extractor.extractOpenLaneFixture(fixture("openlane-post-sale-rejected.html"), "https://www.openlane.ca/post-sale/civic");
  const ambiguous = extractor.extractOpenLaneFixture(fixture("openlane-post-sale-ambiguous-sold.html"), "https://www.openlane.ca/post-sale/escape");

  assert.equal(rejected.pageType, "post_sale");
  assert.equal(rejected.captureKind, "candidate_outcome");
  assert.equal(rejected.soldPriceCandidate, 19_400);
  assert.equal(rejected.counterOfferAmount, 18_750);
  assert.equal(rejected.acceptedAmount, undefined);
  assert.equal(rejected.negotiatedAmount, undefined);
  assert.equal((rejected.openlaneMetadata as { negotiation?: Record<string, unknown> }).negotiation?.negotiationStatus, "Rejected");

  assert.equal(ambiguous.pageType, "post_sale");
  assert.equal(ambiguous.captureKind, "candidate_outcome");
  assert.equal(ambiguous.soldPriceCandidate, 14_600);
  assert.equal(ambiguous.acceptedAmount, undefined);
  assert.equal(ambiguous.negotiatedAmount, undefined);
  assert.ok((ambiguous.warnings as string[]).some((warning) => /not accepted/i.test(warning)));
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

function fakeDocument(text: string) {
  return {
    title: "OpenLane",
    body: { innerText: text, textContent: text },
    images: [] as unknown[],
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}
