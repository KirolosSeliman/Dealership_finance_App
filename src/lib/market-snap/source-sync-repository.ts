import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeListing } from "@/lib/market-snap/engine";
import type { MarketListingInput, MarketType, MarketSourceType } from "@/types/market-snap";

type Client = SupabaseClient;

export type SourceSyncJobType = "openlane_source_sync" | "marketplace_source_sync";

export interface SyncedMarketListingInput extends MarketListingInput {
  sourceListingId?: string;
  imageUrls?: string[];
  dataQualityScore?: number;
  warnings?: string[];
  missingFields?: string[];
}

export interface SourceSyncMetrics {
  totalReceived: number;
  inserted: number;
  updated: number;
  skippedDuplicates: number;
  invalidRows: number;
}

export async function createMarketDataJob(
  client: Client,
  input: { jobType: SourceSyncJobType; sourceName: string; startedAt: string; metrics?: Record<string, unknown> },
) {
  const { data, error } = await client
    .from("market_data_jobs")
    .insert({
      job_type: input.jobType,
      status: "running",
      source_name: input.sourceName,
      started_at: input.startedAt,
      metrics: input.metrics ?? {},
    })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

export async function completeMarketDataJob(client: Client, jobId: string, metrics: Record<string, unknown>) {
  const { error } = await client
    .from("market_data_jobs")
    .update({
      status: "succeeded",
      completed_at: new Date().toISOString(),
      error_message: null,
      metrics,
    })
    .eq("id", jobId);
  if (error) throw error;
}

export async function failMarketDataJob(client: Client, jobId: string, message: string, metrics: Record<string, unknown> = {}) {
  const { error } = await client
    .from("market_data_jobs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message,
      metrics,
    })
    .eq("id", jobId);
  if (error) throw error;
}

export async function upsertSyncedMarketListings(client: Client, listings: SyncedMarketListingInput[]): Promise<SourceSyncMetrics> {
  const metrics: SourceSyncMetrics = {
    totalReceived: listings.length,
    inserted: 0,
    updated: 0,
    skippedDuplicates: 0,
    invalidRows: 0,
  };
  const seen = new Set<string>();

  for (const listing of listings) {
    if (!isValidListing(listing)) {
      metrics.invalidRows += 1;
      continue;
    }

    const fingerprint = listingFingerprint(listing);
    const receivedKey = listing.sourceListingId || listing.listingUrl || fingerprint;
    if (seen.has(receivedKey)) {
      metrics.skippedDuplicates += 1;
      continue;
    }
    seen.add(receivedKey);

    const existing = await findExistingListing(client, listing, fingerprint);
    const record = toMarketListingRecord(listing, fingerprint);

    if (existing?.id) {
      const merged = mergeListingRecord(existing, record);
      const { error } = await client.from("market_listings").update(merged).eq("id", existing.id);
      if (error) throw error;
      metrics.updated += 1;
    } else {
      const { error } = await client.from("market_listings").insert(record);
      if (error) throw error;
      metrics.inserted += 1;
    }
  }

  return metrics;
}

