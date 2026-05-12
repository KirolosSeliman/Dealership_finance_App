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
