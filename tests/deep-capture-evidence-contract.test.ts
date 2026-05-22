import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { marketListingPayloadSchema } from "../src/lib/market-snap/validation";

const require = createRequire(import.meta.url);
const contract = require("../browser-extension/src/openlane-extraction-contract.js") as {
  applyOpenLaneExtractionContract: (listing: Record<string, unknown>) => Record<string, unknown>;
  addFieldEvidence: (map: Record<string, unknown[]>, field: string, value: unknown, options: Record<string, unknown>) => void;
  chooseBestEvidence: (items: Array<{ value: unknown; confidenceScore: number; sourceType: string }>) => { value: unknown; confidenceScore: number; sourceType: string };
  canonicalToLegacyPayload: (canonical: Record<string, unknown>, legacy?: Record<string, unknown>) => Record<string, unknown>;
  createCanonicalOpenLaneState: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  normalizeOpenLaneCanonicalState: (listing: Record<string, unknown>) => Record<string, unknown>;
  normalizeEvidenceValue: (field: string, value: unknown) => unknown;
  redactEvidence: (item: Record<string, unknown>) => Record<string, unknown>;
  scoreEvidence: (item: Record<string, unknown>) => number;
};

const organizationId = "63c47786-fb41-40c1-a573-71346969b9e0";

test("OpenLane extraction contract exports evidence helpers", () => {
  for (const helper of ["addFieldEvidence", "chooseBestEvidence", "createCanonicalOpenLaneState", "normalizeOpenLaneCanonicalState", "canonicalToLegacyPayload", "normalizeEvidenceValue", "redactEvidence", "scoreEvidence"]) {
    assert.equal(typeof contract[helper], "function");
  }
});

test("OpenLane canonical state derives legacy current bid purchase Carfax and readiness fields", () => {
  const canonical = contract.createCanonicalOpenLaneState({
    identity: {
      vin: "3KPFK4A77HE123456",
      year: 2017,
      make: "Kia",
      model: "Forte",
      mileageKm: 111486,
      evidence: [{ field: "vin", sourceType: "network_json", sourceText: "VIN 3KPFK4A77HE123456" }],
    },
    pageContext: {
      pageType: "purchase_detail",
      captureKind: "candidate_outcome",
      outcomeConfidence: "high",
      evidence: [{ sourceText: "Sold price $4,000" }],
      ignoredEvidence: [{ sourceText: "Pickup scheduled", rejectionReason: "pickup_schedule_not_purchase_outcome" }],
    },
    activeAuction: {
      currentBid: 14200,
      evidence: [{ field: "currentBid", sourceType: "section_map", sourceText: "Current bid $14,200" }],
      staleCandidates: [{ value: 13800, rejectionReason: "stale_current_bid_candidate" }],
    },
    purchaseOutcome: {
      soldPriceCandidate: 4000,
      buyPriceAuction: 4000,
      finalBidAmount: null,
      evidence: [{ field: "soldPriceCandidate", sourceType: "purchase_detail_panel", sourceText: "Sold price $4,000" }],
    },
    carfax: {
      urlStatus: "url_found",
      url: "https://vhr.carfax.ca/report/example",
      available: true,
      evidence: [{ source: "href", sourceText: "View CARFAX" }],
      candidateCounts: { urlFoundCandidateCount: 1 },
      rejectedReasons: ["logo_only"],
    },
    readiness: {
      ready: true,
      state: "ready_to_capture",
      missingData: [],
      blockedReason: "",
    },
  });

  const legacy = contract.canonicalToLegacyPayload(canonical, {
    currentBid: 13800,
    soldPriceCandidate: undefined,
    carfaxUrlStatus: "text_only",
    missingData: ["listedPrice"],
    openlaneMetadata: {
      stableCaptureReadiness: {
        readyToCapture: false,
        state: "pending_vehicle_data",
        missingData: ["listedPrice"],
      },
    },
  });

  assert.equal(legacy.currentBid, 14200);
  assert.equal(legacy.soldPriceCandidate, 4000);
  assert.equal(legacy.buyPriceAuction, 4000);
  assert.equal(legacy.finalBidAmount, null);
  assert.equal(legacy.carfaxUrlStatus, "url_found");
  assert.equal(legacy.carfaxUrl, "https://vhr.carfax.ca/report/example");
  assert.deepEqual(legacy.missingData, []);
  assert.equal((legacy.openlaneMetadata as { stableCaptureReadiness: { readyToCapture: boolean; state: string } }).stableCaptureReadiness.readyToCapture, true);
  assert.equal((legacy.openlaneMetadata as { stableCaptureReadiness: { state: string } }).stableCaptureReadiness.state, "ready_to_capture");
  assert.equal((legacy.openlaneCanonicalState as { activeAuction: { currentBid: number } }).activeAuction.currentBid, 14200);
});

