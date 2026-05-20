import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    debug: {
      sectionMapSummary: { summary: { vehicleHero: { textLength: 120, ignored: false } } },
      candidateScores: [{ text: "2021 Toyota RAV4", source: "section-map:vehicleHero", score: 95 }],
      rejectedCandidates: [{ text: "Sales history of similar vehicles", rejectedReason: "market_guide_heading" }],
      warnings: [],
    },
    openlaneMetadata: {
      runNumber: "42",
      lane: "A",
      sectionMapSummary: { summary: { vehicleHero: { textLength: 120, ignored: false }, sidebar: { textLength: 240, ignored: true } } },
      networkEvidence: [{ endpointPattern: "app.openlane.ca/api/vdp/:id", candidateCounts: { vin: 1, media: 2, condition: 1 } }],
      mediaFiltering: { rejected: [{ url: "https://www.openlane.ca/openlane-logo.svg", reason: "logo_or_icon" }] },
    },
    extractedFields: { lane: "A", runNumber: "42" },
    extractionConfidenceScore: 88,
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.carfaxUrlStatus, "url_found");
  assert.equal(Array.isArray(result.data?.debug?.candidateScores), true);
  assert.equal(Array.isArray(result.data?.openlaneMetadata?.networkEvidence), true);
});

test("Market Snap validation preserves normalized CARFAX status and evidence", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    marketType: "auction_market",
    listingUrl: "https://app.openlane.ca/vdp/KM8J3CA46HU123456",
    title: "2017 Hyundai Tucson",
    year: 2017,
    make: "Hyundai",
    model: "Tucson",
    vin: "KM8J3CA46HU123456",
    mileageKm: 111486,
    pageType: "active_listing",
    captureKind: "observation",
    carfaxMentioned: true,
    carfaxAvailable: true,
    carfaxUrl: "https://app.openlane.ca/vehicle-history/carfax/TUCSON999",
    carfaxUrlStatus: "url_found",
    carfax: {
      mentioned: true,
      available: true,
      url: "https://app.openlane.ca/vehicle-history/carfax/TUCSON999",
      urlStatus: "url_found",
      evidence: [{ source: "network_json", sourceText: "/vehicle-history/carfax/TUCSON999" }],
    },
    fieldEvidence: {
      carfaxUrl: [{
        field: "carfaxUrl",
        value: "https://app.openlane.ca/vehicle-history/carfax/TUCSON999",
        normalizedValue: "https://app.openlane.ca/vehicle-history/carfax/TUCSON999",
        sourceType: "network_json",
        sourceName: "vehicle.carfax.reportUrl",
        sourceText: "/vehicle-history/carfax/TUCSON999",
        endpointPattern: "app.openlane.ca/api/vdp/:id",
        pageType: "active_listing",
        captureKind: "observation",
        confidenceScore: 92,
        capturedAt: "2026-05-17T12:00:00.000Z",
      }],
    },
    extractionConfidenceScore: 88,
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.carfaxUrlStatus, "url_found");
  assert.equal(result.data?.fieldEvidence?.carfaxUrl?.[0]?.sourceType, "network_json");
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

test("Market Snap validation rejects unsafe deep extraction URLs and oversized debug payloads", () => {
  assert.equal(marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
    debug: {
      candidateScores: Array.from({ length: 161 }, (_, index) => ({ text: `candidate ${index}`, score: 1 })),
    },
  }).success, false);

  assert.equal(marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
    openlaneMetadata: {
      networkEvidence: [{ endpointPattern: "app.openlane.ca/api/vdp/:id", sessionToken: "must-not-arrive" }],
    },
  }).success, false);

  assert.equal(marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
    media: {
      rejectedMedia: [{ url: "data:image/png;base64,AAAA", reason: "inline_blob" }],
    },
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

test("Market Snap validation rejects observation payloads that carry outcome price fields", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2017 Hyundai Tucson",
    year: 2017,
    make: "Hyundai",
    model: "Tucson",
    currentBid: 5_100,
    soldPriceCandidate: 4_000,
    priceSemantics: {
      currentBid: "observation",
      soldPriceCandidate: "candidate_wholesale_label",
    },
  });

  assert.equal(result.success, false);
});

