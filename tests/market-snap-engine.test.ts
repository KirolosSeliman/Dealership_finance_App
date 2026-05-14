import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  calculateTimeDecayWeight,
  inferMarketType,
  normalizeListing,
  runComparableEstimator,
  shouldRefreshVehicle,
  shouldStoreValuationSnapshot,
  summarizeValuationCalibration,
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

test("Market Snap fallback estimates are low confidence and cannot be Strong Buy", () => {
  const valuation = runComparableEstimator({
    organizationId: "org-1",
    vehicle: { ...activeVehicle, purchasePrice: 9000, listedPrice: 18500 },
    comparables: [],
  });

  assert.equal(valuation.comparableCount, 0);
  assert.ok(valuation.confidenceScore <= 35);
  assert.notEqual(valuation.recommendationBadge, "Strong Buy");
  assert.ok(valuation.warnings.some((warning) => warning.includes("fallback pricing")));
  assert.equal(valuation.valuationExplanation?.fallback_used, true);
  assert.equal(valuation.valuationExplanation?.catboost_status, "candidate_only_not_used");
});

test("Market Snap low comparable estimates cap confidence and block Strong Buy", () => {
  const valuation = runComparableEstimator({
    organizationId: "org-1",
    vehicle: { ...activeVehicle, purchaseSource: "other", purchasePrice: 9000, listedPrice: 15000 },
    comparables: [
      { sourceName: "AutoTrader", marketType: "clean_retail_market", year: 2020, make: "Toyota", model: "Corolla", mileageKm: 80500, listedPrice: 19000, capturedAt: new Date().toISOString(), dataQualityScore: 100 },
      { sourceName: "AutoTrader", marketType: "clean_retail_market", year: 2020, make: "Toyota", model: "Corolla", mileageKm: 81000, listedPrice: 19500, capturedAt: new Date().toISOString(), dataQualityScore: 100 },
    ],
  });

  assert.equal(valuation.comparableCount, 2);
  assert.ok(valuation.confidenceScore <= 55);
  assert.notEqual(valuation.recommendationBadge, "Strong Buy");
  assert.ok(valuation.warnings.some((warning) => warning.includes("Only 2 close comparables")));
  assert.equal(valuation.valuationExplanation?.low_comparable_count, true);
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

test("Market Snap calibration summary compares predictions to actual sale outcomes", () => {
  const summary = summarizeValuationCalibration([
    { estimatedRetailMarketValue: 18000, actualSalePrice: 20000, confidenceScore: 82, make: "Toyota", model: "Corolla", sourceName: "AutoTrader" },
    { estimatedRetailMarketValue: 15000, actualSalePrice: 12000, confidenceScore: 45, make: "Toyota", model: "Corolla", sourceName: "OpenLane" },
    { estimatedRetailMarketValue: 9000, actualSalePrice: 10000, confidenceScore: 30, make: "Honda", model: "Civic", sourceName: "AutoTrader" },
  ]);

  assert.equal(summary.outcomeCount, 3);
  assert.equal(summary.averageAbsoluteError, 2000);
  assert.equal(summary.medianAbsoluteError, 2000);
  assert.ok(summary.errorByMakeModel.some((row) => row.makeModel === "Toyota Corolla" && row.outcomeCount === 2));
  assert.ok(summary.errorBySource.some((row) => row.sourceName === "AutoTrader" && row.outcomeCount === 2));
  assert.ok(summary.confidenceVsError.some((row) => row.confidenceBand === "80-100"));
});

test("Market Snap migration stores sold outcome errors and exposes calibration report", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260521_market_snap_calibration_guardrails.sql"), "utf8");

  assert.match(sql, /create or replace function apply_market_snap_sale_outcome\(\)/i);
  assert.match(sql, /new\.market_snap_prediction_error/i);
  assert.match(sql, /create trigger apply_market_snap_sale_outcome_before_insert/i);
  assert.match(sql, /create or replace function market_snap_calibration_report\(p_organization_id uuid\)/i);
  assert.match(sql, /average_percentage_error/i);
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