export function listingFingerprint(input: SyncedMarketListingInput) {
  return [
    input.sourceName,
    input.title,
    input.year,
    input.make,
    input.model,
    input.mileageKm,
    input.listedPrice ?? input.auctionHammerPrice,
    input.province,
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .join("|");
}

async function findExistingListing(client: Client, listing: SyncedMarketListingInput, fingerprint: string) {
  const select = "id, title, description, mileage_km, listed_price, auction_hammer_price, normalized_payload, sanitized_raw_payload, data_quality_score, captured_at";
  if (listing.sourceListingId) {
    const { data, error } = await client
      .from("market_listings")
      .select(select)
      .eq("source_name", listing.sourceName)
      .eq("source_listing_id", listing.sourceListingId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as Record<string, unknown>;
  }
  if (listing.listingUrl) {
    const { data, error } = await client
      .from("market_listings")
      .select(select)
      .eq("source_name", listing.sourceName)
      .eq("listing_url", listing.listingUrl)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as Record<string, unknown>;
  }
  const { data, error } = await client
    .from("market_listings")
    .select(select)
    .eq("source_name", listing.sourceName)
    .contains("normalized_payload", { sourceSyncFingerprint: fingerprint })
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

function toMarketListingRecord(input: SyncedMarketListingInput, fingerprint: string) {
  const normalized = normalizeListing(input);
  const capturedAt = normalized.capturedAt ?? new Date().toISOString();
  const expiresAt = new Date(Date.now() + 180 * 86_400_000).toISOString();
  const quality = input.dataQualityScore ?? normalized.dataQualityScore;
  return {
    organization_id: normalized.organizationId || null,
    source_name: normalized.sourceName,
    source_type: (normalized.sourceType ?? "retail") as MarketSourceType,
    listing_url: normalized.listingUrl || null,
    source_listing_id: input.sourceListingId || null,
    title: normalized.title || normalized.normalizedTitle,
    description: normalized.description || null,
    condition_report_text: normalized.conditionReportText || null,
    year: normalized.year ?? null,
    make: normalized.make || null,
    model: normalized.model || null,
    trim: normalized.trim || null,
    mileage_km: normalized.mileageKm ?? null,
    listed_price: normalized.listedPrice ?? null,
    auction_hammer_price: normalized.auctionHammerPrice ?? null,
    location: normalized.location || null,
    province: normalized.province || null,
    seller_type: normalized.sellerType || null,
    title_status: normalized.titleStatus,
    market_type: normalized.marketType as MarketType,
    data_quality_score: quality,
    source_reliability_score: normalized.sourceReliabilityScore,
    time_decay_weight: normalized.timeDecayWeight,
    sample_weight: normalized.sampleWeight,
    normalized_payload: {
      ...normalized,
      sourceListingId: input.sourceListingId,
      imageUrls: input.imageUrls?.slice(0, 30) ?? [],
      warnings: input.warnings ?? normalized.warnings,
      missingFields: input.missingFields ?? normalized.missingData,
      sourceSyncFingerprint: fingerprint,
    },
    sanitized_raw_payload: {
      title: normalized.title,
      description: normalized.description,
      price: normalized.listedPrice ?? normalized.auctionHammerPrice,
      mileageKm: normalized.mileageKm,
      location: normalized.location,
      listingUrl: normalized.listingUrl,
      sourceListingId: input.sourceListingId,
    },
    condition_features: normalized.conditionFeatures ?? {},
    image_features: normalized.imageFeatures ?? { imageCount: input.imageCount ?? input.imageUrls?.length ?? 0 },
    diagnostic_features: normalized.diagnosticFeatures ?? {},
    expires_at: expiresAt,
    retention_policy: "unsaved_market_listing",
    captured_at: capturedAt,
    is_active: true,
  };
}

function mergeListingRecord(existing: Record<string, unknown>, next: ReturnType<typeof toMarketListingRecord>) {
  const existingQuality = Number(existing.data_quality_score ?? 0);
  const nextQuality = Number(next.data_quality_score ?? 0);
  return {
    ...next,
    title: pickBetterText(existing.title, next.title),
    description: pickBetterText(existing.description, next.description),
    mileage_km: next.mileage_km ?? existing.mileage_km ?? null,
    listed_price: next.listed_price ?? existing.listed_price ?? null,
    auction_hammer_price: next.auction_hammer_price ?? existing.auction_hammer_price ?? null,
    data_quality_score: Math.max(existingQuality, nextQuality),
    captured_at: next.captured_at,
  };
}

function pickBetterText(current: unknown, next: unknown) {
  const currentText = String(current ?? "");
  const nextText = String(next ?? "");
  return nextText.length >= currentText.length ? nextText || null : currentText || null;
}

function isValidListing(input: SyncedMarketListingInput) {
  if (!input.year || !input.make || !input.model) return false;
  if (!input.listedPrice && !input.auctionHammerPrice) return false;
  return true;
}
