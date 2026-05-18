import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { listingFingerprint, upsertSyncedMarketListings, type SyncedMarketListingInput } from "../src/lib/market-snap/source-sync-repository";
import { mapMlListings } from "../src/lib/market-snap/source-sync";

const repoRoot = process.cwd();

test("Market Snap source sync cron routes require CRON_SECRET and service env", () => {
  const openlane = readFileSync(join(repoRoot, "src/app/api/market-snap/cron/sync-openlane/route.ts"), "utf8");
  const marketplace = readFileSync(join(repoRoot, "src/app/api/market-snap/cron/sync-marketplace/route.ts"), "utf8");
  const shared = readFileSync(join(repoRoot, "src/lib/market-snap/source-sync.ts"), "utf8");

  assert.match(openlane, /runCronSourceSync\(request, "openlane"\)/);
  assert.match(marketplace, /runCronSourceSync\(request, "marketplace"\)/);
  assert.match(shared, /CRON_SECRET/);
  assert.match(shared, /MARKET_SNAP_ML_SERVICE_URL/);
  assert.match(shared, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(shared, /Unauthorized/);
});

test("Market Snap source sync maps ML listings into listing inputs", () => {
  const [listing] = mapMlListings([{
    sourceName: "OpenLane",
    sourceType: "auction",
    listingUrl: "https://openlane.test/vehicle/OL-1",
    sourceListingId: "OL-1",
    title: "2021 Toyota RAV4 XLE",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
    mileageKm: 62000,
    listedPrice: 22900,
    marketType: "auction_market",
    dataQualityScore: 88,
  }]);

  assert.equal(listing.sourceName, "OpenLane");
  assert.equal(listing.sourceListingId, "OL-1");
  assert.equal(listing.marketType, "auction_market");
  assert.equal(listing.listedPrice, 22900);
  assert.equal(listing.organizationId, "");
});

test("Market Snap source sync repository inserts, updates, and skips duplicates", async () => {
  const existing = {
    id: "existing-id",
    title: "2021 Toyota RAV4",
    mileage_km: 65000,
    listed_price: 21000,
    data_quality_score: 60,
  };
  const client = new FakeSupabaseClient([existing]);
  const rows: SyncedMarketListingInput[] = [
    baseListing({ sourceListingId: "OL-1", listedPrice: 22900 }),
    baseListing({ sourceListingId: "OL-1", listedPrice: 23000 }),
    baseListing({ sourceListingId: "OL-2", listingUrl: "https://openlane.test/vehicle/OL-2", listedPrice: 24000 }),
    baseListing({ sourceListingId: "BAD", make: undefined }),
  ];

  const metrics = await upsertSyncedMarketListings(client as never, rows);

  assert.deepEqual(metrics, {
    totalReceived: 4,
    inserted: 1,
    updated: 1,
    skippedDuplicates: 1,
    invalidRows: 1,
  });
  assert.equal(client.inserts.length, 1);
  assert.equal(client.updates.length, 1);
});

test("Market Snap listing fingerprint is stable for equivalent duplicates", () => {
  const first = baseListing({ listingUrl: "https://one.test" });
  const second = baseListing({ listingUrl: "https://two.test" });

  assert.equal(listingFingerprint(first), listingFingerprint(second));
});

function baseListing(overrides: Partial<SyncedMarketListingInput> = {}): SyncedMarketListingInput {
  return {
    organizationId: "",
    sourceName: "OpenLane",
    sourceType: "auction",
    listingUrl: "https://openlane.test/vehicle/OL-1",
    sourceListingId: "OL-1",
    title: "2021 Toyota RAV4 XLE",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
    trim: "XLE",
    mileageKm: 62000,
    listedPrice: 22900,
    province: "QC",
    marketType: "auction_market",
    capturedAt: "2026-05-12T12:00:00.000Z",
    ...overrides,
  };
}

class FakeSupabaseClient {
  inserts: Array<Record<string, unknown>> = [];
  updates: Array<Record<string, unknown>> = [];

  constructor(private existingRows: Array<Record<string, unknown>>) {}

  from() {
    return new FakeQuery(this);
  }
}

class FakeQuery {
  private mode: "select" | "insert" | "update" = "select";
  private filters: Record<string, unknown> = {};
  private payload?: Record<string, unknown>;

  constructor(private client: FakeSupabaseClient) {}

  select() {
    this.mode = "select";
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.mode = "insert";
    this.payload = payload;
    this.client.inserts.push(payload);
    return { error: null };
  }

  update(payload: Record<string, unknown>) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters[key] = value;
    if (this.mode === "update" && key === "id" && this.payload) {
      this.client.updates.push(this.payload);
      return { error: null };
    }
    return this;
  }

  contains() {
    return this;
  }

  async maybeSingle() {
    const row = this.client.existingRows.find(() => {
      if (this.filters.source_listing_id) return this.filters.source_listing_id === "OL-1";
      if (this.filters.listing_url) return this.filters.listing_url === "https://openlane.test/vehicle/OL-1";
      return false;
    });
    return { data: row ?? null, error: null };
  }
}
