import { calculateVehicleTotalCost, roundMoney } from "@/lib/domain/calculations";
import { getPurchaseTaxRate, QUEBEC_EXPENSE_TAX_RATE } from "@/lib/domain/constants";
import type { Vehicle, VehicleExpense } from "@/types/domain";
import type {
  ComparableListing,
  ConditionFeatures,
  DiagnosticFeatures,
  ImageFeatures,
  MarketListingInput,
  MarketType,
  NormalizedMarketListing,
  RecommendationBadge,
  ValuationInput,
  VehicleValuation,
} from "@/types/market-snap";

const MODEL_VERSION = "market-snap-foundation-v1";
const MIN_STRONG_BUY_COMPARABLES = 3;
const MIN_STRONG_BUY_CONFIDENCE = 60;
const CLEAN_TITLE_STATUSES = new Set(["", "clean", "normal", "clear", "unknown"]);
const SALVAGE_TERMS = ["salvage", "non repairable", "non-repairable", "parts only", "parts-only", "flood", "fire"];
const REBUILT_TERMS = ["rebuilt", "reconstructed"];
const HIGH_RISK_CODES = new Set(["P0700"]);
const CRITICAL_CODE_PREFIXES = ["P0A", "B1"];

export function normalizeListing(input: MarketListingInput): NormalizedMarketListing {
  const text = [input.title, input.description, input.conditionReportText, input.titleStatus].join(" ").toLowerCase();
  const titleStatus = normalizeTitleStatus(input.titleStatus || text);
  const marketType = input.marketType ?? inferMarketType(input.sourceName, input.sourceType, titleStatus, text);
  const conditionFeatures = mergeConditionFeatures(extractConditionFeaturesFromText(text, titleStatus), input.conditionFeatures);
  const imageFeatures = normalizeImageFeatures(input.imageFeatures, input.imageCount);
  const diagnosticFeatures = normalizeDiagnosticFeatures(input.diagnosticFeatures);
  const missingData = requiredListingFields(input);
  const warnings: string[] = [];
  if (marketType === "salvage_auction_market") warnings.push("Salvage or non-repairable context is separated from clean retail data.");
  if (missingData.length > 0) warnings.push("Some important listing fields are missing, lowering confidence.");
  if (input.carfaxAvailable || input.carfaxUrl) warnings.push("Carfax link was visible; Market Snap does not fetch or interpret paid report content.");
  const conditionMissing = importantConditionGaps(conditionFeatures, imageFeatures, diagnosticFeatures);
  if (conditionMissing.length > 0) missingData.push(...conditionMissing);
  const riskWarnings = conditionWarnings(conditionFeatures, diagnosticFeatures);
  warnings.push(...riskWarnings);
  const carfaxBonus = input.carfaxAvailable || input.carfaxUrl ? 4 : 0;
  const mediaBonus = input.videoCount ? 2 : 0;
  const dataQualityScore = clamp(100 - missingData.length * 8 - (imageFeatures.imageCount ? 0 : 8) + carfaxBonus + mediaBonus, 20, 100);
  const sourceReliabilityScore = sourceQuality(input.sourceName, input.sourceType);
  const timeDecayWeight = calculateTimeDecayWeight(input.capturedAt);
  const marketTypeWeight = marketType === "clean_retail_market" || marketType === "clean_wholesale_market" ? 1 : 0.86;
  const sampleWeight = roundScore((sourceReliabilityScore / 100) * (dataQualityScore / 100) * timeDecayWeight * marketTypeWeight);

  return {
    ...input,
    normalizedTitle: [input.year, input.make, input.model, input.trim].filter(Boolean).join(" ").trim() || input.title || "Unknown vehicle",
    titleStatus,
    marketType,
    conditionFeatures,
    imageFeatures,
    diagnosticFeatures,
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

  const basePrice = normalized.buyNowPrice || normalized.currentBid || normalized.listedPrice || normalized.auctionHammerPrice || input.vehicle?.listedPrice || input.vehicle?.purchasePrice || 0;
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

  const auctionFees = roundMoney(input.auctionFee ?? normalized.estimatedAuctionFees ?? estimateAuctionFees(basePrice, normalized.marketType));
  const estimatedReconditioningCost = roundMoney(input.estimatedReconditioningCost ?? estimateReconditioningCost(normalized));
  const estimatedTransportCost = roundMoney(input.estimatedTransportCost ?? 350);
  const estimatedInspectionCost = roundMoney(input.estimatedInspectionCost ?? 150);
  const estimatedHiddenFees = roundMoney(input.estimatedHiddenFees ?? 250);
  const purchaseTaxRate = input.purchaseTaxRate ?? getPurchaseTaxRate(normalized.sourceName);
  const feeTaxRate = input.feeTaxRate ?? QUEBEC_EXPENSE_TAX_RATE;
  const listedOrHammer = normalized.buyNowPrice || normalized.currentBid || normalized.auctionHammerPrice || normalized.listedPrice || input.vehicle?.purchasePrice || 0;
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
  const fallbackUsed = scored.length === 0;
  const lowComparableCount = scored.length > 0 && scored.length < MIN_STRONG_BUY_COMPARABLES;
  const riskScore = scoreRisk(normalized);
  const profitScore = clamp(Math.round((potentialNetProfit / Math.max(estimatedRetailMarketValue, 1)) * 180), 0, 100);
  const confidencePenalty = conditionConfidencePenalty(normalized.conditionFeatures, normalized.imageFeatures, normalized.diagnosticFeatures);
  const rawConfidenceScore = clamp(Math.round((scored.length >= 6 ? 80 : 48 + scored.length * 6) * (normalized.dataQualityScore / 100) - confidencePenalty), 10, 95);
  const confidenceScore = fallbackUsed ? Math.min(rawConfidenceScore, 35) : lowComparableCount ? Math.min(rawConfidenceScore, 55) : rawConfidenceScore;
  const dealScore = clamp(Math.round(profitScore * 0.45 + confidenceScore * 0.3 + (100 - riskScore) * 0.25), 0, 100);
  const recommendationBadge = recommend({ dealScore, profitScore, riskScore, confidenceScore, comparableCount: scored.length });
  const guardrailWarnings = marketSnapGuardrailWarnings(scored.length, fallbackUsed, lowComparableCount);

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
    conditionFeatures: normalized.conditionFeatures,
    imageFeatures: normalized.imageFeatures,
    diagnosticFeatures: normalized.diagnosticFeatures,
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
      : "Comparable estimator used fallback pricing because no close comparables were available. Treat this as a low-confidence estimate, not an appraisal or offer.",
    warnings: [...normalized.warnings, ...guardrailWarnings],
    missingData: normalized.missingData,
    valuationExplanation: {
      comparable_count: scored.length,
      market_type: normalized.marketType,
      sample_weight: normalized.sampleWeight,
      confidence_penalty: confidencePenalty,
      raw_confidence_score: rawConfidenceScore,
      fallback_used: fallbackUsed,
      low_comparable_count: lowComparableCount,
      condition_risk: conditionRiskImpact(normalized.conditionFeatures, normalized.diagnosticFeatures),
      carfax_visible: Boolean(normalized.carfaxAvailable || normalized.carfaxUrl),
      photo_count: normalized.imageCount ?? normalized.photos?.length ?? normalized.imageFeatures?.imageCount ?? 0,
      video_count: normalized.videoCount ?? normalized.videos?.length ?? 0,
      catboost_status: "candidate_only_not_used",
      guardrail_version: "market-snap-production-guardrails-v1",
    },
    modelVersion: MODEL_VERSION,
    estimatorType: "comparable_estimator",
    valuationDate: new Date().toISOString(),
  };
}

