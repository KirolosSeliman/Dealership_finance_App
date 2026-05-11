import assert from "node:assert/strict";
import test from "node:test";
import { convertDealRadarListingToInventory } from "../src/lib/market-snap/repository";

test("Deal Radar convert-to-inventory prefills only confidently extracted vehicle fields", () => {
  const prefill = convertDealRadarListingToInventory({
    source_name: "Facebook Marketplace",
    listing_url: "https://example.test/listing",
    year: 2021,
    make: "Honda",
    model: "Civic",
    trim: "EX",
    mileage_km: 60000,
    listed_price: 16000,
    color: "Red",
    vin: "SHOULD_NOT_COPY",
    transmission: "Automatic",
    drivetrain: "FWD",
  });

  assert.deepEqual(Object.keys(prefill).sort(), ["make", "mileage", "model", "notes", "purchasePrice", "purchaseSource", "trim", "year"].sort());
  assert.equal(prefill.make, "Honda");
  assert.equal(prefill.model, "Civic");
  assert.equal(prefill.purchaseSource, "FacebookMarketplace");
  assert.equal("vin" in prefill, false);
  assert.equal("color" in prefill, false);
  assert.equal("transmission" in prefill, false);
  assert.equal("drivetrain" in prefill, false);
});
