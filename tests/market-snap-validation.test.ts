import assert from "node:assert/strict";
import test from "node:test";
import { authorizedExtractionRequestSchema, authorizedExtractionResponseSchema, importPayloadSchema, marketListingPayloadSchema, saveListingSchema } from "../src/lib/market-snap/validation";

const organizationId = "63c47786-fb41-40c1-a573-71346969b9e0";

test("Market Snap validation accepts visible extension listing data with condition features", () => {
  const parsed = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    listingUrl: "https://example.com/listings/123",
    title: "2021 Honda Civic EX",
    year: 2021,
    make: "Honda",
    model: "Civic",
    mileageKm: 60000,
    auctionHammerPrice: 14500,
    conditionFeatures: {
      title: { cleanTitle: true },
    },
    imageFeatures: {
      imageCount: 8,
      photoAnalysisStatus: "processed",
    },
  });

  assert.equal(parsed.success, true);
});

test("Market Snap validation accepts rich OpenLane extension payloads", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    sourceName: "OpenLane",
    sourceType: "auction",
    marketType: "auction_market",
    listingUrl: "https://www.openlane.ca/vehicle/123",
    title: "2021 Toyota RAV4 XLE AWD",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
    trim: "XLE AWD",
    vin: "2T3R1RFV5MW123456",
    mileageKm: 52300,
    currentBid: 18500,
    buyNowPrice: 22900,
    listedPrice: 22900,
    carfaxUrl: "https://www.carfax.ca/report/ABC123",
    carfaxMentioned: true,
    carfaxAvailable: true,
    carfaxUrlStatus: "url_found",
    photos: [{ url: "https://img.openlane.ca/vehicle/front.jpg", source: "img", width: 800, height: 600 }],
    videos: [{ url: "https://media.openlane.ca/walkaround.mp4", source: "video", type: "video/mp4" }],
    imageCount: 1,
    videoCount: 1,
    declarations: ["Accident repair"],
    conditionReportText: "Minor scratches on rear bumper.",
    missingData: ["diagnostic_codes_unknown"],
    warnings: ["Carfax link was visible."],
    rawVisibleText: "Visible OpenLane page text",
    pageContext: { pageType: "active_listing", captureKind: "observation", evidence: [] },
    identity: { vin: "2T3R1RFV5MW123456", year: 2021, make: "Toyota", model: "RAV4", evidence: [] },
    auctionObservation: { currentBid: 18500, buyNowPrice: 22900, evidence: [] },
    purchaseOutcome: { evidence: [] },
    condition: { conditionReportText: "Minor scratches on rear bumper.", evidence: [] },
    media: { photoCountVisible: 1, videoCountVisible: 1, evidence: [] },
    carfax: { mentioned: true, available: true, url: "https://www.carfax.ca/report/ABC123", urlStatus: "url_found", evidence: [] },
    debug: { warnings: [], rejectedCandidates: [] },
    openlaneMetadata: { runNumber: "42", lane: "A" },
    extractedFields: { lane: "A", runNumber: "42" },
    extractionConfidenceScore: 88,
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.carfaxUrlStatus, "url_found");
});

test("Market Snap validation rejects unsafe OpenLane media URLs and oversized raw text", () => {
  assert.equal(marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
    photos: [{ url: "data:image/png;base64,AAA", source: "img" }],
  }).success, false);

  assert.equal(marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
    rawVisibleText: "x".repeat(12_001),
  }).success, false);
});

test("Market Snap validation rejects active listing payloads that claim verified outcome prices", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "verified_outcome",
    title: "2022 Toyota Corolla LE",
    year: 2022,
    make: "Toyota",
    model: "Corolla",
    currentBid: 16_500,
    finalBidAmount: 16_500,
    priceSemantics: {
      currentBid: "observation",
      finalBidAmount: "verified_wholesale_label",
    },
    outcomeConfidence: "verified",
    outcomeEvidence: [{
      evidenceType: "visible_page_text",
      sourceText: "Current bid $16,500",
      capturedAt: "2026-05-14T12:00:00.000Z",
    }],
  });

  assert.equal(result.success, false);
});

test("Market Snap validation accepts currentBid as observation without treating it as a final label", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2022 Toyota Corolla LE",
    year: 2022,
    make: "Toyota",
    model: "Corolla",
    currentBid: 16_500,
    priceSemantics: {
      currentBid: "observation",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.pageType, "active_listing");
  assert.equal(result.data?.captureKind, "observation");
  assert.equal(result.data?.priceSemantics?.currentBid, "observation");
  assert.equal(result.data?.finalBidAmount, undefined);
});

