import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { checkRateLimit, routeErrorResponse } from "@/lib/server/security";
import {
  completeMarketDataJob,
  createMarketDataJob,
  failMarketDataJob,
  upsertSyncedMarketListings,
  type SourceSyncJobType,
  type SyncedMarketListingInput,
} from "@/lib/market-snap/source-sync-repository";

export type SupportedSyncSource = "openlane" | "marketplace";

type SourceConfig = {
  key: SupportedSyncSource;
  sourceName: "OpenLane" | "Facebook Marketplace";
  sourceType: "auction" | "retail";
  marketType: "auction_market" | "clean_retail_market";
  jobType: SourceSyncJobType;
  maxPages: number;
  maxListings: number;
  province: "QC";
  baseSearchUrls: string[];
  rateLimitBucket: string;
};

const SOURCE_CONFIGS: Record<SupportedSyncSource, SourceConfig> = {
  openlane: {
    key: "openlane",
    sourceName: "OpenLane",
    sourceType: "auction",
    marketType: "auction_market",
    jobType: "openlane_source_sync",
    maxPages: 25,
    maxListings: 500,
    province: "QC",
    baseSearchUrls: [],
    rateLimitBucket: "market-snap-sync-openlane",
  },
  marketplace: {
    key: "marketplace",
    sourceName: "Facebook Marketplace",
    sourceType: "retail",
    marketType: "clean_retail_market",
    jobType: "marketplace_source_sync",
    maxPages: 10,
    maxListings: 200,
    province: "QC",
    baseSearchUrls: [],
    rateLimitBucket: "market-snap-sync-marketplace",
  },
};

