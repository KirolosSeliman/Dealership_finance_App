import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
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

export async function upsertMarketListingFromAnalysis(client: Client, input: MarketListingInput, valuation?: VehicleValuation) {
  const normalized = normalizeListing(input);
  const expiresAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
  const { data, error } = await client
    .from("market_listings")
    .insert({
      organization_id: normalized.organizationId,
      source_name: normalized.sourceName,
      source_type: normalized.sourceType ?? "extension",
      listing_url: normalized.listingUrl || null,
      title: normalized.title || normalized.normalizedTitle,
      description: normalized.description || null,
      condition_report_text: normalized.conditionReportText || null,
      year: normalized.year ?? null,
      make: normalized.make || null,
      model: normalized.model || null,
      trim: normalized.trim || null,
      vin: normalized.vin || null,
      mileage_km: normalized.mileageKm ?? null,
      listed_price: normalized.listedPrice ?? normalized.buyNowPrice ?? normalized.currentBid ?? normalized.auctionHammerPrice ?? null,
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
      normalized_payload: {
        ...normalized,
        valuation: valuation ? {
          estimatedRetailMarketValue: valuation.estimatedRetailMarketValue,
          confidenceScore: valuation.confidenceScore,
          estimatorType: valuation.estimatorType,
          modelVersion: valuation.modelVersion,
        } : undefined,
      },
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
      carfax_url: normalized.carfaxUrl || null,
      carfax_available: normalized.carfaxAvailable ?? Boolean(normalized.carfaxUrl),
      photos_json: normalized.photos ?? [],
      videos_json: normalized.videos ?? [],
      openlane_metadata: openLaneMetadata(normalized),
      extraction_confidence_score: normalized.extractionConfidenceScore ?? null,
      extraction_warnings: normalized.warnings ?? [],
      raw_visible_text: capRawVisibleText(normalized.rawVisibleText),
      expires_at: expiresAt,
      retention_policy: "temporary_capture",
      captured_at: normalized.capturedAt ?? new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

export async function saveListingToDealRadar(client: Client, input: MarketListingInput, valuation?: VehicleValuation) {
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
      vin: input.vin || null,
      mileage_km: input.mileageKm ?? null,
      listed_price: input.listedPrice ?? input.buyNowPrice ?? input.currentBid ?? input.auctionHammerPrice ?? null,
      market_type: valuation?.marketType ?? input.marketType ?? "clean_retail_market",
      normalized_payload: input,
      condition_features: input.conditionFeatures ?? {},
      image_features: input.imageFeatures ?? { imageCount: input.imageCount, photoAnalysisStatus: input.imageCount ? "not_started" : "unknown" },
      diagnostic_features: input.diagnosticFeatures ?? {},
      carfax_url: input.carfaxUrl || null,
      carfax_available: input.carfaxAvailable ?? Boolean(input.carfaxUrl),
      photos_json: input.photos ?? [],
      videos_json: input.videos ?? [],
      openlane_metadata: openLaneMetadata(input),
      extraction_confidence_score: input.extractionConfidenceScore ?? null,
      extraction_warnings: input.warnings ?? [],
      raw_visible_text: capRawVisibleText(input.rawVisibleText),
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

export const saveMarketListing = saveListingToDealRadar;

export async function persistOpenLaneCapture(client: Client, input: MarketListingInput, capturedBy?: string) {
  if (!isOpenLaneCapture(input)) {
    return { vehicleIdentityId: null, observationStored: false, outcomeStored: false };
  }

  const identityPayload = openLaneIdentityPayload(input, capturedBy);
  const { data: identity, error: identityError } = await client
    .from("openlane_vehicle_identities")
    .upsert(identityPayload, { onConflict: "organization_id,fallback_key" })
    .select("id")
    .single();
  if (identityError) throw identityError;

  const vehicleIdentityId = String(identity.id);
  let observationId: string | null = null;
  let outcomeId: string | null = null;

  if (isOpenLaneObservation(input)) {
    const { data, error } = await client
      .from("openlane_observations")
      .upsert(openLaneObservationPayload(input, vehicleIdentityId, capturedBy), { onConflict: "organization_id,observation_fingerprint", ignoreDuplicates: true })
      .select("id")
      .single();
    if (error) throw error;
    observationId = data?.id ? String(data.id) : null;
  }

  if (isOpenLaneOutcome(input)) {
    const { data, error } = await client
      .from("openlane_outcomes")
      .upsert(openLaneOutcomePayload(input, vehicleIdentityId, capturedBy), { onConflict: "organization_id,outcome_fingerprint", ignoreDuplicates: true })
      .select("id")
      .single();
    if (error) throw error;
    outcomeId = data?.id ? String(data.id) : null;
  }

  return {
    vehicleIdentityId,
    observationId,
    outcomeId,
    observationStored: Boolean(observationId),
    outcomeStored: Boolean(outcomeId),
  };
}

export async function getDealRadarListings(client: Client, organizationId: string, page = 1, pageSize = 25) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await client
    .from("deal_radar_saved_listings")
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return { items: data ?? [], count: count ?? 0 };
}

export async function removeDealRadarListing(client: Client, organizationId: string, id: string) {
  const { error } = await client
    .from("deal_radar_saved_listings")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) throw error;
}

export function convertDealRadarListingToInventory(data: Record<string, unknown>) {
  return {
    year: data.year ?? undefined,
    make: stringOrUndefined(data.make),
    model: stringOrUndefined(data.model),
    trim: stringOrUndefined(data.trim),
    mileage: numberOrUndefined(data.mileage_km),
    purchasePrice: numberOrUndefined(data.listed_price),
    purchaseSource: sourceToPurchaseSource(String(data.source_name ?? "")),
    notes: `Imported from Deal Radar. Review all fields before creating inventory. Source: ${data.listing_url ?? data.source_name ?? "unknown"}`,
  };
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
      vin: normalized.vin || null,
      mileage_km: normalized.mileageKm ?? null,
      listed_price: normalized.listedPrice ?? normalized.buyNowPrice ?? normalized.currentBid ?? normalized.auctionHammerPrice ?? null,
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
      carfax_url: normalized.carfaxUrl || null,
      carfax_available: normalized.carfaxAvailable ?? Boolean(normalized.carfaxUrl),
      photos_json: normalized.photos ?? [],
      videos_json: normalized.videos ?? [],
      openlane_metadata: openLaneMetadata(normalized),
      extraction_confidence_score: normalized.extractionConfidenceScore ?? null,
      extraction_warnings: normalized.warnings ?? [],
      raw_visible_text: capRawVisibleText(normalized.rawVisibleText),
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

export async function getLatestVehicleValuation(client: Client, organizationId: string, vehicleId: string) {
  const history = await getVehicleValuationHistory(client, organizationId, vehicleId, 1);
  return history[0];
}

export async function getVehicleValuationHistory(client: Client, organizationId: string, vehicleId: string, limit = 25) {
  const { data, error } = await client
    .from("vehicle_valuations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("vehicle_id", vehicleId)
    .order("valuation_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
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

function capRawVisibleText(value?: string) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 12_000) : null;
}

function openLaneMetadata(input: MarketListingInput) {
  const baseMetadata = capOpenLaneStorageValue(input.openlaneMetadata ?? {});
  return {
    ...(typeof baseMetadata === "object" && !Array.isArray(baseMetadata) ? baseMetadata : {}),
    pageType: input.pageType,
    captureKind: input.captureKind,
    outcomeConfidence: input.outcomeConfidence,
    priceSemantics: input.priceSemantics ?? {},
    outcomeEvidence: input.outcomeEvidence ?? [],
    currentBid: input.currentBid,
    currentOffer: input.currentOffer,
    bestOffer: input.bestOffer,
    buyNowPrice: input.buyNowPrice,
    reservePrice: input.reservePrice,
    soldPriceCandidate: input.soldPriceCandidate,
    finalBidAmount: input.finalBidAmount,
    negotiatedAmount: input.negotiatedAmount,
    counterOfferAmount: input.counterOfferAmount,
    acceptedAmount: input.acceptedAmount,
    negotiationStatus: input.negotiationStatus,
    negotiatedAt: input.negotiatedAt,
    acceptedAt: input.acceptedAt,
    userConfirmedFinalPrice: input.userConfirmedFinalPrice,
    confirmedAt: input.confirmedAt,
    confirmationNote: input.confirmationNote,
    buyPriceAuction: input.buyPriceAuction,
    transactionFee: input.transactionFee,
    vehicleHistoryFee: input.vehicleHistoryFee,
    otherFees: input.otherFees,
    subtotal: input.subtotal,
    taxes: input.taxes,
    totalInvoiceAmount: input.totalInvoiceAmount,
    finalAcquisitionCost: input.finalAcquisitionCost,
    estimatedAuctionFees: input.estimatedAuctionFees,
    exteriorColor: input.exteriorColor,
    interiorColor: input.interiorColor,
    drivetrain: input.drivetrain,
    transmission: input.transmission,
    engine: input.engine,
    fuelType: input.fuelType,
    bodyStyle: input.bodyStyle,
    doors: input.doors,
    cylinders: input.cylinders,
    sellerName: input.sellerName,
    auctionStatus: input.auctionStatus,
    saleDate: input.saleDate,
    runNumber: input.runNumber,
    lane: input.lane,
    lotNumber: input.lotNumber,
    stockNumber: input.stockNumber,
    declarations: input.declarations ?? [],
    damageAnnouncements: input.damageAnnouncements ?? [],
    mechanicalAnnouncements: input.mechanicalAnnouncements ?? [],
    structuralAnnouncements: input.structuralAnnouncements ?? [],
    odometerAnnouncements: input.odometerAnnouncements ?? [],
    tireCondition: input.tireCondition,
    keysAvailable: input.keysAvailable,
    carfaxMentioned: input.carfaxMentioned,
    carfaxUrlStatus: input.carfaxUrlStatus,
    extractedFields: capOpenLaneStorageValue(input.extractedFields ?? {}),
    missingData: input.missingData ?? [],
    videoCount: input.videoCount ?? input.videos?.length ?? 0,
    extractionContract: capOpenLaneStorageValue({
      pageContext: input.pageContext,
      identity: input.identity,
      auctionObservation: input.auctionObservation,
      purchaseOutcome: input.purchaseOutcome,
      condition: input.condition,
      media: input.media,
      carfax: input.carfax,
      debug: input.debug,
    }),
  };
}

function isOpenLaneCapture(input: MarketListingInput) {
  return input.sourceName.toLowerCase().includes("openlane") || Boolean(input.pageType);
}

function isOpenLaneObservation(input: MarketListingInput) {
  return input.captureKind === "observation" || input.pageType === "active_listing" || input.pageType === "watchlist";
}

function isOpenLaneOutcome(input: MarketListingInput) {
  return input.captureKind === "candidate_outcome"
    || input.captureKind === "verified_outcome"
    || input.captureKind === "manual_confirmation"
    || [
      input.soldPriceCandidate,
      input.finalBidAmount,
      input.negotiatedAmount,
      input.counterOfferAmount,
      input.acceptedAmount,
      input.buyPriceAuction,
      input.totalInvoiceAmount,
      input.finalAcquisitionCost,
    ].some((value) => value !== undefined);
}

function openLaneIdentityPayload(input: MarketListingInput, capturedBy?: string) {
  return compactDbRow({
    organization_id: input.organizationId,
    vin: input.vin ?? null,
    fallback_key: openLaneFallbackKey(input),
    listing_url: input.listingUrl || null,
    title: input.title || null,
    year: input.year ?? null,
    make: input.make || null,
    model: input.model || null,
    trim: input.trim || null,
    mileage_km: input.mileageKm ?? null,
    identity_confidence: input.vin ? "high" : input.listingUrl ? "medium" : "low",
    last_seen_at: input.capturedAt ?? new Date().toISOString(),
    created_by: capturedBy ?? null,
  });
}

function openLaneObservationPayload(input: MarketListingInput, vehicleIdentityId: string, capturedBy?: string) {
  const metadata = input.openlaneMetadata ?? {};
  const disclosureCount = numberOrUndefined((metadata as { disclosureCount?: unknown }).disclosureCount);
  return compactDbRow({
    organization_id: input.organizationId,
    vehicle_identity_id: vehicleIdentityId,
    source_name: input.sourceName,
    listing_url: input.listingUrl || null,
    page_type: input.pageType ?? null,
    capture_kind: input.captureKind ?? "observation",
    current_bid: input.currentBid ?? null,
    buy_now_price: input.buyNowPrice ?? null,
    time_remaining: stringOrUndefined((metadata as { timeRemaining?: unknown }).timeRemaining) ?? null,
    status_text: input.auctionStatus ?? input.negotiationStatus ?? null,
    disclosure_count: disclosureCount ?? null,
    photo_count: input.imageCount ?? input.photos?.length ?? null,
    captured_at: input.capturedAt ?? new Date().toISOString(),
    captured_by: capturedBy ?? null,
    confidence_level: input.outcomeConfidence ?? "low",
    evidence: input.outcomeEvidence ?? [],
    capped_payload: cappedOpenLanePayload(input),
    observation_fingerprint: captureFingerprint("observation", input, [
      input.currentBid,
      input.currentOffer,
      input.bestOffer,
      input.buyNowPrice,
      input.auctionStatus,
      disclosureCount,
      input.imageCount,
    ]),
  });
}

function openLaneOutcomePayload(input: MarketListingInput, vehicleIdentityId: string, capturedBy?: string) {
  const outcomeType = openLaneOutcomeType(input);
  return compactDbRow({
    organization_id: input.organizationId,
    vehicle_identity_id: vehicleIdentityId,
    source_name: input.sourceName,
    listing_url: input.listingUrl || null,
    outcome_type: outcomeType,
    source_page_type: input.pageType ?? null,
    capture_kind: input.captureKind ?? "candidate_outcome",
    confidence_level: input.outcomeConfidence ?? (input.captureKind === "verified_outcome" ? "verified" : "medium"),
    sold_price_candidate: input.soldPriceCandidate ?? null,
    final_bid_amount: input.finalBidAmount ?? null,
    negotiated_amount: input.negotiatedAmount ?? null,
    counter_offer_amount: input.counterOfferAmount ?? null,
    accepted_amount: input.acceptedAmount ?? null,
    buy_price_auction: input.buyPriceAuction ?? null,
    transaction_fee: input.transactionFee ?? null,
    vehicle_history_fee: input.vehicleHistoryFee ?? null,
    other_fees: input.otherFees ?? null,
    subtotal: input.subtotal ?? null,
    taxes: input.taxes ?? null,
    total_invoice_amount: input.totalInvoiceAmount ?? null,
    final_acquisition_cost: input.finalAcquisitionCost ?? null,
    negotiation_status: input.negotiationStatus ?? null,
    evidence: input.outcomeEvidence ?? [],
    price_semantics: input.priceSemantics ?? {},
    capped_payload: cappedOpenLanePayload(input),
    captured_at: input.capturedAt ?? new Date().toISOString(),
    captured_by: capturedBy ?? null,
    is_training_eligible: input.captureKind === "verified_outcome" || input.captureKind === "manual_confirmation",
    outcome_fingerprint: captureFingerprint(outcomeType, input, [
      input.soldPriceCandidate,
      input.finalBidAmount,
      input.negotiatedAmount,
      input.acceptedAmount,
      input.buyPriceAuction,
      input.totalInvoiceAmount,
      input.finalAcquisitionCost,
      input.negotiationStatus,
    ]),
  });
}

function openLaneOutcomeType(input: MarketListingInput) {
  if (input.captureKind === "manual_confirmation" || input.userConfirmedFinalPrice) return "manual_confirmation";
  if (input.pageType === "fee_details" || input.totalInvoiceAmount || input.finalAcquisitionCost || input.buyPriceAuction) return "purchase_fee_details";
  if (input.captureKind === "verified_outcome" && (input.acceptedAmount || input.negotiatedAmount || input.finalBidAmount)) return "accepted_negotiation";
  if (input.pageType === "post_sale") return "post_sale_candidate";
  return input.captureKind === "verified_outcome" ? "verified_outcome" : "candidate_outcome";
}

function openLaneFallbackKey(input: MarketListingInput) {
  if (input.vin) return `vin:${input.vin}`;
  if (input.listingUrl) return `url:${hashText(input.listingUrl)}`;
  return `fallback:${hashText([input.title, input.year, input.make, input.model, input.saleDate].filter(Boolean).join("|"))}`;
}

function captureFingerprint(kind: string, input: MarketListingInput, parts: unknown[]) {
  return hashText([
    kind,
    input.organizationId,
    openLaneFallbackKey(input),
    input.listingUrl ?? "",
    input.pageType ?? "",
    input.captureKind ?? "",
    ...parts.map((part) => part ?? ""),
  ].join("|"));
}

function cappedOpenLanePayload(input: MarketListingInput) {
  return {
    sourceName: input.sourceName,
    listingUrl: input.listingUrl,
    pageType: input.pageType,
    captureKind: input.captureKind,
    outcomeConfidence: input.outcomeConfidence,
    title: input.title,
    year: input.year,
    make: input.make,
    model: input.model,
    trim: input.trim,
    vin: input.vin,
    mileageKm: input.mileageKm,
    currentBid: input.currentBid,
    currentOffer: input.currentOffer,
    bestOffer: input.bestOffer,
    buyNowPrice: input.buyNowPrice,
    soldPriceCandidate: input.soldPriceCandidate,
    finalBidAmount: input.finalBidAmount,
    negotiatedAmount: input.negotiatedAmount,
    counterOfferAmount: input.counterOfferAmount,
    acceptedAmount: input.acceptedAmount,
    buyPriceAuction: input.buyPriceAuction,
    totalInvoiceAmount: input.totalInvoiceAmount,
    finalAcquisitionCost: input.finalAcquisitionCost,
    priceSemantics: input.priceSemantics,
    outcomeEvidence: input.outcomeEvidence?.slice(0, 20),
    openlaneMetadata: openLaneMetadata(input),
    warnings: input.warnings?.slice(0, 20),
    missingData: input.missingData?.slice(0, 20),
  };
}

function capOpenLaneStorageValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth_capped]";
  if (typeof value === "string") return sanitizeStorageString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 120).map((item) => capOpenLaneStorageValue(item, depth + 1));
  if (typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 120).map(([key, item]) => [
    key,
    /token|secret|password|credential|authorization|cookie|session/i.test(key) ? "[redacted]" : capOpenLaneStorageValue(item, depth + 1),
  ]));
}

function sanitizeStorageString(value: string) {
  const text = value
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
    .replace(/\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
    .slice(0, 4000);
  return /^\s*(javascript|data|vbscript):/i.test(text) ? "[unsafe_url_removed]" : text;
}

function compactDbRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceToPurchaseSource(sourceName: string) {
  const source = sourceName.toLowerCase();
  if (source.includes("openlane")) return "OpenLane";
  if (source.includes("iaa")) return "IAA";
  if (source.includes("copart")) return "Copart";
  if (source.includes("facebook")) return "FacebookMarketplace";
  if (source.includes("auction")) return "dealerAuction";
  return "other";
}