export function shouldRefreshVehicle(vehicle: Vehicle) {
  return !vehicle.archivedAt && ["purchased", "in_repair", "listed_for_sale"].includes(vehicle.status);
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
  if (!input.listedPrice && !input.auctionHammerPrice && !input.currentBid && !input.buyNowPrice) missing.push("price");
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
  cost += conditionRepairCost(listing.conditionFeatures, listing.diagnosticFeatures);
  return cost;
}

export interface MarketSnapCalibrationOutcome {
  estimatedRetailMarketValue: number;
  actualSalePrice: number;
  confidenceScore?: number;
  comparableCount?: number;
  make?: string;
  model?: string;
  sourceName?: string;
}

export interface MarketSnapCalibrationSummary {
  outcomeCount: number;
  averageAbsoluteError: number;
  medianAbsoluteError: number;
  averagePercentageError: number;
  errorByMakeModel: Array<{ makeModel: string; outcomeCount: number; averageAbsoluteError: number }>;
  errorBySource: Array<{ sourceName: string; outcomeCount: number; averageAbsoluteError: number }>;
  confidenceVsError: Array<{ confidenceBand: string; outcomeCount: number; averageAbsoluteError: number }>;
}

export function summarizeValuationCalibration(outcomes: MarketSnapCalibrationOutcome[]): MarketSnapCalibrationSummary {
  const valid = outcomes
    .map((outcome) => ({
      ...outcome,
      absoluteError: Math.abs(outcome.actualSalePrice - outcome.estimatedRetailMarketValue),
      percentageError: outcome.actualSalePrice > 0 ? Math.abs(outcome.actualSalePrice - outcome.estimatedRetailMarketValue) / outcome.actualSalePrice : 0,
    }))
    .filter((outcome) => Number.isFinite(outcome.absoluteError) && outcome.actualSalePrice > 0 && outcome.estimatedRetailMarketValue > 0);

  return {
    outcomeCount: valid.length,
    averageAbsoluteError: roundMoney(average(valid.map((outcome) => outcome.absoluteError))),
    medianAbsoluteError: roundMoney(median(valid.map((outcome) => outcome.absoluteError))),
    averagePercentageError: roundScore(average(valid.map((outcome) => outcome.percentageError))),
    errorByMakeModel: summarizeGroup(valid, (outcome) => [outcome.make, outcome.model].filter(Boolean).join(" ") || "Unknown").map(([makeModel, group]) => ({
      makeModel,
      outcomeCount: group.length,
      averageAbsoluteError: roundMoney(average(group.map((outcome) => outcome.absoluteError))),
    })),
    errorBySource: summarizeGroup(valid, (outcome) => outcome.sourceName || "Unknown").map(([sourceName, group]) => ({
      sourceName,
      outcomeCount: group.length,
      averageAbsoluteError: roundMoney(average(group.map((outcome) => outcome.absoluteError))),
    })),
    confidenceVsError: summarizeGroup(valid, (outcome) => confidenceBand(outcome.confidenceScore ?? 0)).map(([confidenceBand, group]) => ({
      confidenceBand,
      outcomeCount: group.length,
      averageAbsoluteError: roundMoney(average(group.map((outcome) => outcome.absoluteError))),
    })),
  };
}

