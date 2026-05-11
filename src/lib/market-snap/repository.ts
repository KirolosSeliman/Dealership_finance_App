import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeListing, runComparableEstimator } from "@/lib/market-snap/engine";
import type { MarketListingInput, VehicleValuation } from "@/types/market-snap";
import type { Vehicle } from "@/types/domain";

type Client = SupabaseClient;

export async function fetchMarketComparables(client: Client, organizationId: string, vehicle: Partial<Vehicle> | MarketListingInput) {
  const make = "make" in vehicle ? vehicle.make : undefined;
  const model = "model" in vehicle ? vehicle.model : undefined;
  let query = client
    .from("market_listings")
    .select("id, source_name, source_type, market_type, title, year, make, model, trim, mileage_km, listed_price, location, province, title_status, condition_features, image_features, diagnostic_features, captured_at, data_quality_score, source_reliability_score")
    .or(`organization_id.eq.${organizationId},organization_id.is.null`)
    .not("listed_price", "is", null)
    .order("captured_at", { ascending: false })
    .limit(80);
  if (make) query = query.ilike("make", make);
  if (model) query = query.ilike("model", model);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String(row.id),
    sourceName: String(row.source_name ?? "Market"),
    sourceType: String(row.source_type ?? "retail") as never,
    marketType: String(row.market_type ?? "clean_retail_market") as never,
    title: String(row.title ?? ""),
    year: numberOrUndefined(row.year),
    make: stringOrUndefined(row.make),
    model: stringOrUndefined(row.model),
    trim: stringOrUndefined(row.trim),
    mileageKm: numberOrUndefined(row.mileage_km),
    listedPrice: numberOrUndefined(row.listed_price),
    location: stringOrUndefined(row.location),
    province: stringOrUndefined(row.province),
    titleStatus: stringOrUndefined(row.title_status),
    conditionFeatures: objectOrUndefined(row.condition_features) as never,
    imageFeatures: objectOrUndefined(row.image_features) as never,
    diagnosticFeatures: objectOrUndefined(row.diagnostic_features) as never,
    capturedAt: stringOrUndefined(row.captured_at),
    dataQualityScore: numberOrUndefined(row.data_quality_score),
    sourceReliabilityScore: numberOrUndefined(row.source_reliability_score),
  }));
}

