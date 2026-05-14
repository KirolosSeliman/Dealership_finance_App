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
    carfaxAvailable: true,
    photos: [{ url: "https://img.openlane.ca/vehicle/front.jpg", source: "img", width: 800, height: 600 }],
    videos: [{ url: "https://media.openlane.ca/walkaround.mp4", source: "video", type: "video/mp4" }],
    imageCount: 1,
    videoCount: 1,
    declarations: ["Accident repair"],
    conditionReportText: "Minor scratches on rear bumper.",
    missingData: ["diagnostic_codes_unknown"],
    warnings: ["Carfax link was visible."],
    rawVisibleText: "Visible OpenLane page text",
    extractedFields: { lane: "A", runNumber: "42" },
    extractionConfidenceScore: 88,
  });

  assert.equal(result.success, true);
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
