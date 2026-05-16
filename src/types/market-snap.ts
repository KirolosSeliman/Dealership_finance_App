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
export type OpenLanePageType =
  | "active_listing"
  | "watchlist"
  | "pending"
  | "closing"
  | "post_sale"
  | "purchase_list"
  | "purchase_detail"
  | "fee_details"
  | "purchase_info"
  | "documents"
  | "unknown";
export type MarketCaptureKind = "observation" | "candidate_outcome" | "verified_outcome" | "manual_confirmation";
export type OutcomeConfidence = "low" | "medium" | "high" | "verified";
export type MarketSnapCaptureLevel = "basic_dom" | "deep_capture";
export type MarketSnapCaptureScope =
  | "dom_visible"
  | "safe_read_only_expansion"
  | "network_response_observation"
  | "fee_outcome_capture"
  | "post_sale_outcome_capture"
  | "media_url_capture"
  | "model_improvement";
export type PriceSemantic =
  | "observation"
  | "candidate_wholesale_label"
  | "verified_wholesale_label"
  | "retail_label"
  | "acquisition_cost_component"
  | "final_acquisition_cost";
export type ConditionSeverity = "none" | "light" | "moderate" | "severe" | "unknown";
export type RustSeverity = ConditionSeverity | "structural";
export type DiagnosticSeverity = "low" | "medium" | "high" | "critical";
export type PhotoAnalysisStatus = "not_started" | "pending" | "processed" | "failed" | "unknown";

export interface CaptureEvidence {
  evidenceType:
    | "visible_page_text"
    | "fee_details_page"
    | "invoice"
    | "purchase_document"
    | "accepted_negotiation"
    | "user_confirmation";
  sourceText?: string;
  sourceUrl?: string;
  capturedAt?: string;
  confidenceScore?: number;
}

export interface MarketSnapSourceEvidence {
  scope: MarketSnapCaptureScope;
  evidenceType?:
    | "dom_text"
    | "expanded_section"
    | "network_response_summary"
    | "fee_outcome"
    | "post_sale_outcome"
    | "media_url"
    | "manual_confirmation";
  sourceText?: string;
  sourceUrl?: string;
  endpointPattern?: string;
  capturedAt?: string;
  confidenceScore?: number;
}

export interface ExtractionFieldEvidence {
  field: string;
  value: unknown;
  normalizedValue?: unknown;
  sourceType:
    | "dom_label"
    | "dom_attribute"
    | "section_map"
    | "network_json"
    | "safe_expansion"
    | "fee_page"
    | "post_sale_page"
    | "manual_confirmation"
    | "fallback_regex";
  sourceName?: string;
  sourceText?: string;
  endpointPattern?: string;
  pageType?: string;
  captureKind?: string;
  confidenceScore: number;
  capturedAt: string;
  consentId?: string;
}

export interface RustFeatures {
  rustDetected?: boolean;
  rustSeverity?: RustSeverity;
  rustLocations?: string[];
  rustConfidenceScore?: number;
}

export interface CosmeticDamageFeatures {
  cosmeticDamageDetected?: boolean;
  cosmeticDamageSeverity?: ConditionSeverity;
  damageTypes?: string[];
}

export interface MechanicalFeatures {
  mechanicalIssueDetected?: boolean;
  mechanicalIssueSeverity?: ConditionSeverity;
  engineIssue?: boolean;
  transmissionIssue?: boolean;
  brakeIssue?: boolean;
  suspensionIssue?: boolean;
  steeringIssue?: boolean;
  electricalIssue?: boolean;
  coolingSystemIssue?: boolean;
  exhaustIssue?: boolean;
  batteryIssue?: boolean;
  hybridBatteryIssue?: boolean;
}

export interface DiagnosticCodeFeature {
  code: string;
  systemCategory?: string;
  description?: string;
  severity?: DiagnosticSeverity;
  possibleCauses?: string[];
  estimatedRepairCostLow?: number;
  estimatedRepairCostHigh?: number;
  valuationImpact?: number;
  riskImpact?: number;
}

export interface DiagnosticFeatures {
  diagnosticCodesAvailable?: boolean;
  obdCodes?: DiagnosticCodeFeature[];
  codeCount?: number;
  codeSeverityScore?: number;
  highestCodeSeverity?: DiagnosticSeverity;
  estimatedRepairCostFromCodes?: number;
}

export interface TitleStatusFeatures {
  cleanTitle?: boolean;
  rebuiltTitle?: boolean;
  salvageTitle?: boolean;
  partsOnly?: boolean;
  nonRepairable?: boolean;
  theftRecovery?: boolean;
  floodDamage?: boolean;
  fireDamage?: boolean;
  hailDamage?: boolean;
}

export interface ImageFeatures {
  imageCount?: number;
  photoQualityScore?: number;
  missingAngleScore?: number;
  hasFrontPhoto?: boolean;
  hasRearPhoto?: boolean;
  hasLeftSidePhoto?: boolean;
  hasRightSidePhoto?: boolean;
  hasInteriorPhoto?: boolean;
  hasDashboardPhoto?: boolean;
  hasOdometerPhoto?: boolean;
  hasEngineBayPhoto?: boolean;
  hasUnderbodyPhoto?: boolean;
  visualConditionScore?: number;
  rustVisibleScore?: number;
  damageVisibleScore?: number;
  odometerDetected?: boolean;
  odometerPhotoDetected?: boolean;
  odometerReadingExtracted?: number;
  mileageConsistencyScore?: number;
  mileageMismatchWarning?: boolean;
  imageProcessedAt?: string;
  photoAnalysisStatus?: PhotoAnalysisStatus;
  imageProcessingErrors?: string[];
}