test("Market Snap validation rejects observation payloads with auction buy outcome fields", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2017 Kia Forte",
    year: 2017,
    make: "Kia",
    model: "Forte",
    currentBid: 5_100,
    buyPriceAuction: 4_000,
    priceSemantics: {
      currentBid: "observation",
      buyPriceAuction: "verified_wholesale_label",
    },
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
    listedPrice: 16_500,
    currentBid: 16_500,
    priceSemantics: {
      listedPrice: "observation_alias_current_bid",
      currentBid: "observation",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.pageType, "active_listing");
  assert.equal(result.data?.captureKind, "observation");
  assert.equal(result.data?.priceSemantics?.listedPrice, "observation_alias_current_bid");
  assert.equal(result.data?.priceSemantics?.currentBid, "observation");
  assert.equal(result.data?.finalBidAmount, undefined);
});

test("Market Snap validation rejects bid-count evidence as canonical OpenLane price data", () => {
  const badPriceFixture = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/openlane/openlane-backend-bad-price-evidence.json"), "utf8"));
  const currentBidCount = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2018 Kia Stinger GT",
    year: 2018,
    make: "Kia",
    model: "Stinger",
    currentBid: 4,
    priceSemantics: {
      currentBid: "observation",
    },
    fieldEvidence: {
      currentBid: [{
        field: "currentBid",
        value: 4,
        normalizedValue: 4,
        sourceType: "section_map",
        sourceName: "OpenLane bid panel",
        sourceText: badPriceFixture.bidCountEvidence.sourceText,
        confidenceScore: 72,
        capturedAt: "2026-05-18T12:00:00.000Z",
      }],
    },
  });
  const listedBidCount = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2018 Kia Stinger GT",
    year: 2018,
    make: "Kia",
    model: "Stinger",
    listedPrice: 4,
    priceSemantics: {
      listedPrice: "observation_alias_current_bid",
    },
    fieldEvidence: {
      listedPrice: [{
        field: "listedPrice",
        value: 4,
        normalizedValue: 4,
        sourceType: "section_map",
        sourceName: "OpenLane bid panel",
        sourceText: badPriceFixture.bidCountEvidence.sourceText,
        confidenceScore: 72,
        capturedAt: "2026-05-18T12:00:00.000Z",
      }],
    },
  });
  const currentBidFiftyNineCount = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2020 Mazda CX-5",
    year: 2020,
    make: "Mazda",
    model: "CX-5",
    currentBid: 59,
    priceSemantics: {
      currentBid: "observation",
    },
    fieldEvidence: {
      currentBid: [{
        field: "currentBid",
        value: 59,
        normalizedValue: 59,
        sourceType: "section_map",
        sourceName: "OpenLane bid panel",
        sourceText: "59 Bids",
        confidenceScore: 72,
        capturedAt: "2026-05-18T12:00:00.000Z",
      }],
    },
  });
  const currentBidSeventyOneCount = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2020 Nissan Frontier",
    year: 2020,
    make: "Nissan",
    model: "Frontier",
    currentBid: 71,
    priceSemantics: {
      currentBid: "observation",
    },
    fieldEvidence: {
      currentBid: [{
        field: "currentBid",
        value: 71,
        normalizedValue: 71,
        sourceType: "section_map",
        sourceName: "OpenLane bid panel",
        sourceText: "71 Bids",
        confidenceScore: 72,
        capturedAt: "2026-05-20T12:00:00.000Z",
      }],
    },
  });

  assert.equal(currentBidCount.success, false);
  assert.equal(listedBidCount.success, false);
  assert.equal(currentBidFiftyNineCount.success, false);
  assert.equal(currentBidSeventyOneCount.success, false);
});

test("Market Snap validation preserves valid low OpenLane current bids with strong money evidence", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2018 Kia Stinger GT",
    year: 2018,
    make: "Kia",
    model: "Stinger",
    currentBid: 4,
    priceSemantics: {
      currentBid: "observation",
    },
    fieldEvidence: {
      currentBid: [{
        field: "currentBid",
        value: 4,
        normalizedValue: 4,
        sourceType: "section_map",
        sourceName: "OpenLane bid panel",
        sourceText: "Current bid $4",
        confidenceScore: 92,
        capturedAt: "2026-05-18T12:00:00.000Z",
      }],
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.currentBid, 4);

  const withBidCountNearby = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2018 Kia Stinger GT",
    year: 2018,
    make: "Kia",
    model: "Stinger",
    currentBid: 4,
    priceSemantics: {
      currentBid: "observation",
    },
    fieldEvidence: {
      currentBid: [{
        field: "currentBid",
        value: 4,
        normalizedValue: 4,
        sourceType: "section_map",
        sourceName: "OpenLane bid panel",
        sourceText: "Current bid $4 4 Bids",
        confidenceScore: 92,
        capturedAt: "2026-05-18T12:00:00.000Z",
      }],
    },
  });

  assert.equal(withBidCountNearby.success, true);
  assert.equal(withBidCountNearby.data?.currentBid, 4);
});

