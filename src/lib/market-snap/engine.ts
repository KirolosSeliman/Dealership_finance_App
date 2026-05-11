import { calculateVehicleTotalCost, roundMoney } from "@/lib/domain/calculations";
import type { Vehicle, VehicleExpense } from "@/types/domain";
import type {
  ComparableListing,
  MarketListingInput,
  MarketType,
  NormalizedMarketListing,
  RecommendationBadge,
  ValuationInput,
  VehicleValuation,
} from "@/types/market-snap";

const MODEL_VERSION = "market-snap-foundation-v1";
const CLEAN_TITLE_STATUSES = new Set(["", "clean", "normal", "clear", "unknown"]);
const SALVAGE_TERMS = ["salvage", "non repairable", "non-repairable", "parts only", "parts-only", "flood", "fire"];
const REBUILT_TERMS = ["rebuilt", "reconstructed"];

export function normalizeListing(input: MarketListingInput): NormalizedMarketListing {
  const text = [input.title, input.description, input.conditionReportText, input.titleStatus].join(" ").toLowerCase();
  const titleStatus = normalizeTitleStatus(input.titleStatus || text);
  const marketType = input.marketType ?? inferMarketType(input.sourceName, input.sourceType, titleStatus, text);
  const missingData = requiredListingFields(input);
  const warnings: string[] = [];
  if (marketType === "salvage_auction_market") warnings.push("Salvage or non-repairable context is separated from clean retail data.");
  if (missingData.length > 0) warnings.push("Some important listing fields are missing, lowering confidence.");
  const dataQualityScore = clamp(100 - missingData.length * 12 - (input.imageCount ? 0 : 8), 20, 100);
  const sourceReliabilityScore = sourceQuality(input.sourceName, input.sourceType);
  const timeDecayWeight = calculateTimeDecayWeight(input.capturedAt);
  const marketTypeWeight = marketType === "clean_retail_market" || marketType === "clean_wholesale_market" ? 1 : 0.86;
  const sampleWeight = roundScore((sourceReliabilityScore / 100) * (dataQualityScore / 100) * timeDecayWeight * marketTypeWeight);

  return {
    ...input,
    normalizedTitle: [input.year, input.make, input.model, input.trim].filter(Boolean).join(" ").trim() || input.title || "Unknown vehicle",
    titleStatus,
    marketType,
    dataQualityScore,
    sourceReliabilityScore,
    timeDecayWeight,
    sampleWeight,
    warnings,
    missingData,
  };
}

export function inferMarketType(sourceName = "", sourceType = "", titleStatus = "", text = ""): MarketType {
  const source = `${sourceName} ${sourceType}`.toLowerCase();
  const combined = `${source} ${titleStatus} ${text}`.toLowerCase();
  if (SALVAGE_TERMS.some((term) => combined.includes(term))) return "salvage_auction_market";
  if (REBUILT_TERMS.some((term) => combined.includes(term))) return "rebuilt_market";
  if (combined.includes("non running") || combined.includes("does not run") || combined.includes("parts")) return "parts_or_non_running_market";
  if (source.includes("copart") || source.includes("iaa")) return "salvage_auction_market";
  if (source.includes("openlane") || source.includes("auction") || sourceType === "auction") return "auction_market";
  if (source.includes("wholesale") || sourceType === "wholesale") return "clean_wholesale_market";
  return "clean_retail_market";
}

export function calculateTimeDecayWeight(capturedAt?: string, rareVehicle = false) {
  if (!capturedAt) return 0.72;
  const ageDays = Math.max(0, (Date.now() - new Date(capturedAt).getTime()) / 86_400_000);
  const halfLife = rareVehicle ? 180 : 90;
  return roundScore(Math.max(0.08, Math.exp(-ageDays / halfLife)));
}