function scoreRisk(listing: NormalizedMarketListing) {
  let risk = 100 - listing.dataQualityScore;
  if (listing.marketType === "salvage_auction_market") risk += 38;
  if (listing.marketType === "rebuilt_market") risk += 24;
  if (listing.marketType === "parts_or_non_running_market") risk += 45;
  if (!CLEAN_TITLE_STATUSES.has(listing.titleStatus)) risk += 14;
  risk += conditionRiskImpact(listing.conditionFeatures, listing.diagnosticFeatures);
  return clamp(Math.round(risk), 0, 100);
}

function recommend(input: { dealScore: number; profitScore: number; riskScore: number; confidenceScore: number; comparableCount: number }): RecommendationBadge {
  if (input.riskScore >= 75) return "High Risk";
  if (input.comparableCount < MIN_STRONG_BUY_COMPARABLES) return input.dealScore >= 45 && input.riskScore < 70 ? "Negotiate" : "Avoid";
  if (input.dealScore >= 72 && input.profitScore >= 55 && input.confidenceScore >= MIN_STRONG_BUY_CONFIDENCE) return "Strong Buy";
  if (input.dealScore >= 45 && input.riskScore < 70) return "Negotiate";
  return "Avoid";
}

function marketSnapGuardrailWarnings(comparableCount: number, fallbackUsed: boolean, lowComparableCount: boolean) {
  const warnings = ["Market Snap values are estimates, not appraisals, offers, or guaranteed sale prices."];
  if (fallbackUsed) warnings.push("No close comparables were available; fallback pricing was used and confidence is capped.");
  if (lowComparableCount) warnings.push(`Only ${comparableCount} close comparable${comparableCount === 1 ? "" : "s"} supported this estimate; confidence is capped and Strong Buy is blocked.`);
  warnings.push("CatBoost is candidate-only and was not used for this production estimate.");
  return warnings;
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

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0;
}

function summarizeGroup<T>(values: T[], keyFor: (value: T) => string) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

function confidenceBand(score: number) {
  if (score >= 80) return "80-100";
  if (score >= 60) return "60-79";
  if (score >= 40) return "40-59";
  return "0-39";
}

function formatMarketType(value: MarketType) {
  return value.replaceAll("_", " ");
}