export async function runCronSourceSync(request: Request, source: SupportedSyncSource) {
  try {
    const config = getSourceConfig(source);
    await checkRateLimit(request, config.rateLimitBucket, { limit: 6, windowMs: 60_000 });
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret?.trim()) return NextResponse.json({ ok: false, message: "CRON_SECRET is required." }, { status: 503 });
    if (!hasValidBearerSecret(request.headers.get("authorization"), cronSecret)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const missing = requiredEnv().filter((key) => !process.env[key]);
    if (missing.length > 0) return NextResponse.json({ ok: false, message: "Market Snap source sync is not configured.", missing }, { status: 503 });

    const client = createServiceClient();
    const summary = await runSourceSync(client, config, "cron");
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function runAdminSourceSync(source: SupportedSyncSource) {
  const missing = requiredEnv().filter((key) => !process.env[key]);
  if (missing.length > 0) throw new Error(`Market Snap source sync is not configured: ${missing.join(", ")}`);
  return runSourceSync(createServiceClient(), getSourceConfig(source), "admin");
}

export function sourceSyncDefaults() {
  return SOURCE_CONFIGS;
}

function getSourceConfig(source: SupportedSyncSource): SourceConfig {
  const config = { ...SOURCE_CONFIGS[source] };
  if (source === "openlane") config.baseSearchUrls = envList("MARKET_SNAP_OPENLANE_SEARCH_URLS");
  if (source === "marketplace") config.baseSearchUrls = envList("MARKET_SNAP_MARKETPLACE_SEARCH_URLS");
  return config;
}

async function runSourceSync(client: SupabaseClient, config: SourceConfig, runReason: "cron" | "admin") {
  const startedAt = new Date().toISOString();
  const jobId = await createMarketDataJob(client, {
    jobType: config.jobType,
    sourceName: config.sourceName,
    startedAt,
    metrics: {
      sourceName: config.sourceName,
      runReason,
      maxPages: config.maxPages,
      maxListings: config.maxListings,
    },
  });

  let partialMetrics: Record<string, unknown> = {};
  try {
    const mlPayload = await callMlSourceSync(config, runReason, startedAt);
    const listings = mapMlListings(mlPayload.listings ?? [], config);
    const upsertMetrics = await upsertSyncedMarketListings(client, listings);
    const metrics = {
      sourceName: config.sourceName,
      ...(mlPayload.metrics ?? {}),
      ...upsertMetrics,
      durationMs: Number(mlPayload.metrics?.durationMs ?? Date.now() - new Date(startedAt).getTime()),
      warnings: mlPayload.warnings ?? [],
    };
    partialMetrics = metrics;
    await completeMarketDataJob(client, jobId, metrics);
    await updateMarketSource(client, config.sourceName, "active");
    return { jobId, sourceName: config.sourceName, metrics };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source sync failed.";
    await failMarketDataJob(client, jobId, message, { sourceName: config.sourceName, ...partialMetrics });
    await updateMarketSource(client, config.sourceName, "error");
    throw error;
  }
}

async function callMlSourceSync(config: SourceConfig, runReason: "cron" | "admin", startedAt: string) {
  const baseUrl = process.env.MARKET_SNAP_ML_SERVICE_URL!.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/sources/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceName: config.sourceName,
      sourceType: config.sourceType,
      marketType: config.marketType,
      maxPages: config.maxPages,
      maxListings: config.maxListings,
      baseSearchUrls: config.baseSearchUrls,
      province: config.province,
      runReason,
      startedAt,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(String(payload.message ?? payload.detail ?? `ML source sync returned ${response.status}.`));
  }
  return payload as { listings?: Array<Record<string, unknown>>; metrics?: Record<string, unknown>; warnings?: string[] };
}

export function mapMlListings(rows: Array<Record<string, unknown>>, config = SOURCE_CONFIGS.openlane): SyncedMarketListingInput[] {
  return rows.map((row) => ({
    organizationId: "",
    sourceName: String(row.sourceName ?? row.source_name ?? config.sourceName),
    sourceType: String(row.sourceType ?? row.source_type ?? config.sourceType) as never,
    sourceListingId: text(row.sourceListingId ?? row.source_listing_id),
    listingUrl: text(row.listingUrl ?? row.listing_url),
    title: text(row.title),
    description: text(row.description),
    year: numberOrUndefined(row.year),
    make: text(row.make),
    model: text(row.model),
    trim: text(row.trim),
    mileageKm: numberOrUndefined(row.mileageKm ?? row.mileage_km),
    listedPrice: numberOrUndefined(row.listedPrice ?? row.listed_price),
    auctionHammerPrice: numberOrUndefined(row.auctionHammerPrice ?? row.auction_hammer_price),
    location: text(row.location),
    province: text(row.province) || config.province,
    sellerType: text(row.sellerType ?? row.seller_type),
    titleStatus: text(row.titleStatus ?? row.title_status),
    conditionReportText: text(row.conditionReportText ?? row.condition_report_text),
    imageCount: numberOrUndefined(row.imageCount ?? row.image_count),
    imageUrls: Array.isArray(row.imageUrls) ? row.imageUrls.map(String).slice(0, 30) : [],
    capturedAt: text(row.capturedAt ?? row.captured_at) || new Date().toISOString(),
    marketType: String(row.marketType ?? row.market_type ?? config.marketType) as never,
    dataQualityScore: numberOrUndefined(row.dataQualityScore ?? row.data_quality_score),
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
    missingFields: Array.isArray(row.missingFields) ? row.missingFields.map(String) : [],
  }));
}

async function updateMarketSource(client: SupabaseClient, sourceName: string, status: "active" | "error") {
  await client
    .from("market_sources")
    .update({ status, last_sync_at: new Date().toISOString() })
    .is("organization_id", null)
    .eq("name", sourceName);
}

function createServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

function requiredEnv() {
  return ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MARKET_SNAP_ML_SERVICE_URL"];
}

function envList(key: string) {
  return String(process.env[key] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function hasValidBearerSecret(authHeader: string | null, secret: string) {
  const prefix = "Bearer ";
  if (!authHeader?.startsWith(prefix)) return false;
  const providedBuffer = Buffer.from(authHeader.slice(prefix.length));
  const secretBuffer = Buffer.from(secret);
  return providedBuffer.length === secretBuffer.length && timingSafeEqual(providedBuffer, secretBuffer);
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function numberOrUndefined(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