test("Market Snap validation accepts live money current bid with nearby bid count as observation", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2020 Nissan Frontier Crew Cab",
    year: 2020,
    make: "Nissan",
    model: "Frontier",
    currentBid: 14_200,
    listedPrice: 14_200,
    priceSemantics: {
      currentBid: "observation",
      listedPrice: "observation_alias_current_bid",
    },
    fieldEvidence: {
      currentBid: [{
        field: "currentBid",
        value: 14_200,
        normalizedValue: 14_200,
        sourceType: "section_map",
        sourceName: "OpenLane bid panel",
        sourceText: "Current bid $14,200 71 Bids",
        confidenceScore: 96,
        capturedAt: "2026-05-20T12:00:00.000Z",
      }],
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.currentBid, 14_200);
  assert.equal(result.data?.priceSemantics?.currentBid, "observation");
});

test("Market Snap validation rejects transport evidence as canonical OpenLane price data", () => {
  const badPriceFixture = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/openlane/openlane-backend-bad-price-evidence.json"), "utf8"));
  for (const field of ["currentBid", "listedPrice", "soldPriceCandidate"] as const) {
    const result = marketListingPayloadSchema.safeParse({
      organizationId,
      sourceName: "OpenLane",
      sourceType: "auction",
      pageType: field === "soldPriceCandidate" ? "purchase_detail" : "active_listing",
      captureKind: field === "soldPriceCandidate" ? "candidate_outcome" : "observation",
      title: "2017 Hyundai Tucson",
      year: 2017,
      make: "Hyundai",
      model: "Tucson",
      [field]: badPriceFixture.transportEstimateEvidence.value,
      priceSemantics: {
        [field]: field === "soldPriceCandidate" ? "candidate_wholesale_label" : "observation",
      },
      outcomeEvidence: field === "soldPriceCandidate" ? [{
        evidenceType: "visible_page_text",
        sourceText: badPriceFixture.transportEstimateEvidence.sourceText,
        capturedAt: "2026-05-18T12:00:00.000Z",
      }] : undefined,
      fieldEvidence: {
        [field]: [{
          field,
          value: badPriceFixture.transportEstimateEvidence.value,
          normalizedValue: badPriceFixture.transportEstimateEvidence.value,
          sourceType: "section_map",
          sourceName: "OpenLane sidebar",
          sourceText: badPriceFixture.transportEstimateEvidence.sourceText,
          confidenceScore: 70,
          capturedAt: "2026-05-18T12:00:00.000Z",
        }],
      },
    });

    assert.equal(result.success, false, `${field} should reject transport evidence`);
  }
});

test("Market Snap validation treats active offers as observation-only price fields", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2021 Toyota RAV4 LE",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
    currentOffer: 13_400,
    bestOffer: 13_900,
    priceSemantics: {
      currentOffer: "observation",
      bestOffer: "observation",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.currentOffer, 13_400);
  assert.equal(result.data?.bestOffer, 13_900);
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
    outcomeEvidence: [{
      evidenceType: "visible_page_text",
      sourceText: "Sold Price $18,250 Counter Offer $17,750 Pending",
      capturedAt: "2026-05-15T12:00:00.000Z",
    }],
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
    vin: "4T1G11AK1LU123456",
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

test("Market Snap validation requires evidence for candidate OpenLane outcome prices", () => {
  const withEvidence = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "purchase_detail",
    captureKind: "candidate_outcome",
    title: "2017 Hyundai Tucson",
    year: 2017,
    make: "Hyundai",
    model: "Tucson",
    soldPriceCandidate: 4_000,
    outcomeConfidence: "medium",
    outcomeEvidence: [{
      evidenceType: "visible_page_text",
      sourceText: "Sold price $4,000",
      capturedAt: "2026-05-18T12:00:00.000Z",
      confidenceScore: 90,
    }],
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
    },
  });
  const withoutEvidence = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "purchase_detail",
    captureKind: "candidate_outcome",
    title: "2017 Hyundai Tucson",
    year: 2017,
    make: "Hyundai",
    model: "Tucson",
    soldPriceCandidate: 4_000,
    outcomeConfidence: "medium",
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
    },
  });

  assert.equal(withEvidence.success, true);
  assert.equal(withEvidence.data?.soldPriceCandidate, 4_000);
  assert.equal(withoutEvidence.success, false);
});