export interface ConditionFeatures {
  rust?: RustFeatures;
  cosmetic?: CosmeticDamageFeatures;
  mechanical?: MechanicalFeatures;
  title?: TitleStatusFeatures;
}

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
  pageType?: OpenLanePageType;
  captureKind?: MarketCaptureKind;
  captureLevel?: MarketSnapCaptureLevel;
  captureScopes?: MarketSnapCaptureScope[];
  deepCaptureConsentId?: string;
  sourceEvidence?: MarketSnapSourceEvidence[];
  outcomeConfidence?: OutcomeConfidence;
  priceSemantics?: Partial<Record<
    | "listedPrice"
    | "currentBid"
    | "currentOffer"
    | "bestOffer"
    | "buyNowPrice"
    | "reservePrice"
    | "soldPriceCandidate"
    | "finalBidAmount"
    | "negotiatedAmount"
    | "counterOfferAmount"
    | "acceptedAmount"
    | "buyPriceAuction"
    | "transactionFee"
    | "vehicleHistoryFee"
    | "otherFees"
    | "subtotal"
    | "taxes"
    | "totalInvoiceAmount"
    | "finalAcquisitionCost",
    PriceSemantic
  >>;
  outcomeEvidence?: CaptureEvidence[];
  listingUrl?: string;
  title?: string;
  description?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
  mileageKm?: number;
  exteriorColor?: string;
  interiorColor?: string;
  drivetrain?: string;
  transmission?: string;
  engine?: string;
  fuelType?: string;
  bodyStyle?: string;
  doors?: number;
  cylinders?: number;
  listedPrice?: number;
  // Current bids are observations/features only. They must never be promoted to final ML labels.
  currentBid?: number;
  currentOffer?: number;
  bestOffer?: number;
  buyNowPrice?: number;
  reservePrice?: number;
  soldPriceCandidate?: number;
  finalBidAmount?: number;
  negotiatedAmount?: number;
  counterOfferAmount?: number;
  acceptedAmount?: number;
  negotiationStatus?: string;
  negotiatedAt?: string;
  acceptedAt?: string;
  userConfirmedFinalPrice?: boolean;
  confirmedAt?: string;
  confirmationNote?: string;
  buyPriceAuction?: number;
  transactionFee?: number;
  vehicleHistoryFee?: number;
  otherFees?: number;
  subtotal?: number;
  taxes?: number;
  totalInvoiceAmount?: number;
  finalAcquisitionCost?: number;
  estimatedAuctionFees?: number;
  auctionHammerPrice?: number;
  location?: string;
  province?: string;
  sellerName?: string;
  sellerType?: string;
  auctionStatus?: string;
  saleDate?: string;
  runNumber?: string;
  lane?: string;
  lotNumber?: string;
  stockNumber?: string;
  titleStatus?: string;
  declarations?: string[];
  damageAnnouncements?: string[];
  mechanicalAnnouncements?: string[];
  structuralAnnouncements?: string[];
  odometerAnnouncements?: string[];
  tireCondition?: string;
  keysAvailable?: string | boolean;
  carfaxUrl?: string;
  carfaxMentioned?: boolean;
  carfaxAvailable?: boolean;
  carfaxUrlStatus?: "url_found" | "text_only" | "missing";
  photos?: MarketListingPhoto[];
  videos?: MarketListingVideo[];
  videoCount?: number;
  rawVisibleText?: string;
  pageContext?: Record<string, unknown>;
  identity?: Record<string, unknown>;
  auctionObservation?: Record<string, unknown>;
  purchaseOutcome?: Record<string, unknown>;
  condition?: Record<string, unknown>;
  media?: Record<string, unknown>;
  carfax?: Record<string, unknown>;
  debug?: Record<string, unknown>;
  fieldEvidence?: Record<string, ExtractionFieldEvidence[]>;
  openlaneMetadata?: Record<string, unknown>;
  extractedFields?: Record<string, unknown>;
  missingData?: string[];
  warnings?: string[];
  extractionConfidenceScore?: number;
  conditionReportText?: string;
  imageCount?: number;
  conditionFeatures?: ConditionFeatures;
  imageFeatures?: ImageFeatures;
  diagnosticFeatures?: DiagnosticFeatures;
  capturedAt?: string;
  marketType?: MarketType;
}

export interface MarketListingPhoto {
  url: string;
  thumbnailUrl?: string;
  alt?: string;
  width?: number;
  height?: number;
  source?: "img" | "srcset" | "picture" | "background-image" | "link";
}

export interface MarketListingVideo {
  url: string;
  posterUrl?: string;
  title?: string;
  type?: string;
  source?: "video" | "source" | "iframe" | "link";
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
  conditionFeatures?: ConditionFeatures;
  imageFeatures?: ImageFeatures;
  diagnosticFeatures?: DiagnosticFeatures;
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
  conditionFeatures?: ConditionFeatures;
  imageFeatures?: ImageFeatures;
  diagnosticFeatures?: DiagnosticFeatures;
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
  valuationExplanation?: Record<string, unknown>;
  modelVersion: string;
  modelVersionId?: string;
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