export async function saveMarketListing(client: Client, input: MarketListingInput, valuation?: VehicleValuation) {
  const { data, error } = await client
    .from("deal_radar_saved_listings")
    .insert({
      organization_id: input.organizationId,
      source_name: input.sourceName,
      listing_url: input.listingUrl || null,
      title: input.title || null,
      year: input.year ?? null,
      make: input.make || null,
      model: input.model || null,
      trim: input.trim || null,
      mileage_km: input.mileageKm ?? null,
      listed_price: input.listedPrice ?? input.auctionHammerPrice ?? null,
      market_type: valuation?.marketType ?? input.marketType ?? "clean_retail_market",
      normalized_payload: input,
      condition_features: input.conditionFeatures ?? {},
      image_features: input.imageFeatures ?? { imageCount: input.imageCount, photoAnalysisStatus: input.imageCount ? "not_started" : "unknown" },
      diagnostic_features: input.diagnosticFeatures ?? {},
      valuation_snapshot: valuation ?? null,
      recommendation_badge: valuation?.recommendationBadge ?? "Negotiate",
      deal_score: valuation?.dealScore ?? 0,
      profit_score: valuation?.profitScore ?? 0,
      risk_score: valuation?.riskScore ?? 0,
      confidence_score: valuation?.confidenceScore ?? 0,
      potential_profit: valuation?.potentialNetProfit ?? 0,
    })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

export async function saveVehicleValuation(client: Client, valuation: VehicleValuation) {
  const { data, error } = await client
    .from("vehicle_valuations")
    .insert({
      organization_id: valuation.organizationId,
      vehicle_id: valuation.vehicleId ?? null,
      deal_radar_listing_id: valuation.dealRadarListingId ?? null,
      market_type: valuation.marketType,
      estimated_retail_market_value: valuation.estimatedRetailMarketValue,
      estimated_wholesale_buy_value: valuation.estimatedWholesaleBuyValue,
      estimated_wholesale_sell_value: valuation.estimatedWholesaleSellValue,
      suggested_listing_price: valuation.suggestedListingPrice,
      quick_sale_price: valuation.quickSalePrice,
      max_recommended_purchase_price: valuation.maxRecommendedPurchasePrice,
      max_recommended_bid: valuation.maxRecommendedBid,
      estimated_total_acquisition_cost: valuation.estimatedTotalAcquisitionCost,
      current_cost_basis: valuation.currentCostBasis,
      potential_gross_profit: valuation.potentialGrossProfit,
      potential_net_profit: valuation.potentialNetProfit,
      estimated_reconditioning_cost: valuation.estimatedReconditioningCost,
      estimated_tax_amount: valuation.estimatedTaxAmount,
      estimated_hidden_fees: valuation.estimatedHiddenFees,
      estimated_transport_cost: valuation.estimatedTransportCost,
      estimated_auction_fees: valuation.estimatedAuctionFees,
      estimated_inspection_cost: valuation.estimatedInspectionCost,
      condition_features: valuation.conditionFeatures ?? {},
      image_features: valuation.imageFeatures ?? {},
      diagnostic_features: valuation.diagnosticFeatures ?? {},
      valuation_explanation: valuation.valuationExplanation ?? {},
      comparable_count: valuation.comparableCount,
      data_freshness_days: valuation.dataFreshnessDays,
      confidence_score: valuation.confidenceScore,
      deal_score: valuation.dealScore,
      profit_score: valuation.profitScore,
      risk_score: valuation.riskScore,
      market_trend: valuation.marketTrend,
      recommendation_badge: valuation.recommendationBadge,
      explanation: valuation.explanation,
      warnings: valuation.warnings,
      missing_data: valuation.missingData,
      model_version: valuation.modelVersion,
      model_version_id: valuation.modelVersionId ?? null,
      estimator_type: valuation.estimatorType,
      valuation_date: valuation.valuationDate,
    })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

export async function insertMarketListings(client: Client, rows: MarketListingInput[]) {
  if (rows.length === 0) return { inserted: 0 };
  const records = rows.map((row) => {
    const normalized = normalizeListing(row);
    const expiresAt = new Date(Date.now() + 180 * 86_400_000).toISOString();
    return {
      organization_id: normalized.organizationId,
      source_name: normalized.sourceName,
      source_type: normalized.sourceType ?? "import",
      listing_url: normalized.listingUrl || null,
      title: normalized.title || normalized.normalizedTitle,
      description: normalized.description || null,
      condition_report_text: normalized.conditionReportText || null,
      year: normalized.year ?? null,
      make: normalized.make || null,
      model: normalized.model || null,
      trim: normalized.trim || null,
      mileage_km: normalized.mileageKm ?? null,
      listed_price: normalized.listedPrice ?? normalized.auctionHammerPrice ?? null,
      auction_hammer_price: normalized.auctionHammerPrice ?? null,
      location: normalized.location || null,
      province: normalized.province || null,
      seller_type: normalized.sellerType || null,
      title_status: normalized.titleStatus,
      market_type: normalized.marketType,
      data_quality_score: normalized.dataQualityScore,
      source_reliability_score: normalized.sourceReliabilityScore,
      time_decay_weight: normalized.timeDecayWeight,
      sample_weight: normalized.sampleWeight,
      normalized_payload: normalized,
      sanitized_raw_payload: {
        title: normalized.title,
        description: normalized.description,
        price: normalized.listedPrice ?? normalized.auctionHammerPrice,
        mileageKm: normalized.mileageKm,
        location: normalized.location,
      },
      condition_features: normalized.conditionFeatures ?? {},
      image_features: normalized.imageFeatures ?? {},
      diagnostic_features: normalized.diagnosticFeatures ?? {},
      expires_at: expiresAt,
      retention_policy: "unsaved_market_listing",
      captured_at: normalized.capturedAt ?? new Date().toISOString(),
    };
  });
  const { error } = await client.from("market_listings").insert(records);
  if (error) throw error;
  return { inserted: records.length };
}

export async function runVehicleValuation(client: Client, organizationId: string, vehicle: Vehicle, expenses = []) {
  const comparables = await fetchMarketComparables(client, organizationId, vehicle);
  return runComparableEstimator({ organizationId, vehicle, comparables, expenses });
}

function stringOrUndefined(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function numberOrUndefined(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function objectOrUndefined(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  return value;
}