test("Market Snap validation accepts verified purchased VDP outcome with strong evidence", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "purchase_detail",
    captureKind: "verified_outcome",
    title: "2017 Hyundai Tucson",
    year: 2017,
    make: "Hyundai",
    model: "Tucson",
    vin: "KM8J3CA46HU123456",
    buyPriceAuction: 4_000,
    soldPriceCandidate: 4_000,
    outcomeConfidence: "verified",
    outcomeEvidence: [{
      evidenceType: "purchase_document",
      sourceText: "Purchased VDP Sold price $4,000 Status Picked up",
      capturedAt: "2026-05-18T12:00:00.000Z",
      confidenceScore: 96,
    }],
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
      buyPriceAuction: "verified_wholesale_label",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.buyPriceAuction, 4_000);

  const kia = marketListingPayloadSchema.safeParse({
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

  assert.equal(kia.success, true);
  assert.equal(kia.data?.soldPriceCandidate, 4_000);
  assert.equal(kia.data?.buyPriceAuction, 4_000);
});

test("Market Snap validation accepts purchase-list outcome candidates with sold price evidence", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "purchase_list",
    captureKind: "candidate_outcome",
    title: "2017 Kia Forte",
    year: 2017,
    make: "Kia",
    model: "Forte",
    vin: "3KPFK4A77HE123456",
    soldPriceCandidate: 4_000,
    outcomeConfidence: "medium",
    outcomeEvidence: [{
      evidenceType: "visible_page_text",
      sourceText: "Purchase card Sold price $4,000",
      capturedAt: "2026-05-20T12:00:00.000Z",
      confidenceScore: 92,
    }],
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.pageType, "purchase_list");
  assert.equal(result.data?.soldPriceCandidate, 4_000);
});

test("Market Snap validation rejects OpenLane purchase outcomes without a sold or acquisition price", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "purchase_detail",
    captureKind: "candidate_outcome",
    title: "2017 Kia Forte",
    year: 2017,
    make: "Kia",
    model: "Forte",
    vin: "3KPFK4A77HE123456",
    outcomeConfidence: "medium",
    outcomeEvidence: [{
      evidenceType: "visible_page_text",
      sourceText: "Order history Mark as picked up",
      capturedAt: "2026-05-20T12:00:00.000Z",
      confidenceScore: 82,
    }],
  });

  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error?.issues), /sold or acquisition price/i);
});

test("Market Snap validation rejects verified OpenLane outcome without VIN", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "purchase_detail",
    captureKind: "verified_outcome",
    title: "2017 Kia Forte",
    year: 2017,
    make: "Kia",
    model: "Forte",
    buyPriceAuction: 4_000,
    soldPriceCandidate: 4_000,
    outcomeConfidence: "verified",
    outcomeEvidence: [{
      evidenceType: "purchase_document",
      sourceText: "Order history Sold price $4,000 Mark as picked up",
      capturedAt: "2026-05-20T12:00:00.000Z",
      confidenceScore: 96,
    }],
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
      buyPriceAuction: "verified_wholesale_label",
    },
  });

  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error?.issues), /valid VIN/i);
});

test("Market Snap validation rejects verified outcome without a verified price field", () => {
  const result = marketListingPayloadSchema.safeParse({
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
    outcomeConfidence: "verified",
    outcomeEvidence: [{
      evidenceType: "purchase_document",
      sourceText: "Order history Sold price $4,000 Mark as picked up",
      capturedAt: "2026-05-18T12:00:00.000Z",
      confidenceScore: 96,
    }],
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
    },
  });

  assert.equal(result.success, false);
});