export function runComparableEstimator(input: ValuationInput & { expenses?: VehicleExpense[] }): VehicleValuation {
  const vehicleListing = input.listing ?? listingFromVehicle(input.vehicle);
  const normalized = normalizeListing({ ...vehicleListing, organizationId: input.organizationId });
  const comparablePool = (input.comparables ?? []).filter((comparable) => comparable.marketType === normalized.marketType);
  const scored = comparablePool
    .map((comparable) => ({
      comparable,
      similarity: scoreSimilarity(normalized, comparable),
      adjustedPrice: adjustComparablePrice(normalized, comparable),
      weight: calculateTimeDecayWeight(comparable.capturedAt) * ((comparable.dataQualityScore ?? 75) / 100),
    }))
    .filter((item) => Number.isFinite(item.adjustedPrice) && item.adjustedPrice > 0 && item.similarity >= 0.35)
    .sort((a, b) => b.similarity * b.weight - a.similarity * a.weight)
    .slice(0, 12);

  const basePrice = normalized.listedPrice || normalized.auctionHammerPrice || input.vehicle?.listedPrice || input.vehicle?.purchasePrice || 0;
  const retailValue = estimateValue(scored.map((item) => ({
    value: item.adjustedPrice,
    weight: item.similarity * item.weight,
  })), basePrice);
  const marketMultiplier = normalized.marketType === "clean_retail_market" ? 1 : normalized.marketType === "clean_wholesale_market" ? 1.08 : 1.18;
  const estimatedRetailMarketValue = roundMoney(retailValue * marketMultiplier);
  const estimatedWholesaleBuyValue = roundMoney(estimatedRetailMarketValue * wholesaleBuyRatio(normalized.marketType));
  const estimatedWholesaleSellValue = roundMoney(estimatedRetailMarketValue * wholesaleSellRatio(normalized.marketType));
  const suggestedListingPrice = roundMoney(estimatedRetailMarketValue * 1.03);
  const quickSalePrice = roundMoney(estimatedRetailMarketValue * 0.94);

  const auctionFees = roundMoney(input.auctionFee ?? estimateAuctionFees(basePrice, normalized.marketType));
  const estimatedReconditioningCost = roundMoney(input.estimatedReconditioningCost ?? estimateReconditioningCost(normalized));
  const estimatedTransportCost = roundMoney(input.estimatedTransportCost ?? 350);
  const estimatedInspectionCost = roundMoney(input.estimatedInspectionCost ?? 150);
  const estimatedHiddenFees = roundMoney(input.estimatedHiddenFees ?? 250);
  const purchaseTaxRate = input.purchaseTaxRate ?? 0.05;
  const feeTaxRate = input.feeTaxRate ?? 0.15;
  const listedOrHammer = normalized.auctionHammerPrice || normalized.listedPrice || input.vehicle?.purchasePrice || 0;
  const estimatedTaxAmount = roundMoney(listedOrHammer * purchaseTaxRate + auctionFees * feeTaxRate);
  const currentCostBasis = input.vehicle ? calculateVehicleTotalCost(input.vehicle, input.expenses ?? []) : listedOrHammer;
  const estimatedTotalAcquisitionCost = roundMoney(
    listedOrHammer + auctionFees + estimatedTransportCost + estimatedInspectionCost + estimatedHiddenFees + estimatedTaxAmount + estimatedReconditioningCost,
  );
  const desiredProfit = input.desiredProfitMargin ?? 1800;
  const maxRecommendedPurchasePrice = roundMoney(Math.max(0, estimatedWholesaleBuyValue - desiredProfit));
  const maxRecommendedBid = roundMoney(Math.max(0, maxRecommendedPurchasePrice - auctionFees - estimatedTaxAmount - estimatedTransportCost - estimatedInspectionCost - estimatedHiddenFees));
  const potentialGrossProfit = roundMoney(estimatedRetailMarketValue - currentCostBasis);
  const potentialNetProfit = roundMoney(estimatedRetailMarketValue - estimatedTotalAcquisitionCost);
  const riskScore = scoreRisk(normalized);
  const profitScore = clamp(Math.round((potentialNetProfit / Math.max(estimatedRetailMarketValue, 1)) * 180), 0, 100);
  const confidenceScore = clamp(Math.round((scored.length >= 6 ? 80 : 48 + scored.length * 6) * (normalized.dataQualityScore / 100)), 10, 95);
  const dealScore = clamp(Math.round(profitScore * 0.45 + confidenceScore * 0.3 + (100 - riskScore) * 0.25), 0, 100);
  const recommendationBadge = recommend({ dealScore, profitScore, riskScore, confidenceScore });

  return {
    organizationId: input.organizationId,
    vehicleId: input.vehicle?.id,
    marketType: normalized.marketType,
    estimatedRetailMarketValue,
    estimatedWholesaleBuyValue,
    estimatedWholesaleSellValue,
    suggestedListingPrice,
    quickSalePrice,
    maxRecommendedPurchasePrice,
    maxRecommendedBid,
    estimatedTotalAcquisitionCost,
    currentCostBasis: roundMoney(currentCostBasis),
    potentialGrossProfit,
    potentialNetProfit,
    estimatedReconditioningCost,
    estimatedTaxAmount,
    estimatedHiddenFees,
    estimatedTransportCost,
    estimatedAuctionFees: auctionFees,
    estimatedInspectionCost,
    comparableCount: scored.length,
    dataFreshnessDays: dataFreshnessDays(scored.map((item) => item.comparable.capturedAt).filter(Boolean) as string[]),
    confidenceScore,
    dealScore,
    profitScore,
    riskScore,
    marketTrend: "unknown",
    recommendationBadge,
    explanation: scored.length > 0
      ? `Comparable estimator used ${scored.length} ${formatMarketType(normalized.marketType)} comparables with time decay and condition risk adjustments.`
      : "Comparable estimator used fallback pricing because no close comparables were available.",
    warnings: normalized.warnings,
    missingData: normalized.missingData,
    modelVersion: MODEL_VERSION,
    estimatorType: "comparable_estimator",
    valuationDate: new Date().toISOString(),
  };
}