export function extractConditionFeaturesFromText(text: string, titleStatus = ""): ConditionFeatures {
  const source = `${text} ${titleStatus}`.toLowerCase();
  const rustDetected = source.includes("rust") || source.includes("corrosion");
  const engineIssue = source.includes("engine") || source.includes("motor issue");
  const transmissionIssue = source.includes("transmission");
  const airbagIssue = source.includes("airbag") || source.includes("srs");
  return {
    rust: rustDetected ? {
      rustDetected: true,
      rustSeverity: source.includes("structural") || source.includes("frame rust") ? "structural" : source.includes("severe rust") ? "severe" : "unknown",
      rustLocations: rustLocationsFromText(source),
      rustConfidenceScore: 45,
    } : undefined,
    cosmetic: source.includes("dent") || source.includes("scratch") || source.includes("hail") || source.includes("cracked bumper") ? {
      cosmeticDamageDetected: true,
      cosmeticDamageSeverity: source.includes("severe") ? "severe" : "unknown",
      damageTypes: ["scratch", "dent", "hail", "cracked bumper"].filter((term) => source.includes(term)),
    } : undefined,
    mechanical: engineIssue || transmissionIssue || airbagIssue ? {
      mechanicalIssueDetected: true,
      mechanicalIssueSeverity: transmissionIssue || engineIssue ? "severe" : "moderate",
      engineIssue,
      transmissionIssue,
      electricalIssue: airbagIssue,
    } : undefined,
    title: {
      cleanTitle: source.includes("clean title") || source.includes("clear title"),
      rebuiltTitle: REBUILT_TERMS.some((term) => source.includes(term)),
      salvageTitle: source.includes("salvage"),
      partsOnly: source.includes("parts only") || source.includes("parts-only"),
      nonRepairable: source.includes("non repairable") || source.includes("non-repairable"),
      theftRecovery: source.includes("theft recovery"),
      floodDamage: source.includes("flood"),
      fireDamage: source.includes("fire damage"),
      hailDamage: source.includes("hail"),
    },
  };
}

function mergeConditionFeatures(extracted: ConditionFeatures, provided?: ConditionFeatures): ConditionFeatures {
  return {
    rust: { ...extracted.rust, ...provided?.rust },
    cosmetic: { ...extracted.cosmetic, ...provided?.cosmetic },
    mechanical: { ...extracted.mechanical, ...provided?.mechanical },
    title: { ...extracted.title, ...provided?.title },
  };
}

function normalizeImageFeatures(features?: ImageFeatures, imageCount?: number): ImageFeatures {
  const count = features?.imageCount ?? imageCount;
  return {
    photoAnalysisStatus: count ? "not_started" : "unknown",
    ...features,
    imageCount: count,
  };
}

function normalizeDiagnosticFeatures(features?: DiagnosticFeatures): DiagnosticFeatures {
  const codes = features?.obdCodes ?? [];
  const highestCodeSeverity = features?.highestCodeSeverity ?? highestSeverity(codes.map((code) => code.severity).filter(Boolean) as Array<"low" | "medium" | "high" | "critical">);
  return {
    ...features,
    diagnosticCodesAvailable: features?.diagnosticCodesAvailable ?? (codes.length > 0 ? true : undefined),
    codeCount: features?.codeCount ?? codes.length,
    highestCodeSeverity,
  };
}

function importantConditionGaps(condition: ConditionFeatures, images: ImageFeatures, diagnostics: DiagnosticFeatures) {
  const missing: string[] = [];
  if (!condition.rust?.rustDetected && condition.rust?.rustSeverity === undefined) missing.push("rust_condition_unknown");
  if (!condition.mechanical?.mechanicalIssueDetected && condition.mechanical?.mechanicalIssueSeverity === undefined) missing.push("mechanical_condition_unknown");
  if (!diagnostics.diagnosticCodesAvailable && !diagnostics.codeCount) missing.push("diagnostic_codes_unknown");
  if (!images.imageCount) missing.push("photos_unknown");
  if (images.imageCount && !images.hasOdometerPhoto && images.odometerDetected === undefined) missing.push("odometer_photo_unknown");
  return missing;
}

function conditionWarnings(condition: ConditionFeatures, diagnostics: DiagnosticFeatures) {
  const warnings: string[] = [];
  if (condition.rust?.rustSeverity === "structural" || condition.rust?.rustSeverity === "severe") warnings.push("Severe rust evidence materially increases risk and reconditioning cost.");
  if (condition.title?.salvageTitle || condition.title?.nonRepairable || condition.title?.partsOnly) warnings.push("Title or auction status indicates high-risk non-clean market context.");
  if (condition.title?.floodDamage || condition.title?.fireDamage) warnings.push("Flood or fire indicators require high caution and should not be mixed with clean retail comparables.");
  if (diagnostics.highestCodeSeverity === "critical" || diagnostics.highestCodeSeverity === "high") warnings.push("High-severity diagnostic evidence materially increases risk.");
  return warnings;
}