test("Market Snap validation accepts purchase fee payloads with itemized acquisition costs", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "fee_details",
    captureKind: "candidate_outcome",
    title: "2021 Honda CR-V EX-L",
    year: 2021,
    make: "Honda",
    model: "CR-V",
    buyPriceAuction: 23_400,
    transactionFee: 450,
    vehicleHistoryFee: 49.95,
    otherFees: 125,
    subtotal: 24_024.95,
    taxes: 3_612.74,
    totalInvoiceAmount: 27_637.69,
    finalAcquisitionCost: 27_637.69,
    outcomeConfidence: "high",
    outcomeEvidence: [{
      evidenceType: "fee_details_page",
      sourceText: "Buy price $23,400 Transaction fee $450 Total $27,637.69",
      capturedAt: "2026-05-14T12:00:00.000Z",
    }],
    priceSemantics: {
      buyPriceAuction: "verified_wholesale_label",
      transactionFee: "acquisition_cost_component",
      vehicleHistoryFee: "acquisition_cost_component",
      otherFees: "acquisition_cost_component",
      subtotal: "acquisition_cost_component",
      taxes: "acquisition_cost_component",
      totalInvoiceAmount: "final_acquisition_cost",
      finalAcquisitionCost: "final_acquisition_cost",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.pageType, "fee_details");
  assert.equal(result.data?.captureKind, "candidate_outcome");
  assert.equal(result.data?.buyPriceAuction, 23_400);
  assert.equal(result.data?.transactionFee, 450);
  assert.equal(result.data?.vehicleHistoryFee, 49.95);
  assert.equal(result.data?.subtotal, 24_024.95);
  assert.equal(result.data?.taxes, 3_612.74);
  assert.equal(result.data?.totalInvoiceAmount, 27_637.69);
  assert.equal(result.data?.finalAcquisitionCost, 27_637.69);
  assert.equal(result.data?.priceSemantics?.totalInvoiceAmount, "final_acquisition_cost");
});

test("Market Snap validation keeps post-sale negotiation candidates separate from verified labels", () => {
  const candidate = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "post_sale",
    captureKind: "candidate_outcome",
    title: "2020 Toyota Camry SE",
    soldPriceCandidate: 18_250,
    counterOfferAmount: 17_750,
    negotiationStatus: "Pending",
    outcomeConfidence: "medium",
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
      counterOfferAmount: "candidate_wholesale_label",
    },
  });
  const unsafeVerified = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "post_sale",
    captureKind: "verified_outcome",
    title: "2020 Toyota Camry SE",
    soldPriceCandidate: 18_250,
    negotiationStatus: "Pending",
    outcomeConfidence: "verified",
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
    },
  });
  const accepted = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "post_sale",
    captureKind: "verified_outcome",
    title: "2020 Toyota Camry SE",
    soldPriceCandidate: 18_250,
    acceptedAmount: 17_900,
    negotiatedAmount: 17_900,
    finalBidAmount: 17_900,
    negotiationStatus: "Accepted",
    outcomeConfidence: "verified",
    outcomeEvidence: [{
      evidenceType: "accepted_negotiation",
      sourceText: "Seller accepted the negotiated offer.",
      capturedAt: "2026-05-15T12:00:00.000Z",
    }],
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
      acceptedAmount: "verified_wholesale_label",
      negotiatedAmount: "verified_wholesale_label",
      finalBidAmount: "verified_wholesale_label",
    },
  });

  assert.equal(candidate.success, true);
  assert.equal(candidate.data?.soldPriceCandidate, 18_250);
  assert.equal(candidate.data?.counterOfferAmount, 17_750);
  assert.equal(unsafeVerified.success, false);
  assert.equal(accepted.success, true);
  assert.equal(accepted.data?.acceptedAmount, 17_900);
  assert.equal(accepted.data?.finalBidAmount, 17_900);
});

test("Market Snap validation rejects unsafe or malformed listing payloads", () => {
  const parsed = marketListingPayloadSchema.safeParse({
    organizationId: "not-an-org",
    sourceName: "",
    listingUrl: "javascript:alert(1)",
    year: 1800,
    listedPrice: -1,
  });

  assert.equal(parsed.success, false);
});

test("Deal Radar save payload requires an organization and a listing object", () => {
  assert.equal(saveListingSchema.safeParse({
    organizationId,
    listing: {
      sourceName: "Facebook Marketplace",
      sourceType: "extension",
      title: "2020 Toyota Corolla",
      year: 2020,
      make: "Toyota",
      model: "Corolla",
      listedPrice: 15000,
    },
  }).success, true);
  assert.equal(saveListingSchema.safeParse({ organizationId }).success, false);
});

test("Market Snap import validation allows row source override", () => {
  assert.equal(importPayloadSchema.safeParse({
    organizationId,
    sourceName: "Manual JSON Import",
    rows: [{ sourceName: "Auction export", year: 2020, make: "Toyota", model: "Corolla", listedPrice: 18000 }],
  }).success, true);
});

test("Market Snap authorized extraction schemas accept normalized Scrapling output", () => {
  assert.equal(authorizedExtractionRequestSchema.safeParse({
    organizationId,
    html: "<h1>2021 Honda Civic EX</h1><p>$18,995</p>",
    sourceName: "Authorized Capture",
    sourceUrl: "https://example.test/listing",
    sourceType: "retail",
    permissionBasis: "User-assisted visible listing capture.",
    robotsAllowed: true,
  }).success, true);

  assert.equal(authorizedExtractionResponseSchema.safeParse({
    ok: true,
    listing: {
      sourceName: "Authorized Capture",
      sourceType: "retail",
      listingUrl: "https://example.test/listing",
      title: "2021 Honda Civic EX",
      year: 2021,
      make: "Honda",
      model: "Civic",
      trim: "EX",
      mileageKm: 62000,
      listedPrice: 18995,
      imageUrls: ["https://example.test/photo.jpg"],
    },
    extractionQualityScore: 85,
    warnings: [],
    missingFields: [],
    degraded: false,
    policyDecision: "allowed",
    policyReasons: ["supplied HTML only"],
    fallbackStrategies: ["csv_import"],
  }).success, true);
});
