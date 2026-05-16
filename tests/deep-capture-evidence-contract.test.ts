import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { marketListingPayloadSchema } from "../src/lib/market-snap/validation";

const require = createRequire(import.meta.url);
const contract = require("../browser-extension/src/openlane-extraction-contract.js") as {
  applyOpenLaneExtractionContract: (listing: Record<string, unknown>) => Record<string, unknown>;
  addFieldEvidence: (map: Record<string, unknown[]>, field: string, value: unknown, options: Record<string, unknown>) => void;
  chooseBestEvidence: (items: Array<{ value: unknown; confidenceScore: number; sourceType: string }>) => { value: unknown; confidenceScore: number; sourceType: string };
  normalizeEvidenceValue: (field: string, value: unknown) => unknown;
  redactEvidence: (item: Record<string, unknown>) => Record<string, unknown>;
  scoreEvidence: (item: Record<string, unknown>) => number;
};

const organizationId = "63c47786-fb41-40c1-a573-71346969b9e0";

test("OpenLane extraction contract exports evidence helpers", () => {
  for (const helper of ["addFieldEvidence", "chooseBestEvidence", "normalizeEvidenceValue", "redactEvidence", "scoreEvidence"]) {
    assert.equal(typeof contract[helper], "function");
  }
});

test("OpenLane extraction contract creates normalized field evidence without breaking flat fields", () => {
  const listing = contract.applyOpenLaneExtractionContract({
    organizationId,
    sourceName: "OpenLane",
    listingUrl: "https://app.openlane.ca/vdp/123",
    pageType: "active_listing",
    captureKind: "observation",
    captureLevel: "deep_capture",
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
    vin: "2T3R1RFV5MW123456",
    mileageKm: 52300,
    currentBid: 18500,
    buyNowPrice: 22900,
    carfaxAvailable: true,
    carfaxUrlStatus: "text_only",
    imageCount: 12,
    extractedFields: {
      vinEvidence: { source: "data-vin", sourceText: "data-vin=2T3R1RFV5MW123456" },
      mileageEvidence: { source: "dom_label", sourceText: "Odometer 52,300 KM" },
      debug: {
        networkCandidates: {
          fieldCandidates: [{
            field: "vin",
            value: "2T3R1RFV5MW123456",
            source: "vehicle.vin",
            endpointPattern: "app.openlane.ca/api/vdp/:id",
            confidence: 92,
            sourceText: "2T3R1RFV5MW123456",
            capturedAt: "2026-05-16T12:00:00.000Z",
          }],
        },
      },
    },
  });

  assert.equal(listing.vin, "2T3R1RFV5MW123456");
  assert.equal(listing.captureKind, "observation");
  const fieldEvidence = listing.fieldEvidence as Record<string, Array<Record<string, unknown>>>;
  assert.ok(fieldEvidence.vin.some((item) => item.sourceType === "network_json" && item.consentId === "33333333-3333-4333-8333-333333333333"));
  assert.ok(fieldEvidence.mileageKm.some((item) => item.sourceType === "dom_label"));
  assert.ok(fieldEvidence.currentBid.every((item) => item.captureKind === "observation"));
  assert.equal((listing.debug as { fieldEvidenceSummary: Record<string, { sourceType: string }> }).fieldEvidenceSummary.vin.sourceType, "network_json");
});

test("OpenLane evidence selection is deterministic and confidence-prioritized", () => {
  const best = contract.chooseBestEvidence([
    { value: "raw", confidenceScore: 55, sourceType: "fallback_regex" },
    { value: "dom", confidenceScore: 85, sourceType: "dom_label" },
    { value: "network", confidenceScore: 92, sourceType: "network_json" },
  ]);

  assert.equal(best.value, "network");
  assert.equal(best.sourceType, "network_json");

  assert.equal(contract.normalizeEvidenceValue("mileageKm", "52 300 KM"), 52300);
  assert.equal(contract.normalizeEvidenceValue("vin", "2t3r1rfv5mw123456"), "2T3R1RFV5MW123456");
});

test("OpenLane evidence redaction strips sensitive source text", () => {
  const redacted = contract.redactEvidence({
    field: "vin",
    value: "2T3R1RFV5MW123456",
    sourceType: "network_json",
    sourceText: "token eyJaaaaaaaaaaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccccc buyer@example.com 514-555-1212",
    confidenceScore: 92,
    capturedAt: "2026-05-16T12:00:00.000Z",
  });

  assert.doesNotMatch(JSON.stringify(redacted), /eyJaaaaaaaa|buyer@example\.com|514-555-1212/);
  assert.match(JSON.stringify(redacted), /\[redacted/);
});

test("Market Snap validation accepts capped normalized field evidence", () => {
  const parsed = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    captureLevel: "deep_capture",
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
    captureScopes: ["dom_visible", "network_response_observation"],
    title: "2021 Toyota RAV4",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
    fieldEvidence: {
      vin: [{
        field: "vin",
        value: "2T3R1RFV5MW123456",
        normalizedValue: "2T3R1RFV5MW123456",
        sourceType: "network_json",
        endpointPattern: "app.openlane.ca/api/vdp/:id",
        confidenceScore: 92,
        capturedAt: "2026-05-16T12:00:00.000Z",
        consentId: "33333333-3333-4333-8333-333333333333",
      }],
    },
  });

  assert.equal(parsed.success, true);
});
