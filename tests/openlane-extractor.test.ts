import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
require("../browser-extension/src/openlane-extraction-contract.js");
const classifier = require("../browser-extension/src/openlane-page-classifier.js") as {
  classifyOpenLanePageFromHtml: (html: string, href?: string) => {
    pageType: string;
    captureKind: string;
    confidenceScore: number;
    evidence: Array<{ marker: string }>;
    warnings: string[];
  };
};
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