test("Market Snap validation rejects fake CARFAX URLs on OpenLane captures", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2017 Hyundai Tucson",
    year: 2017,
    make: "Hyundai",
    model: "Tucson",
    vin: "KM8J3CA46HU123456",
    currentBid: 14_200,
    carfaxUrl: "https://example.com/fake-carfax-report",
    carfaxUrlStatus: "url_found",
    priceSemantics: {
      currentBid: "observation",
    },
  });

  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error?.issues), /CARFAX URL/i);
});

test("Market Snap validation rejects canonical condition fields polluted by bid, legal, or transport text", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2017 Hyundai Tucson",
    year: 2017,
    make: "Hyundai",
    model: "Tucson",
    vin: "KM8J3CA46HU123456",
    currentBid: 5_100,
    conditionReportText: "Mechanical Engine and transmission are good. Full bid history 29 Bids. OPENLANE Inc. All rights reserved. Transport estimate CAD $428 / 185km.",
    condition: {
      conditionReportText: "Mechanical Engine and transmission are good. Full bid history 29 Bids. OPENLANE Inc. All rights reserved. Transport estimate CAD $428 / 185km.",
    },
    priceSemantics: {
      currentBid: "observation",
    },
  });

  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error?.issues), /condition/i);
});

test("Market Snap validation rejects outcome prices on unsupported OpenLane page types", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "documents",
    captureKind: "candidate_outcome",
    title: "2017 Kia Forte",
    year: 2017,
    make: "Kia",
    model: "Forte",
    soldPriceCandidate: 4_000,
    outcomeConfidence: "medium",
    outcomeEvidence: [{
      evidenceType: "visible_page_text",
      sourceText: "Document notes mention sold price $4,000",
      capturedAt: "2026-05-18T12:00:00.000Z",
      confidenceScore: 80,
    }],
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
    },
  });

  assert.equal(result.success, false);
});

test("Market Snap validation rejects current bid semantics marked as label", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2021 Toyota RAV4 LE",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
    currentBid: 13_400,
    priceSemantics: {
      currentBid: "candidate_wholesale_label",
    },
  });

  assert.equal(result.success, false);
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
  const nullableValuation = saveListingSchema.safeParse({
    organizationId,
    listing: {
      sourceName: "OpenLane",
      sourceType: "auction",
      title: "2017 Hyundai Tucson",
      year: 2017,
      make: "Hyundai",
      model: "Tucson",
    },
    valuation: null,
  });
  assert.equal(nullableValuation.success, true);
  assert.equal(nullableValuation.data?.valuation, undefined);
  assert.equal(saveListingSchema.safeParse({ organizationId }).success, false);
});

test("Market Snap validation rejects mileage that is evidenced as transport distance", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2017 Hyundai Tucson AWD",
    year: 2017,
    make: "Hyundai",
    model: "Tucson",
    mileageKm: 185,
    currentBid: 4600,
    fieldEvidence: {
      mileageKm: [{
        field: "mileageKm",
        value: 185,
        normalizedValue: 185,
        sourceType: "section_map",
        sourceName: "OpenLane DOM",
        sourceText: "Transport estimate CAD $428 / 185km pickup to delivery",
        confidenceScore: 70,
        capturedAt: "2026-05-17T12:00:00.000Z",
      }],
    },
  });

  assert.equal(result.success, false);
});

test("Market Snap validation rejects invalid VIN and accepts safe odometer evidence", () => {
  assert.equal(marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2017 Hyundai Tucson AWD",
    vin: "KM8JICA4OHU12345Q",
    year: 2017,
    make: "Hyundai",
    model: "Tucson",
    mileageKm: 111486,
  }).success, false);

  assert.equal(marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2017 Hyundai Tucson AWD",
    vin: "KM8J3CA46HU123456",
    year: 2017,
    make: "Hyundai",
    model: "Tucson",
    mileageKm: 111486,
    fieldEvidence: {
      mileageKm: [{
        field: "mileageKm",
        value: 111486,
        normalizedValue: 111486,
        sourceType: "dom_label",
        sourceName: "OpenLane DOM",
        sourceText: "Vehicle information Odometer 111,486 KM",
        confidenceScore: 90,
        capturedAt: "2026-05-17T12:00:00.000Z",
      }],
    },
  }).success, true);
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
