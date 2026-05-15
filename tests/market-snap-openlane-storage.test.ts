import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { persistOpenLaneCapture } from "../src/lib/market-snap/repository";
import type { MarketListingInput } from "../src/types/market-snap";

const repoRoot = process.cwd();
const organizationId = "11111111-1111-4111-8111-111111111111";
const capturedBy = "22222222-2222-4222-8222-222222222222";

test("OpenLane capture storage writes active listing observations separately from outcomes", async () => {
  const client = new FakeCaptureClient();
  const result = await persistOpenLaneCapture(client as never, activeObservation(), capturedBy);

  assert.equal(result.observationStored, true);
  assert.equal(result.outcomeStored, false);
  assert.equal(client.tables.openlane_vehicle_identities.rows.length, 1);
  assert.equal(client.tables.openlane_observations.rows.length, 1);
  assert.equal(client.tables.openlane_outcomes.rows.length, 0);

  const observation = client.tables.openlane_observations.rows[0];
  assert.equal(observation.organization_id, organizationId);
  assert.equal(observation.current_bid, 18_500);
  assert.equal(observation.buy_now_price, 22_900);
  assert.equal(observation.capture_kind, "observation");
  assert.equal(observation.captured_by, capturedBy);
  assert.equal((observation.capped_payload as { rawVisibleText?: string }).rawVisibleText, undefined);
});

test("OpenLane capture storage writes candidate and verified outcomes without overwriting observations", async () => {
  const client = new FakeCaptureClient();

  await persistOpenLaneCapture(client as never, activeObservation(), capturedBy);
  const accepted = await persistOpenLaneCapture(client as never, acceptedOutcome(), capturedBy);
  const pending = await persistOpenLaneCapture(client as never, pendingOutcome(), capturedBy);

  assert.equal(accepted.outcomeStored, true);
  assert.equal(pending.outcomeStored, true);
  assert.equal(client.tables.openlane_observations.rows.length, 1);
  assert.equal(client.tables.openlane_outcomes.rows.length, 2);

  const verified = client.tables.openlane_outcomes.rows.find((row) => row.outcome_type === "accepted_negotiation");
  const candidate = client.tables.openlane_outcomes.rows.find((row) => row.outcome_type === "post_sale_candidate");
  assert.equal(verified?.is_training_eligible, true);
  assert.equal(verified?.accepted_amount, 17_900);
  assert.equal(verified?.final_bid_amount, 17_900);
  assert.equal(candidate?.is_training_eligible, false);
  assert.equal(candidate?.sold_price_candidate, 18_250);
  assert.equal(candidate?.final_bid_amount, null);
});

test("OpenLane capture storage migration is append-only, RLS-protected, and organization isolated", () => {
  const migration = readFileSync(join(repoRoot, "supabase/migrations/20260523_openlane_capture_storage.sql"), "utf8");

  for (const table of ["openlane_vehicle_identities", "openlane_observations", "openlane_outcomes"]) {
    assert.match(migration, new RegExp(`create table if not exists ${table}`));
    assert.match(migration, new RegExp(`alter table ${table}\\s+enable row level security`, "i"));
    assert.match(migration, new RegExp(`is_org_member\\(organization_id\\)`, "i"));
    assert.match(migration, new RegExp(`has_org_role\\(organization_id, array\\['owner','admin','member'\\]::app_role\\[\\]\\)`, "i"));
  }

  assert.doesNotMatch(migration, /\bdelete\s+from\s+(market_listings|deal_radar_saved_listings|openlane_)/i);
  assert.match(migration, /unique \(organization_id, fallback_key\)/i);
  assert.match(migration, /unique \(organization_id, observation_fingerprint\)/i);
  assert.match(migration, /unique \(organization_id, outcome_fingerprint\)/i);
});

function activeObservation(): MarketListingInput {
  return {
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    pageType: "active_listing",
    captureKind: "observation",
    outcomeConfidence: "low",
    listingUrl: "https://www.openlane.ca/vehicle/123",
    title: "2021 Toyota RAV4 XLE",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
    vin: "2T3R1RFV5MW123456",
    mileageKm: 52_300,
    currentBid: 18_500,
    buyNowPrice: 22_900,
    imageCount: 12,
    capturedAt: "2026-05-14T12:00:00.000Z",
    openlaneMetadata: { disclosureCount: 3 },
    rawVisibleText: "visible text must not be stored in the capture payload",
    priceSemantics: { currentBid: "observation", buyNowPrice: "observation" },
  };
}

function acceptedOutcome(): MarketListingInput {
  return {
    ...activeObservation(),
    pageType: "post_sale",
    captureKind: "verified_outcome",
    outcomeConfidence: "verified",
    soldPriceCandidate: 18_250,
    acceptedAmount: 17_900,
    negotiatedAmount: 17_900,
    finalBidAmount: 17_900,
    negotiationStatus: "Accepted",
    outcomeEvidence: [{ evidenceType: "accepted_negotiation", sourceText: "Seller accepted.", capturedAt: "2026-05-15T12:00:00.000Z" }],
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
      acceptedAmount: "verified_wholesale_label",
      negotiatedAmount: "verified_wholesale_label",
      finalBidAmount: "verified_wholesale_label",
    },
  };
}

function pendingOutcome(): MarketListingInput {
  return {
    ...activeObservation(),
    pageType: "post_sale",
    captureKind: "candidate_outcome",
    outcomeConfidence: "medium",
    soldPriceCandidate: 18_250,
    counterOfferAmount: 17_750,
    negotiationStatus: "Pending",
    currentBid: undefined,
    buyNowPrice: undefined,
    priceSemantics: {
      soldPriceCandidate: "candidate_wholesale_label",
      counterOfferAmount: "candidate_wholesale_label",
    },
  };
}

class FakeCaptureClient {
  tables: Record<string, { rows: Array<Record<string, unknown>> }> = {
    openlane_vehicle_identities: { rows: [] },
    openlane_observations: { rows: [] },
    openlane_outcomes: { rows: [] },
  };

  from(table: string) {
    return new FakeCaptureQuery(this.tables[table]);
  }
}

class FakeCaptureQuery {
  private row?: Record<string, unknown>;

  constructor(private table?: { rows: Array<Record<string, unknown>> }) {}

  upsert(row: Record<string, unknown>) {
    if (!this.table) throw new Error("Unknown fake table");
    const key = row.fallback_key ? "fallback_key" : row.observation_fingerprint ? "observation_fingerprint" : "outcome_fingerprint";
    const existing = this.table.rows.find((item) => item.organization_id === row.organization_id && item[key] === row[key]);
    if (existing) Object.assign(existing, row);
    else this.table.rows.push({ id: `fake-${this.table.rows.length + 1}`, ...row });
    this.row = existing ?? this.table.rows[this.table.rows.length - 1];
    return this;
  }

  insert(row: Record<string, unknown>) {
    if (!this.table) throw new Error("Unknown fake table");
    this.table.rows.push({ id: `fake-${this.table.rows.length + 1}`, ...row });
    this.row = this.table.rows[this.table.rows.length - 1];
    return this;
  }

  select() {
    return this;
  }

  single() {
    return { data: this.row, error: null };
  }
}
