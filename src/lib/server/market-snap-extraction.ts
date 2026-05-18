import { authorizedExtractionResponseSchema } from "@/lib/market-snap/validation";
import type { z } from "zod";
import type { authorizedExtractionRequestSchema } from "@/lib/market-snap/validation";

type AuthorizedExtractionRequest = z.infer<typeof authorizedExtractionRequestSchema>;

export async function extractAuthorizedListing(payload: AuthorizedExtractionRequest) {
  const baseUrl = process.env.MARKET_SNAP_ML_SERVICE_URL?.replace(/\/$/, "");
  if (!baseUrl) {
    return {
      ok: false,
      listing: null,
      warnings: ["MARKET_SNAP_ML_SERVICE_URL is not configured."],
      missingFields: [],
      degraded: true,
      extractionQualityScore: 0,
      policyDecision: "unavailable",
      policyReasons: ["Dealer Flow could not reach the Market Snap ML extraction service because no service URL is configured."],
      fallbackStrategies: ["browser_extension_local_extraction", "csv_import", "json_import", "scheduled_source_sync"],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl}/extract/authorized-listing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        html: payload.html,
        source_name: payload.sourceName,
        source_url: payload.sourceUrl || undefined,
        source_type: payload.sourceType,
        permission_basis: payload.permissionBasis,
        access_strategy: "browser_extension_capture",
        robots_allowed: payload.robotsAllowed,
        organization_id: payload.organizationId,
      }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json) {
      return serviceError(`Market Snap ML extraction service returned ${response.status}.`);
    }
    const normalized = normalizeExtractionResponse(json);
    return authorizedExtractionResponseSchema.parse(normalized);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return serviceError("Market Snap ML extraction timed out.");
    return serviceError(error instanceof Error ? error.message : "Market Snap ML extraction failed.");
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeExtractionResponse(value: Record<string, unknown>) {
  const listing = objectOrNull(value.listing);
  return {
    ok: Boolean(value.ok),
    listing: listing ? {
      sourceName: listing.sourceName ?? listing.source_name,
      sourceType: listing.sourceType ?? listing.source_type,
      listingUrl: listing.listingUrl ?? listing.listing_url,
      title: listing.title,
      description: listing.description,
      year: listing.year,
      make: listing.make,
      model: listing.model,
      trim: listing.trim,
      mileageKm: listing.mileageKm ?? listing.mileage_km,
      listedPrice: listing.listedPrice ?? listing.listed_price,
      auctionHammerPrice: listing.auctionHammerPrice ?? listing.auction_hammer_price,
      location: listing.location,
      province: listing.province,
      sellerType: listing.sellerType ?? listing.seller_type,
      titleStatus: listing.titleStatus ?? listing.title_status,
      conditionReportText: listing.conditionReportText ?? listing.condition_report_text,
      imageCount: listing.imageCount ?? listing.image_count,
      imageUrls: listing.imageUrls ?? listing.image_urls,
      capturedAt: listing.capturedAt ?? listing.captured_at,
    } : null,
    warnings: arrayOfStrings(value.warnings),
    missingFields: arrayOfStrings(value.missingFields ?? value.missing_fields),
    degraded: Boolean(value.degraded),
    extractionQualityScore: Number(value.extractionQualityScore ?? value.extraction_quality_score ?? 0),
    policyDecision: String(value.policyDecision ?? value.policy_decision ?? "unknown"),
    policyReasons: arrayOfStrings(value.policyReasons ?? value.policy_reasons),
    fallbackStrategies: arrayOfStrings(value.fallbackStrategies ?? value.fallback_strategies),
    rawVisibleTextPreview: typeof value.rawVisibleTextPreview === "string" ? value.rawVisibleTextPreview : typeof value.raw_visible_text_preview === "string" ? value.raw_visible_text_preview : undefined,
  };
}

function serviceError(message: string) {
  return {
    ok: false,
    listing: null,
    warnings: [message],
    missingFields: [],
    degraded: true,
    extractionQualityScore: 0,
    policyDecision: "unavailable",
    policyReasons: [message],
    fallbackStrategies: ["browser_extension_local_extraction", "csv_import", "json_import", "scheduled_source_sync"],
  };
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}
