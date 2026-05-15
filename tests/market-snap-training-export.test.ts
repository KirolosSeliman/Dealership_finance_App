import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildOpenLaneTrainingDataset } from "../src/lib/market-snap/training-export";

const organizationId = "11111111-1111-4111-8111-111111111111";

test("OpenLane training export excludes active bids and pending outcomes from labels", () => {
  const dataset = buildOpenLaneTrainingDataset({
    observations: [activeObservation()],
    outcomes: [pendingOutcome()],
    retailSales: [],
  });

  assert.equal(dataset.wholesaleRows.length, 0);
  assert.equal(dataset.acquisitionRows.length, 0);
  assert.equal(dataset.retailRows.length, 0);
  assert.equal(dataset.report.rejectedByReason.observation_only, 1);
  assert.equal(dataset.report.rejectedByReason.candidate_outcome, 1);
});

test("OpenLane training export separates verified wholesale and acquisition labels", () => {
  const dataset = buildOpenLaneTrainingDataset({
    observations: [activeObservation({ current_bid: 6_200, disclosure_count: 22, photo_count: 56 })],
    outcomes: [purchaseFeeOutcome()],
    retailSales: [],
  });

  assert.equal(dataset.wholesaleRows.length, 1);
  assert.equal(dataset.acquisitionRows.length, 1);
  assert.equal(dataset.wholesaleRows[0].labelType, "wholesale");
  assert.equal(dataset.wholesaleRows[0].labelValue, 6_900);
  assert.equal(dataset.wholesaleRows[0].features.currentBid, 6_200);
  assert.equal(dataset.wholesaleRows[0].features.disclosureCount, 22);
  assert.equal(dataset.acquisitionRows[0].labelType, "acquisition_cost");
  assert.equal(dataset.acquisitionRows[0].labelValue, 8_166);
  assert.equal(dataset.report.usableOutcomes, 1);
});

test("OpenLane training export uses accepted negotiations as wholesale labels only when verified", () => {
  const dataset = buildOpenLaneTrainingDataset({
    observations: [activeObservation()],
    outcomes: [acceptedNegotiationOutcome()],
    retailSales: [],
  });

  assert.equal(dataset.wholesaleRows.length, 1);
  assert.equal(dataset.wholesaleRows[0].labelValue, 17_900);
  assert.equal(dataset.wholesaleRows[0].labelSource, "accepted_negotiation");
  assert.equal(dataset.acquisitionRows.length, 0);
});

test("OpenLane training export retail labels come from Dealer Flow sales only", () => {
  const dataset = buildOpenLaneTrainingDataset({
    observations: [activeObservation()],
    outcomes: [purchaseFeeOutcome()],
    retailSales: [{
      organization_id: organizationId,
      vehicle_identity_id: "identity-1",
      sale_id: "sale-1",
      paper_sale_price: 12_500,
      sale_date: "2026-05-15",
    }],
  });

  assert.equal(dataset.retailRows.length, 1);
  assert.equal(dataset.retailRows[0].labelType, "retail");
  assert.equal(dataset.retailRows[0].labelValue, 12_500);
  assert.equal(dataset.retailRows[0].labelSource, "dealer_flow_sale");
  assert.ok(dataset.retailRows.every((row) => row.labelSource !== "openlane_purchase"));
});

test("OpenLane training dataset SQL export only uses verified outcomes and sales", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260524_market_snap_training_export_safety.sql"), "utf8");

  assert.match(migration, /openlane_verified_wholesale_training/i);
  assert.match(migration, /openlane_acquisition_cost_training/i);
  assert.match(migration, /dealer_flow_retail_training/i);
  assert.match(migration, /is_training_eligible\s*=\s*true/i);
  assert.match(migration, /capture_kind\s+in\s+\('verified_outcome','manual_confirmation'\)/i);
  assert.match(migration, /left join vehicle_valuations vv on vv\.id = s\.market_snap_valuation_id/i);
  assert.match(migration, /vv\.confidence_score as market_snap_confidence_score/i);
  assert.doesNotMatch(migration, /current_bid\s+as\s+label/i);
  assert.doesNotMatch(migration, /sold_price_candidate\s+as\s+label/i);
  assert.doesNotMatch(migration, /s\.market_snap_confidence_score/i);
});

function activeObservation(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: organizationId,
    vehicle_identity_id: "identity-1",
    current_bid: 18_500,
    buy_now_price: 22_900,
    disclosure_count: 3,
    photo_count: 12,
    page_type: "active_listing",
    capture_kind: "observation",
    captured_at: "2026-05-14T12:00:00.000Z",
    ...overrides,
  };
}

function purchaseFeeOutcome() {
  return {
    organization_id: organizationId,
    vehicle_identity_id: "identity-1",
    outcome_type: "purchase_fee_details",
    capture_kind: "verified_outcome",
    confidence_level: "verified",
    is_training_eligible: true,
    buy_price_auction: 6_900,
    total_invoice_amount: 8_166,
    final_acquisition_cost: 8_166,
    captured_at: "2026-05-15T12:00:00.000Z",
  };
}

function acceptedNegotiationOutcome() {
  return {
    organization_id: organizationId,
    vehicle_identity_id: "identity-1",
    outcome_type: "accepted_negotiation",
    capture_kind: "verified_outcome",
    confidence_level: "verified",
    is_training_eligible: true,
    accepted_amount: 17_900,
    negotiated_amount: 17_900,
    final_bid_amount: 17_900,
    captured_at: "2026-05-15T12:00:00.000Z",
  };
}

function pendingOutcome() {
  return {
    organization_id: organizationId,
    vehicle_identity_id: "identity-1",
    outcome_type: "post_sale_candidate",
    capture_kind: "candidate_outcome",
    confidence_level: "medium",
    is_training_eligible: false,
    sold_price_candidate: 18_250,
    captured_at: "2026-05-15T12:00:00.000Z",
  };
}
