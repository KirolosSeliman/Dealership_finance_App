import type { Vehicle } from "@/types/domain";

export type MarketType =
  | "clean_retail_market"
  | "clean_wholesale_market"
  | "auction_market"
  | "salvage_auction_market"
  | "rebuilt_market"
  | "parts_or_non_running_market";

export type RecommendationBadge = "Strong Buy" | "Negotiate" | "Avoid" | "High Risk";
export type MarketTrend = "rising" | "stable" | "softening" | "unknown";
export type EstimatorType = "comparable_estimator" | "catboost" | "fallback_estimator";

export type MarketSourceType = "retail" | "wholesale" | "auction" | "salvage" | "import" | "extension";

export interface MarketSource {
  id: string;
  organizationId?: string;
  name: string;
  sourceType: MarketSourceType;
  status: "active" | "paused" | "error";
  sourceReliabilityScore: number;
  defaultMarketType: MarketType;
  lastSyncAt?: string;
  recordCount?: number;
}

export interface MarketListingInput {
  organizationId: string;
  sourceName: string;
  sourceType?: MarketSourceType;
  listingUrl?: string;
  title?: string;
  description?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  mileageKm?: number;
  listedPrice?: number;
  auctionHammerPrice?: number;
  location?: string;
  province?: string;
  sellerType?: string;
  titleStatus?: string;
  conditionReportText?: string;
  imageCount?: number;
  capturedAt?: string;
  marketType?: MarketType;
}

export interface NormalizedMarketListing extends MarketListingInput {
  normalizedTitle: string;
  marketType: MarketType;
  titleStatus: string;
  dataQualityScore: number;
  sourceReliabilityScore: number;
  timeDecayWeight: number;
  sampleWeight: number;
  warnings: string[];
  missingData: string[];
}

export interface ComparableListing {
  id?: string;
  sourceName: string;
  sourceType?: MarketSourceType;
  marketType: MarketType;
  title?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  mileageKm?: number;
  listedPrice?: number;
  location?: string;
  province?: string;
  titleStatus?: string;
  conditionScore?: number;
  capturedAt?: string;
  dataQualityScore?: number;
  sourceReliabilityScore?: number;
}

export interface ValuationInput {
  organizationId: string;
  vehicle?: Vehicle;
  listing?: MarketListingInput;
  comparables?: ComparableListing[];
  desiredProfitMargin?: number;
  estimatedReconditioningCost?: number;
  estimatedTransportCost?: number;
  estimatedInspectionCost?: number;
  estimatedHiddenFees?: number;
  auctionFee?: number;
  purchaseTaxRate?: number;
  feeTaxRate?: number;
}

export interface VehicleValuation {
  id?: string;
  organizationId: string;
  vehicleId?: string;
  dealRadarListingId?: string;
  marketType: MarketType;
  estimatedRetailMarketValue: number;
  estimatedWholesaleBuyValue: number;
  estimatedWholesaleSellValue: number;
  suggestedListingPrice: number;
  quickSalePrice: number;
  maxRecommendedPurchasePrice: number;
  maxRecommendedBid: number;
  estimatedTotalAcquisitionCost: number;
  currentCostBasis: number;
  potentialGrossProfit: number;
  potentialNetProfit: number;
  estimatedReconditioningCost: number;
  estimatedTaxAmount: number;
  estimatedHiddenFees: number;
  estimatedTransportCost: number;
  estimatedAuctionFees: number;
  estimatedInspectionCost: number;
  comparableCount: number;
  dataFreshnessDays: number;
  confidenceScore: number;
  dealScore: number;
  profitScore: number;
  riskScore: number;
  marketTrend: MarketTrend;
  recommendationBadge: RecommendationBadge;
  explanation: string;
  warnings: string[];
  missingData: string[];
  modelVersion: string;
  estimatorType: EstimatorType;
  valuationDate: string;
}

export interface DealRadarSavedListing {
  id: string;
  organizationId: string;
  sourceName: string;
  listingUrl?: string;
  title?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  mileageKm?: number;
  listedPrice?: number;
  marketType: MarketType;
  recommendationBadge: RecommendationBadge;
  dealScore: number;
  profitScore: number;
  riskScore: number;
  confidenceScore: number;
  potentialProfit: number;
  valuation?: VehicleValuation;
  createdAt: string;
}