test("OpenLane canonical state derives active listing aliases and clean condition text only from canonical data", () => {
  const canonical = contract.createCanonicalOpenLaneState({
    pageContext: {
      pageType: "active_listing",
      captureKind: "observation",
    },
    activeAuction: {
      currentBid: 13_200,
      evidence: [{
        field: "currentBid",
        sourceType: "section_map",
        sourceName: "fresh bid panel",
        sourceText: "Current bid $13,200 Under 1 min",
        confidenceScore: 92,
      }],
    },
    condition: {
      mechanical: ["Transmission hesitation"],
      conditionReportText: "Transmission hesitation | Full bid history Current bid $13,100 | Transport estimate CAD $378 / 211km",
    },
    carfax: {
      urlStatus: "text_only",
      mentioned: true,
      evidence: [{ source: "visible_text", sourceText: "CARFAX Canada" }],
    },
  });

  const legacy = contract.canonicalToLegacyPayload(canonical, {
    listedPrice: 31_500,
    conditionReportText: "Full bid history Current bid $13,100 Transport estimate CAD $378 / 211km",
    carfaxAvailable: true,
    carfaxUrlStatus: "url_found",
  });

  assert.equal(legacy.currentBid, 13_200);
  assert.equal(legacy.listedPrice, 13_200);
  assert.equal((legacy.priceSemantics as { listedPrice?: string }).listedPrice, "observation_alias_current_bid");
  assert.equal(legacy.carfaxAvailable, false);
  assert.equal(legacy.carfaxMentioned, true);
  assert.equal(legacy.carfaxUrlStatus, "text_only");
  assert.match(String(legacy.conditionReportText), /Transmission hesitation/);
  assert.doesNotMatch(String(legacy.conditionReportText), /Full bid history|Current bid|Transport estimate|CAD \$378/i);
  assert.equal((legacy.openlaneCanonicalState as { mlFeatures?: { activeCurrentBid?: number } }).mlFeatures?.activeCurrentBid, 13_200);
});

test("OpenLane canonical state quarantines purchase outcome evidence on active listings", () => {
  const canonical = contract.createCanonicalOpenLaneState({
    pageContext: {
      pageType: "active_listing",
      captureKind: "observation",
      evidence: [{ evidenceType: "classifier", sourceText: "Active listing VDP" }],
    },
    activeAuction: {
      currentBid: 5600,
      evidence: [{ field: "currentBid", sourceType: "bid_panel", sourceText: "Current bid $5,600" }],
    },
    purchaseOutcome: {
      evidence: [{ evidenceType: "visible_page_text", sourceText: "Always view the CARFAX report" }],
      soldPriceCandidate: 5600,
    },
  });

  assert.equal((canonical as { purchaseOutcome?: { soldPriceCandidate?: number } }).purchaseOutcome?.soldPriceCandidate, undefined);
  assert.deepEqual((canonical as { purchaseOutcome?: { evidence?: unknown[] } }).purchaseOutcome?.evidence ?? [], []);
  assert.match(JSON.stringify((canonical as { pageContext?: { evidence?: unknown[] } }).pageContext?.evidence ?? []), /Active listing VDP/);
  assert.match(JSON.stringify((canonical as { activeAuction?: { evidence?: unknown[] } }).activeAuction?.evidence ?? []), /Current bid \$5,600/);
});

test("OpenLane canonical state can be normalized from an existing extraction contract payload", () => {
  const listing = contract.applyOpenLaneExtractionContract({
    sourceName: "OpenLane",
    listingUrl: "https://app.openlane.ca/vdp/3KPFK4A77HE123456",
    pageType: "active_listing",
    captureKind: "observation",
    vin: "3KPFK4A77HE123456",
    year: 2017,
    make: "Kia",
    model: "Forte",
    mileageKm: 111486,
    currentBid: 14200,
    carfaxAvailable: true,
    carfaxUrlStatus: "text_only",
    missingData: ["carfaxUrl"],
    openlaneMetadata: {
      stableCaptureReadiness: {
        readyToCapture: false,
        state: "incomplete_identity",
        blockedReason: "carfax_url_missing",
        missingData: ["carfaxUrl"],
      },
    },
  });

  const canonical = contract.normalizeOpenLaneCanonicalState(listing);

  assert.equal((canonical.identity as { vin?: string }).vin, "3KPFK4A77HE123456");
  assert.equal((canonical.activeAuction as { currentBid?: number }).currentBid, 14200);
  assert.equal((canonical.carfax as { urlStatus?: string }).urlStatus, "text_only");
  assert.deepEqual((canonical.readiness as { missingData?: string[] }).missingData, ["carfaxUrl"]);
  assert.equal((canonical.readiness as { ready?: boolean }).ready, false);
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

test("OpenLane extraction contract redacts sensitive standalone words and nested keys", () => {
  const listing = contract.applyOpenLaneExtractionContract({
    organizationId,
    sourceName: "OpenLane",
    listingUrl: "https://app.openlane.ca/vdp/123",
    pageType: "active_listing",
    captureKind: "observation",
    title: "2021 Toyota RAV4",
    rawVisibleText: "session_token password hunter2 SUPABASE_SERVICE_ROLE_KEY",
    extractedFields: {
      session_token: "abc123",
      nested: {
        authorization: "Bearer secret-token-value",
        sourceText: "password hunter2",
      },
    },
    openlaneMetadata: {
      debug: {
        service_role_key: "should not survive",
      },
    },
  });

  assert.doesNotMatch(JSON.stringify(listing), /SUPABASE_SERVICE_ROLE_KEY|service_role_key|session_token|authorization|hunter2|password|secret-token-value/i);
  assert.match(JSON.stringify(listing), /\[redacted/);
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
