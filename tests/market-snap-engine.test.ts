import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateTimeDecayWeight,
  inferMarketType,
  normalizeListing,
  runComparableEstimator,
  shouldRefreshVehicle,
  shouldStoreValuationSnapshot,
} from "../src/lib/market-snap/engine";
import type { Vehicle } from "../src/types/domain";

const activeVehicle: Vehicle = {
  id: "vehicle-1",
  organizationId: "org-1",
  status: "listed_for_sale",
  purchasePrice: 12000,
  purchaseSource: "OpenLane",
  purchaseDate: "2026-01-01",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  createdBy: "user-1",
  year: 2020,
  make: "Toyota",
  model: "Corolla",
  mileage: 80000,
};

test("Market Snap keeps clean retail listings separate from Copart/IAA salvage contexts", () => {
  assert.equal(inferMarketType("AutoTrader/AutoHebdo", "retail", "clean", "clean title"), "clean_retail_market");
  assert.equal(inferMarketType("Copart", "auction", "unknown", "front damage, parts only"), "salvage_auction_market");
  assert.equal(inferMarketType("IAA", "salvage", "salvage", "airbag deployed"), "salvage_auction_market");
});

test("Market Snap time decay gives recent records more estimator weight", () => {
  const recent = calculateTimeDecayWeight(new Date().toISOString());
  const older = calculateTimeDecayWeight("2025-01-01T00:00:00.000Z");

  assert.ok(recent > older);
  assert.ok(older >= 0.08);
});

test("Market Snap comparable estimator does not mix clean retail comparables into salvage valuation", () => {
  const valuation = runComparableEstimator({
    organizationId: "org-1",
    listing: {
      organizationId: "org-1",
      sourceName: "Copart",
      sourceType: "salvage",
      title: "2020 Toyota Corolla salvage parts only",
      year: 2020,
      make: "Toyota",
      model: "Corolla",
      auctionHammerPrice: 4000,
    },
    comparables: [
      { sourceName: "AutoTrader", marketType: "clean_retail_market", year: 2020, make: "Toyota", model: "Corolla", listedPrice: 18000 },
      { sourceName: "Copart", marketType: "salvage_auction_market", year: 2020, make: "Toyota", model: "Corolla", listedPrice: 4500 },
    ],
  });

  assert.equal(valuation.marketType, "salvage_auction_market");
  assert.equal(valuation.comparableCount, 1);
  assert.equal(valuation.recommendationBadge, "High Risk");
});

test("Market Snap refresh skips sold vehicles and avoids meaningless duplicate snapshots", () => {
  const soldVehicle: Vehicle = { ...activeVehicle, status: "sold" };
  const first = runComparableEstimator({ organizationId: "org-1", vehicle: activeVehicle, comparables: [] });
  const duplicate = { ...first, valuationDate: new Date().toISOString() };
  const changed = { ...first, estimatedRetailMarketValue: first.estimatedRetailMarketValue + 1000 };

  assert.equal(shouldRefreshVehicle(activeVehicle), true);
  assert.equal(shouldRefreshVehicle(soldVehicle), false);
  assert.equal(shouldStoreValuationSnapshot(first, duplicate), false);
  assert.equal(shouldStoreValuationSnapshot(first, changed), true);
});

test("Market Snap does not invent missing condition, diagnostic, or image findings", () => {
  const normalized = normalizeListing({
    organizationId: "org-1",
    sourceName: "Facebook Marketplace",
    sourceType: "retail",
    title: "2021 Honda Civic",
    year: 2021,
    make: "Honda",
    model: "Civic",
    listedPrice: 16000,
  });

  assert.equal(normalized.conditionFeatures?.rust?.rustDetected, undefined);
  assert.equal(normalized.imageFeatures.rustVisibleScore, undefined);
  assert.equal(normalized.diagnosticFeatures?.diagnosticCodesAvailable, undefined);
  assert.ok(normalized.missingData.includes("mileage"));
  assert.ok(normalized.missingData.includes("diagnostic_codes_unknown"));
});