export function shouldRefreshVehicle(vehicle: Vehicle) {
  return ["purchased", "in_repair", "listed_for_sale"].includes(vehicle.status);
}

export function shouldStoreValuationSnapshot(previous: VehicleValuation | undefined, next: VehicleValuation) {
  if (!previous) return true;
  if (previous.modelVersion !== next.modelVersion) return true;
  if (previous.recommendationBadge !== next.recommendationBadge) return true;
  const retailDelta = Math.abs(previous.estimatedRetailMarketValue - next.estimatedRetailMarketValue);
  return retailDelta >= Math.max(500, previous.estimatedRetailMarketValue * 0.03);
}

function listingFromVehicle(vehicle?: Vehicle): MarketListingInput {
  return {
    organizationId: vehicle?.organizationId ?? "",
    sourceName: vehicle?.purchaseSource ?? "Dealer Flow Inventory",
    sourceType: vehicle?.purchaseSource === "OpenLane" || vehicle?.purchaseSource === "dealerAuction" ? "auction" : "import",
    year: vehicle?.year,
    make: vehicle?.make,
    model: vehicle?.model,
    trim: vehicle?.trim,
    mileageKm: vehicle?.mileage,
    listedPrice: vehicle?.listedPrice ?? vehicle?.purchasePrice,
    capturedAt: new Date().toISOString(),
  };
}

function scoreSimilarity(target: NormalizedMarketListing, comparable: ComparableListing) {
  let score = 0;
  if (same(target.make, comparable.make)) score += 0.22;
  if (same(target.model, comparable.model)) score += 0.24;
  if (target.year && comparable.year) score += Math.max(0, 0.18 - Math.abs(target.year - comparable.year) * 0.045);
  if (same(target.trim, comparable.trim)) score += 0.08;
  if (target.mileageKm && comparable.mileageKm) score += Math.max(0, 0.16 - Math.abs(target.mileageKm - comparable.mileageKm) / 500_000);
  if (same(target.province, comparable.province)) score += 0.04;
  if (same(target.titleStatus, comparable.titleStatus)) score += 0.08;
  return clamp(score, 0, 1);
}

function adjustComparablePrice(target: NormalizedMarketListing, comparable: ComparableListing) {
  let price = comparable.listedPrice ?? 0;
  if (target.mileageKm && comparable.mileageKm) price += (comparable.mileageKm - target.mileageKm) * 0.025;
  if (target.year && comparable.year) price += (target.year - comparable.year) * 650;
  if (target.marketType === "salvage_auction_market") price *= 0.82;
  return roundMoney(Math.max(0, price));
}