function conditionRepairCost(condition?: ConditionFeatures, diagnostics?: DiagnosticFeatures) {
  let cost = 0;
  if (condition?.rust?.rustSeverity === "light") cost += 600;
  if (condition?.rust?.rustSeverity === "moderate") cost += 1600;
  if (condition?.rust?.rustSeverity === "severe") cost += 3200;
  if (condition?.rust?.rustSeverity === "structural") cost += 6000;
  if (condition?.cosmetic?.cosmeticDamageSeverity === "moderate") cost += 900;
  if (condition?.cosmetic?.cosmeticDamageSeverity === "severe") cost += 2200;
  if (condition?.mechanical?.engineIssue) cost += 2800;
  if (condition?.mechanical?.transmissionIssue) cost += 3200;
  if (condition?.mechanical?.hybridBatteryIssue) cost += 4500;
  if (condition?.mechanical?.brakeIssue) cost += 700;
  if (condition?.mechanical?.suspensionIssue) cost += 1100;
  cost += diagnostics?.estimatedRepairCostFromCodes ?? averageCodeRepairCost(diagnostics);
  return cost;
}

function conditionRiskImpact(condition?: ConditionFeatures, diagnostics?: DiagnosticFeatures) {
  let risk = 0;
  if (condition?.rust?.rustSeverity === "moderate") risk += 10;
  if (condition?.rust?.rustSeverity === "severe") risk += 22;
  if (condition?.rust?.rustSeverity === "structural") risk += 34;
  if (condition?.cosmetic?.cosmeticDamageSeverity === "severe") risk += 8;
  if (condition?.mechanical?.engineIssue) risk += 18;
  if (condition?.mechanical?.transmissionIssue) risk += 22;
  if (condition?.mechanical?.hybridBatteryIssue) risk += 28;
  if (condition?.title?.salvageTitle) risk += 26;
  if (condition?.title?.rebuiltTitle) risk += 16;
  if (condition?.title?.partsOnly || condition?.title?.nonRepairable) risk += 36;
  if (condition?.title?.floodDamage || condition?.title?.fireDamage) risk += 24;
  if (diagnostics?.highestCodeSeverity === "medium") risk += 8;
  if (diagnostics?.highestCodeSeverity === "high") risk += 18;
  if (diagnostics?.highestCodeSeverity === "critical") risk += 32;
  for (const code of diagnostics?.obdCodes ?? []) {
    risk += code.riskImpact ?? (HIGH_RISK_CODES.has(code.code.toUpperCase()) ? 18 : CRITICAL_CODE_PREFIXES.some((prefix) => code.code.toUpperCase().startsWith(prefix)) ? 26 : 0);
  }
  return risk;
}

function conditionConfidencePenalty(condition?: ConditionFeatures, images?: ImageFeatures, diagnostics?: DiagnosticFeatures) {
  let penalty = 0;
  if (!condition?.rust?.rustSeverity) penalty += 4;
  if (!condition?.mechanical?.mechanicalIssueSeverity && !diagnostics?.diagnosticCodesAvailable) penalty += 6;
  if (!images?.imageCount) penalty += 6;
  if (images?.mileageMismatchWarning) penalty += 14;
  if (condition?.title?.salvageTitle || condition?.title?.nonRepairable || condition?.title?.partsOnly) penalty += 5;
  return penalty;
}

function rustLocationsFromText(text: string) {
  return ["rocker panels", "wheel arches", "underbody", "doors", "hood", "trunk", "frame", "suspension mounts", "floor", "roof"].filter((location) => text.includes(location));
}

function averageCodeRepairCost(diagnostics?: DiagnosticFeatures) {
  return (diagnostics?.obdCodes ?? []).reduce((sum, code) => {
    if (code.estimatedRepairCostHigh || code.estimatedRepairCostLow) {
      return sum + ((code.estimatedRepairCostLow ?? code.estimatedRepairCostHigh ?? 0) + (code.estimatedRepairCostHigh ?? code.estimatedRepairCostLow ?? 0)) / 2;
    }
    return sum;
  }, 0);
}

function highestSeverity(values: Array<"low" | "medium" | "high" | "critical">) {
  if (values.includes("critical")) return "critical";
  if (values.includes("high")) return "high";
  if (values.includes("medium")) return "medium";
  if (values.includes("low")) return "low";
  return undefined;
}