function estimateValue(values: Array<{ value: number; weight: number }>, fallback: number) {
  if (values.length === 0) return fallback;
  const sorted = values.map((item) => item.value).sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? sorted[0];
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? sorted[sorted.length - 1];
  const iqr = q3 - q1;
  const filtered = values.filter((item) => item.value >= q1 - iqr * 1.5 && item.value <= q3 + iqr * 1.5);
  const totalWeight = filtered.reduce((sum, item) => sum + item.weight, 0) || 1;
  return roundMoney(filtered.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight);
}

function normalizeTitleStatus(value: string) {
  const text = value.toLowerCase();
  if (SALVAGE_TERMS.some((term) => text.includes(term))) return "salvage";
  if (REBUILT_TERMS.some((term) => text.includes(term))) return "rebuilt";
  if (text.includes("clean") || text.includes("clear")) return "clean";
  return value.trim() || "unknown";
}

function requiredListingFields(input: MarketListingInput) {
  const missing: string[] = [];
  if (!input.year) missing.push("year");
  if (!input.make) missing.push("make");
  if (!input.model) missing.push("model");
  if (!input.mileageKm) missing.push("mileage");
  if (!input.listedPrice && !input.auctionHammerPrice) missing.push("price");
  return missing;
}

function sourceQuality(sourceName: string, sourceType?: string) {
  const source = sourceName.toLowerCase();
  if (source.includes("openlane")) return 88;
  if (source.includes("autotrader") || source.includes("autohebdo")) return 84;
  if (source.includes("copart") || source.includes("iaa")) return 72;
  if (sourceType === "extension") return 70;
  return 64;
}

function wholesaleBuyRatio(marketType: MarketType) {
  if (marketType === "salvage_auction_market" || marketType === "parts_or_non_running_market") return 0.48;
  if (marketType === "auction_market") return 0.68;
  return 0.72;
}

function wholesaleSellRatio(marketType: MarketType) {
  if (marketType === "salvage_auction_market" || marketType === "parts_or_non_running_market") return 0.58;
  if (marketType === "auction_market") return 0.78;
  return 0.82;
}

function estimateAuctionFees(price: number, marketType: MarketType) {
  if (!["auction_market", "salvage_auction_market"].includes(marketType)) return 0;
  return Math.min(1800, Math.max(350, price * 0.065));
}

function estimateReconditioningCost(listing: NormalizedMarketListing) {
  const text = [listing.description, listing.conditionReportText, listing.titleStatus].join(" ").toLowerCase();
  let cost = 650;
  if (text.includes("transmission") || text.includes("engine")) cost += 2500;
  if (text.includes("rust")) cost += 1200;
  if (text.includes("airbag") || text.includes("srs")) cost += 1400;
  if (listing.marketType === "salvage_auction_market") cost += 3000;
  return cost;
}

function scoreRisk(listing: NormalizedMarketListing) {
  let risk = 100 - listing.dataQualityScore;
  if (listing.marketType === "salvage_auction_market") risk += 38;
  if (listing.marketType === "rebuilt_market") risk += 24;
  if (listing.marketType === "parts_or_non_running_market") risk += 45;
  if (!CLEAN_TITLE_STATUSES.has(listing.titleStatus)) risk += 14;
  return clamp(Math.round(risk), 0, 100);
}

function recommend(input: { dealScore: number; profitScore: number; riskScore: number; confidenceScore: number }): RecommendationBadge {
  if (input.riskScore >= 75) return "High Risk";
  if (input.dealScore >= 72 && input.profitScore >= 55 && input.confidenceScore >= 45) return "Strong Buy";
  if (input.dealScore >= 45 && input.riskScore < 70) return "Negotiate";
  return "Avoid";
}

function dataFreshnessDays(values: string[]) {
  if (values.length === 0) return 999;
  const freshest = Math.max(...values.map((value) => new Date(value).getTime()));
  return Math.max(0, Math.round((Date.now() - freshest) / 86_400_000));
}

function same(a?: string, b?: string) {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundScore(value: number) {
  return Math.round(value * 1000) / 1000;
}

function formatMarketType(value: MarketType) {
  return value.replaceAll("_", " ");
}
