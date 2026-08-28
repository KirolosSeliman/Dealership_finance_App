import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSameOrigin, checkRateLimit, requireOrganizationRole, routeErrorResponse } from "@/lib/server/security";
import { DEEP_CAPTURE_CONSENT_VERSION, DEEP_CAPTURE_PRIVACY_VERSION, DEEP_CAPTURE_SCOPES, DEEP_CAPTURE_TERMS_VERSION } from "@/lib/market-snap/deep-capture-policy";
import {
  getActiveMarketSnapCaptureConsent,
  isMarketSnapDeepCapturePayload,
  recordMarketSnapConsentEvent,
  requiredDeepCaptureScopes,
  requireMarketSnapDeepCaptureConsent,
} from "@/lib/server/market-snap-consent";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapExpense, mapVehicle } from "@/lib/supabase/mappers";
import { runComparableEstimator, shouldRefreshVehicle } from "@/lib/market-snap/engine";
import {
  convertDealRadarListingToInventory,
  fetchMarketComparables,
  getDealRadarListings,
  insertMarketListings,
  persistOpenLaneCapture,
  removeDealRadarListing,
  saveListingToDealRadar,
  saveVehicleValuation,
  upsertMarketListingFromAnalysis,
} from "@/lib/market-snap/repository";
import { dealRadarQuerySchema, deepCaptureConsentActionSchema, importPayloadSchema, marketListingPayloadSchema, saveListingSchema, valuationRequestSchema } from "@/lib/market-snap/validation";
import type { MarketSnapCaptureScope } from "@/types/market-snap";
import type { MarketListingInput } from "@/types/market-snap";
import type { Vehicle, VehicleExpense } from "@/types/domain";

type Client = SupabaseClient;

export async function withMarketSnapAuth(
  request: Request,
  bucket: string,
  handler: (context: { client: Client; userId: string; body: unknown }) => Promise<Response>,
) {
  const headers = marketSnapCorsHeaders(request);
  try {
    assertAllowedMarketSnapOrigin(request);
    await checkRateLimit(request, bucket, { limit: 80, windowMs: 60_000 });
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503, headers });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401, headers });
    await checkRateLimit(request, `${bucket}-user`, { limit: 60, windowMs: 60_000, userId: data.user.id });
    const body = await readBody(request);
    const response = await handler({ client, userId: data.user.id, body });
    for (const [key, value] of headers.entries()) response.headers.set(key, value);
    return response;
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers });
  }
}

export async function marketSnapOptions(request: Request) {
  return new Response(null, { status: 204, headers: marketSnapCorsHeaders(request) });
}

export async function deepCaptureConsent(request: Request) {
  return withMarketSnapAuth(request, "market-snap-deep-capture-consent", async ({ client, userId, body }) => {
    const payload = deepCaptureConsentActionSchema.parse(body);

    if (payload.action === "status") {
      await requireOrganizationRole(client, userId, payload.organizationId, ["owner", "admin", "member", "accountant", "viewer"]);
      return NextResponse.json({ ok: true, ...(await buildDeepCaptureConsentStatus(client, payload.organizationId, userId)) });
    }

    await requireOrganizationRole(client, userId, payload.organizationId, ["owner", "admin"]);

    if (payload.action === "list_events") {
      return NextResponse.json({ ok: true, events: await listDeepCaptureConsentEvents(client, payload.organizationId) });
    }

    if (payload.action === "export_audit") {
      return NextResponse.json({ ok: true, audit: await exportDeepCaptureAudit(client, payload.organizationId, userId) });
    }

    if (payload.action === "delete_eligible_captures") {
      const deletion = await deleteEligibleDeepCaptureData(client, payload.organizationId, userId);
      return NextResponse.json({ ok: true, deletion });
    }

    if (payload.action === "disable_model_improvement") {
      const result = await disableDeepCaptureModelImprovement(client, payload.organizationId, userId);
      return NextResponse.json({ ok: true, ...result });
    }

    if (payload.action === "withdraw") {
      const active = await getActiveMarketSnapCaptureConsent(client, payload.organizationId, userId);
      if (active) {
        const { error } = await client
          .from("market_snap_capture_consents")
          .update({
            status: "withdrawn",
            withdrawn_at: new Date().toISOString(),
            withdrawn_by_user_id: userId,
          })
          .eq("id", active.id)
          .eq("organization_id", payload.organizationId);
        if (error) throw error;
        await recordMarketSnapConsentEvent(client, {
          organizationId: payload.organizationId,
          consentId: active.id,
          eventType: "consent_withdrawn",
          actorUserId: userId,
          details: { source: payload.source },
        });
      }
      return NextResponse.json({ ok: true, consentStatus: "withdrawn", deepCaptureEnabled: false });
    }

    const existing = await getActiveMarketSnapCaptureConsent(client, payload.organizationId, userId);
    if (existing && isCurrentDeepCaptureConsent(existing)) {
      return NextResponse.json({ ok: true, ...consentStatusPayload(existing, "active") });
    }
    if (existing) {
      const { error } = await client
        .from("market_snap_capture_consents")
        .update({ status: "superseded", withdrawn_at: new Date().toISOString(), withdrawn_by_user_id: userId })
        .eq("id", existing.id)
        .eq("organization_id", payload.organizationId);
      if (error) throw error;
      await recordMarketSnapConsentEvent(client, {
        organizationId: payload.organizationId,
        consentId: existing.id,
        eventType: "consent_version_superseded",
        actorUserId: userId,
        details: { source: payload.source },
      });
    }

    const scopes = normalizeConsentScopes(payload.captureScopes, payload.modelImprovementOptIn);
    const { data, error } = await client
      .from("market_snap_capture_consents")
      .insert({
        organization_id: payload.organizationId,
        user_id: userId,
        status: "active",
        consent_version: DEEP_CAPTURE_CONSENT_VERSION,
        terms_version: DEEP_CAPTURE_TERMS_VERSION,
        privacy_version: DEEP_CAPTURE_PRIVACY_VERSION,
        capture_scopes: scopes,
        allowed_domains: ["openlane.ca", "openlane.com"],
        allowed_hosts: ["app.openlane.ca", "*.openlane.ca", "*.openlane.com"],
        allowed_data_categories: [
          "visible_vehicle_data",
          "visible_listing_economics",
          "condition_disclosures",
          "media_url_metadata",
          "capped_evidence",
        ],
        source: payload.source,
        extension_installation_id: payload.extensionInstallationId || null,
        accepted_by_user_id: userId,
      })
      .select("*")
      .single();
    if (error) throw error;

    const consent = {
      id: String(data.id),
      organizationId: String(data.organization_id),
      status: "active" as const,
      consentVersion: String(data.consent_version),
      termsVersion: String(data.terms_version),
      privacyVersion: String(data.privacy_version),
      captureScopes: Array.isArray(data.capture_scopes) ? data.capture_scopes as MarketSnapCaptureScope[] : scopes,
      allowedHosts: Array.isArray(data.allowed_hosts) ? data.allowed_hosts.map(String) : [],
      acceptedAt: String(data.accepted_at),
    };

    await recordMarketSnapConsentEvent(client, {
      organizationId: payload.organizationId,
      consentId: consent.id,
      eventType: "consent_created",
      actorUserId: userId,
      details: { source: payload.source, captureScopes: scopes },
    });
    if (payload.modelImprovementOptIn) {
      await recordMarketSnapConsentEvent(client, {
        organizationId: payload.organizationId,
        consentId: consent.id,
        eventType: "model_improvement_enabled",
        actorUserId: userId,
        details: { source: payload.source },
      });
    }

    return NextResponse.json({ ok: true, ...consentStatusPayload(consent, "active") });
  });
}

function assertAllowedMarketSnapOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (allowedExtensionOrigins().includes(origin)) return;
  assertSameOrigin(request);
}

function marketSnapCorsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const headers = new Headers();
  if (origin && allowedExtensionOrigins().includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-allow-headers", "content-type");
    headers.set("vary", "Origin");
  }
  return headers;
}

function allowedExtensionOrigins() {
  return (process.env.MARKET_SNAP_EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function buildDeepCaptureConsentStatus(client: Client, organizationId: string, userId: string) {
  const consent = await getActiveMarketSnapCaptureConsent(client, organizationId, userId);
  const captureSummary = await getDeepCaptureSummary(client, organizationId);
  if (!consent) return { consentStatus: "off", deepCaptureEnabled: false, captureSummary, retentionSummary: deepCaptureRetentionSummary() };
  if (!isCurrentDeepCaptureConsent(consent)) return { ...consentStatusPayload(consent, "requires_renewal"), captureSummary, retentionSummary: deepCaptureRetentionSummary() };
  return { ...consentStatusPayload(consent, "active"), captureSummary, retentionSummary: deepCaptureRetentionSummary() };
}

function consentStatusPayload(
  consent: {
    id: string;
    consentVersion: string;
    termsVersion: string;
    privacyVersion: string;
    captureScopes: MarketSnapCaptureScope[];
    allowedDomains?: string[];
    allowedHosts?: string[];
    allowedDataCategories?: string[];
    deniedDataCategories?: string[];
    acceptedAt: string;
    acceptedByUserId?: string;
  },
  consentStatus: "active" | "requires_renewal",
) {
  return {
    consentStatus,
    deepCaptureEnabled: consentStatus === "active",
    deepCaptureConsentId: consent.id,
    deepCaptureConsentVersion: consent.consentVersion,
    deepCaptureTermsVersion: consent.termsVersion,
    deepCapturePrivacyVersion: consent.privacyVersion,
    deepCaptureConsentAcceptedAt: consent.acceptedAt,
    deepCaptureConsentAcceptedBy: consent.acceptedByUserId,
    captureScopes: consent.captureScopes,
    modelImprovementEnabled: consent.captureScopes.includes("model_improvement"),
    allowedDomains: consent.allowedDomains ?? ["openlane.ca", "openlane.com"],
    allowedHosts: consent.allowedHosts ?? ["app.openlane.ca", "*.openlane.ca", "*.openlane.com"],
    allowedDataCategories: consent.allowedDataCategories ?? [
      "visible_vehicle_data",
      "visible_listing_economics",
      "condition_disclosures",
      "media_url_metadata",
      "capped_evidence",
    ],
    deniedDataCategories: consent.deniedDataCategories ?? [
      "credentials",
      "authorization_headers",
      "cookies",
      "session_tokens",
      "passwords",
      "csrf_tokens",
      "jwt_tokens",
      "unrelated_personal_data",
    ],
  };
}

function isCurrentDeepCaptureConsent(consent: { consentVersion: string; termsVersion: string; privacyVersion: string }) {
  return consent.consentVersion === DEEP_CAPTURE_CONSENT_VERSION
    && consent.termsVersion === DEEP_CAPTURE_TERMS_VERSION
    && consent.privacyVersion === DEEP_CAPTURE_PRIVACY_VERSION;
}

function normalizeConsentScopes(scopes: readonly MarketSnapCaptureScope[] | undefined, modelImprovementOptIn?: boolean) {
  const normalized = new Set<MarketSnapCaptureScope>([
    "dom_visible",
    "safe_read_only_expansion",
    "network_response_observation",
    "fee_outcome_capture",
    "post_sale_outcome_capture",
    "media_url_capture",
  ]);
  for (const scope of scopes ?? []) {
    if (DEEP_CAPTURE_SCOPES.includes(scope)) normalized.add(scope);
  }
  if (!modelImprovementOptIn) normalized.delete("model_improvement");
  return Array.from(normalized);
}

async function listDeepCaptureConsentEvents(client: Client, organizationId: string) {
  const { data, error } = await client
    .from("market_snap_capture_consent_events")
    .select("id, consent_id, event_type, actor_user_id, details, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

async function exportDeepCaptureAudit(client: Client, organizationId: string, userId: string) {
  return {
    exportedAt: new Date().toISOString(),
    exportedByUserId: userId,
    consentStatus: await buildDeepCaptureConsentStatus(client, organizationId, userId),
    events: await listDeepCaptureConsentEvents(client, organizationId),
    captureSummary: await getDeepCaptureSummary(client, organizationId),
    retentionSummary: deepCaptureRetentionSummary(),
  };
}

async function deleteEligibleDeepCaptureData(client: Client, organizationId: string, userId: string) {
  const active = await getActiveMarketSnapCaptureConsent(client, organizationId, userId);
  const [marketListings, observations, outcomes] = await Promise.all([
    client
      .from("market_listings")
      .delete({ count: "exact" })
      .eq("organization_id", organizationId)
      .eq("is_saved_to_deal_radar", false)
      .in("retention_policy", ["temporary_capture", "unsaved_market_listing"]),
    client
      .from("openlane_observations")
      .delete({ count: "exact" })
      .eq("organization_id", organizationId)
      .in("retention_policy", ["temporary_deep_capture", "basic_capture"]),
    client
      .from("openlane_outcomes")
      .update({
        evidence: [],
        field_evidence: {},
        capped_payload: {},
        retention_policy: "sanitized_outcome_metadata",
      }, { count: "exact" })
      .eq("organization_id", organizationId)
      .in("retention_policy", ["temporary_deep_capture", "basic_capture"]),
  ]);
  for (const result of [marketListings, observations, outcomes]) {
    if (result.error) throw result.error;
  }
  const details = {
    action: "delete_eligible_captures",
    marketListingsDeleted: marketListings.count ?? 0,
    openlaneObservationsDeleted: observations.count ?? 0,
    openlaneOutcomesSanitized: outcomes.count ?? 0,
  };
  await recordMarketSnapConsentEvent(client, {
    organizationId,
    consentId: active?.id,
    eventType: "consent_updated",
    actorUserId: userId,
    details,
  });
  return details;
}

async function disableDeepCaptureModelImprovement(client: Client, organizationId: string, userId: string) {
  const active = await getActiveMarketSnapCaptureConsent(client, organizationId, userId);
  if (!active) return { consentStatus: "off", deepCaptureEnabled: false, modelImprovementEnabled: false };

  const nextScopes = active.captureScopes.filter((scope) => scope !== "model_improvement");
  const { error: consentError } = await client
    .from("market_snap_capture_consents")
    .update({ capture_scopes: nextScopes })
    .eq("id", active.id)
    .eq("organization_id", organizationId);
  if (consentError) throw consentError;

  const { error: outcomeError } = await client
    .from("openlane_outcomes")
    .update({ is_training_eligible: false, model_improvement_opted_in: false })
    .eq("organization_id", organizationId)
    .eq("model_improvement_opted_in", true);
  if (outcomeError) throw outcomeError;

  await recordMarketSnapConsentEvent(client, {
    organizationId,
    consentId: active.id,
    eventType: "model_improvement_disabled",
    actorUserId: userId,
    details: { source: "web_app_settings" },
  });

  return {
    ...consentStatusPayload({ ...active, captureScopes: nextScopes }, isCurrentDeepCaptureConsent(active) ? "active" : "requires_renewal"),
    modelImprovementEnabled: false,
  };
}

async function getDeepCaptureSummary(client: Client, organizationId: string) {
  const [observations, outcomes, temporaryListings] = await Promise.all([
    client
      .from("openlane_observations")
      .select("id, page_type, capture_kind, capture_level, source_type, captured_at, retention_policy", { count: "exact" })
      .eq("organization_id", organizationId)
      .order("captured_at", { ascending: false })
      .limit(5),
    client
      .from("openlane_outcomes")
      .select("id, outcome_type, capture_kind, capture_level, source_type, captured_at, retention_policy, is_training_eligible, model_improvement_opted_in", { count: "exact" })
      .eq("organization_id", organizationId)
      .order("captured_at", { ascending: false })
      .limit(5),
    client
      .from("market_listings")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("is_saved_to_deal_radar", false)
      .in("retention_policy", ["temporary_capture", "unsaved_market_listing"]),
  ]);
  for (const result of [observations, outcomes, temporaryListings]) {
    if (result.error) throw result.error;
  }
  return {
    observationCount: observations.count ?? observations.data?.length ?? 0,
    outcomeCount: outcomes.count ?? outcomes.data?.length ?? 0,
    eligibleUnsavedMarketListingCount: temporaryListings.count ?? 0,
    latestObservations: observations.data ?? [],
    latestOutcomes: outcomes.data ?? [],
  };
}

function deepCaptureRetentionSummary() {
  return {
    temporaryCaptures: "Unsaved temporary Market Snap and Deep Capture observations can expire or be deleted when eligible.",
    businessRecords: "Saved Deal Radar listings and verified business outcomes remain according to Dealer Flow business-retention rules.",
    minimizedEvidence: "Dealer Flow stores normalized vehicle fields, capped evidence snippets, endpoint patterns, provenance, and confidence metadata instead of full raw browser responses.",
  };
}

export async function analyzeListing(request: Request) {
  return withMarketSnapAuth(request, "market-snap-analyze", async ({ client, userId, body }) => {
    const listing = marketListingPayloadSchema.parse(body);
    await requireOrganizationRole(client, userId, listing.organizationId, ["owner", "admin", "member"]);
    const comparables = await fetchMarketComparables(client, listing.organizationId, listing);
    const valuation = runComparableEstimator({ organizationId: listing.organizationId, listing, comparables });
    return NextResponse.json({ ok: true, marketListingId: null, valuation });
  });
}

export async function captureListing(request: Request) {
  return withMarketSnapAuth(request, "market-snap-capture-listing", async ({ client, userId, body }) => {
    const listing = marketListingPayloadSchema.parse(body);
    await requireOrganizationRole(client, userId, listing.organizationId, ["owner", "admin", "member"]);
    if (isMarketSnapDeepCapturePayload(listing)) {
      await requireMarketSnapDeepCaptureConsent(
        client,
        listing.organizationId,
        userId,
        requiredDeepCaptureScopes(listing),
        listing.deepCaptureConsentId,
      );
    }
    const captureStorage = await persistOpenLaneCapture(client, listing, userId);
    return NextResponse.json({ ok: true, captureStorage });
  });
}

export async function saveListing(request: Request) {
  return withMarketSnapAuth(request, "market-snap-save-listing", async ({ client, userId, body }) => {
    const payload = saveListingSchema.parse(body);
    await requireOrganizationRole(client, userId, payload.organizationId, ["owner", "admin", "member"]);
    const listing: MarketListingInput = { ...payload.listing, organizationId: payload.organizationId };
    if (isMarketSnapDeepCapturePayload(listing)) {
      await requireMarketSnapDeepCaptureConsent(
        client,
        payload.organizationId,
        userId,
        requiredDeepCaptureScopes(listing),
        listing.deepCaptureConsentId,
      );
    }
    const comparables = await fetchMarketComparables(client, payload.organizationId, listing);
    const valuation = runComparableEstimator({ organizationId: payload.organizationId, listing, comparables });
    const marketListingId = await upsertMarketListingFromAnalysis(client, listing, valuation);
    const id = await saveListingToDealRadar(client, listing, valuation);
    return NextResponse.json({ ok: true, id, marketListingId, valuation });
  });
}

export async function listDealRadar(request: Request) {
  try {
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const query = dealRadarQuerySchema.parse(Object.fromEntries(params.entries()));
    await requireOrganizationRole(client, userData.user.id, query.organizationId, ["owner", "admin", "member", "accountant", "viewer"]);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const { items, count } = await getDealRadarListings(client, query.organizationId, page, pageSize);
    return NextResponse.json({ ok: true, items, count, page, pageSize });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function deleteDealRadarListing(request: Request, id: string) {
  return withMarketSnapAuth(request, "market-snap-delete-listing", async ({ client, userId, body }) => {
    const payload = dealRadarQuerySchema.pick({ organizationId: true }).parse(body);
    await requireOrganizationRole(client, userId, payload.organizationId, ["owner", "admin", "member"]);
    await removeDealRadarListing(client, payload.organizationId, id);
    return NextResponse.json({ ok: true });
  });
}

export async function convertDealRadarToInventory(request: Request, id: string) {
  return withMarketSnapAuth(request, "market-snap-convert-listing", async ({ client, userId, body }) => {
    const payload = dealRadarQuerySchema.pick({ organizationId: true }).parse(body);
    await requireOrganizationRole(client, userId, payload.organizationId, ["owner", "admin", "member"]);
    const { data, error } = await client
      .from("deal_radar_saved_listings")
      .select("*")
      .eq("id", id)
      .eq("organization_id", payload.organizationId)
      .single();
    if (error) throw error;
    const prefill = convertDealRadarListingToInventory(data as Record<string, unknown>);
    return NextResponse.json({ ok: true, prefill });
  });
}

export async function runVehicleValuationRoute(request: Request, vehicleId: string) {
  return withMarketSnapAuth(request, "market-snap-run-valuation", async ({ client, userId, body }) => {
    const payload = valuationRequestSchema.parse({ ...(body as object), vehicleId });
    await requireOrganizationRole(client, userId, payload.organizationId, ["owner", "admin", "member"]);
    const vehicle = await readVehicle(client, payload.organizationId, vehicleId);
    const expenses = await readVehicleExpenses(client, payload.organizationId, vehicleId);
    const comparables = await fetchMarketComparables(client, payload.organizationId, vehicle);
    const valuation = runComparableEstimator({ organizationId: payload.organizationId, vehicle, expenses, comparables });
    const id = await saveVehicleValuation(client, valuation);
    return NextResponse.json({ ok: true, id, valuation });
  });
}

export async function latestVehicleValuation(request: Request, vehicleId: string) {
  return listVehicleValuations(request, vehicleId, 1);
}

export async function listVehicleValuations(request: Request, vehicleId: string, limit = 25) {
  try {
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
    await requireOrganizationRole(client, userData.user.id, organizationId, ["owner", "admin", "member", "accountant", "viewer"]);
    const { data, error } = await client
      .from("vehicle_valuations")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("vehicle_id", vehicleId)
      .order("valuation_date", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return NextResponse.json({ ok: true, valuations: data ?? [], valuation: data?.[0] ?? null });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function refreshActiveInventory(request: Request) {
  return withMarketSnapAuth(request, "market-snap-refresh-inventory", async ({ client, userId, body }) => {
    const payload = dealRadarQuerySchema.pick({ organizationId: true }).parse(body);
    await requireOrganizationRole(client, userId, payload.organizationId, ["owner", "admin"]);
    const { data, error } = await client
      .from("vehicles")
      .select("*")
      .eq("organization_id", payload.organizationId)
      .in("status", ["purchased", "in_repair", "listed_for_sale"]);
    if (error) throw error;
    const vehicles = (data ?? []).map((row) => mapVehicle(row as Record<string, unknown>)).filter(shouldRefreshVehicle);
    const valuations = [];
    for (const vehicle of vehicles.slice(0, 50)) {
      const expenses = await readVehicleExpenses(client, payload.organizationId, vehicle.id);
      const comparables = await fetchMarketComparables(client, payload.organizationId, vehicle);
      const valuation = runComparableEstimator({ organizationId: payload.organizationId, vehicle, expenses, comparables });
      const id = await saveVehicleValuation(client, valuation);
      valuations.push({ id, vehicleId: vehicle.id, recommendationBadge: valuation.recommendationBadge });
    }
    return NextResponse.json({ ok: true, refreshed: valuations.length, skippedSoldVehicles: true, valuations });
  });
}

export async function dashboard(request: Request) {
  try {
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
    await requireOrganizationRole(client, userData.user.id, organizationId, ["owner", "admin", "member", "accountant", "viewer"]);
    const { data, error } = await client.from("vehicle_valuations").select("*").eq("organization_id", organizationId).order("valuation_date", { ascending: false }).limit(500);
    if (error) throw error;
    const latestByVehicle = new Map<string, Record<string, unknown>>();
    for (const row of data ?? []) {
      const vehicleId = String(row.vehicle_id ?? "");
      if (vehicleId && !latestByVehicle.has(vehicleId)) latestByVehicle.set(vehicleId, row as Record<string, unknown>);
    }
    const valuations = Array.from(latestByVehicle.values());
    type DashboardSummary = {
      totalEstimatedRetailValue: number;
      totalCostBasis: number;
      potentialGrossProfit: number;
      averageDealScore: number;
      averageProfitScore: number;
      averageRiskScore: number;
      lowConfidenceValuations: number;
      highRiskVehicles: number;
    };
    const initialSummary: DashboardSummary = {
      totalEstimatedRetailValue: 0,
      totalCostBasis: 0,
      potentialGrossProfit: 0,
      averageDealScore: 0,
      averageProfitScore: 0,
      averageRiskScore: 0,
      lowConfidenceValuations: 0,
      highRiskVehicles: 0,
    };
    const summary = valuations.reduce<DashboardSummary>((acc, row) => ({
      totalEstimatedRetailValue: acc.totalEstimatedRetailValue + Number(row.estimated_retail_market_value ?? 0),
      totalCostBasis: acc.totalCostBasis + Number(row.current_cost_basis ?? 0),
      potentialGrossProfit: acc.potentialGrossProfit + Number(row.potential_gross_profit ?? 0),
      averageDealScore: acc.averageDealScore + Number(row.deal_score ?? 0),
      averageProfitScore: acc.averageProfitScore + Number(row.profit_score ?? 0),
      averageRiskScore: acc.averageRiskScore + Number(row.risk_score ?? 0),
      lowConfidenceValuations: acc.lowConfidenceValuations + (Number(row.confidence_score ?? 0) < 45 ? 1 : 0),
      highRiskVehicles: acc.highRiskVehicles + (Number(row.risk_score ?? 0) >= 70 ? 1 : 0),
    }), initialSummary);
    const count = valuations.length || 1;
    return NextResponse.json({
      ok: true,
      summary: {
        ...summary,
        averageDealScore: Math.round(summary.averageDealScore / count),
        averageProfitScore: Math.round(summary.averageProfitScore / count),
        averageRiskScore: Math.round(summary.averageRiskScore / count),
      },
      valuations,
    });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function averageBuySellChart(request: Request) {
  try {
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
    await requireOrganizationRole(client, userData.user.id, organizationId, ["owner", "admin", "member", "accountant", "viewer"]);
    const { data, error } = await client
      .from("sales")
      .select("sale_date, paper_sale_price, vehicle_total_cost, accounting_model_version, sale_price_before_tax, company_cost_basis")
      .eq("organization_id", organizationId)
      .is("voided_at", null)
      .eq("status", "active");
    if (error) throw error;
    const months = buildLastTwelveMonths();
    for (const sale of data ?? []) {
      const month = String(sale.sale_date ?? "").slice(0, 7);
      const row = months.find((item) => item.month === month);
      if (!row) continue;
      row.buyTotal += Number(sale.accounting_model_version === 2 ? sale.company_cost_basis ?? sale.vehicle_total_cost ?? 0 : sale.vehicle_total_cost ?? 0);
      row.sellTotal += Number(sale.accounting_model_version === 2 ? sale.sale_price_before_tax ?? sale.paper_sale_price ?? 0 : sale.paper_sale_price ?? 0);
      row.count += 1;
    }
    return NextResponse.json({
      ok: true,
      data: months.map((row) => ({
        month: row.month,
        averageBuyPrice: row.count ? Math.round(row.buyTotal / row.count) : 0,
        averageSellPrice: row.count ? Math.round(row.sellTotal / row.count) : 0,
      })),
    });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function adminList(request: Request, table: "market_sources" | "market_data_jobs") {
  try {
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
    await requireOrganizationRole(client, userData.user.id, organizationId, ["owner", "admin"]);
    const { data, error } = await client.from(table).select("*").or(`organization_id.eq.${organizationId},organization_id.is.null`).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function dataQuality(request: Request) {
  try {
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
    await requireOrganizationRole(client, userData.user.id, organizationId, ["owner", "admin"]);
    const [marketListings, identities, observations, outcomes] = await Promise.all([
      client
        .from("market_listings")
        .select("source_name, listing_url, vin, mileage_km, listed_price, trim, data_quality_score, captured_at, image_features, carfax_url, carfax_available, extraction_confidence_score, openlane_metadata, normalized_payload, sanitized_raw_payload")
        .or(`organization_id.eq.${organizationId},organization_id.is.null`)
        .limit(1000),
      client
        .from("openlane_vehicle_identities")
        .select("vin, fallback_key, identity_confidence")
        .eq("organization_id", organizationId)
        .limit(5000),
      client
        .from("openlane_observations")
        .select("id, data_quality_score, evidence_confidence_score")
        .eq("organization_id", organizationId)
        .limit(5000),
      client
        .from("openlane_outcomes")
        .select("capture_kind, outcome_type, is_training_eligible, data_quality_score, evidence_confidence_score")
        .eq("organization_id", organizationId)
        .limit(5000),
    ]);
    for (const result of [marketListings, identities, observations, outcomes]) {
      if (result.error) throw result.error;
    }
    const rows = marketListings.data ?? [];
    const identityRows = identities.data ?? [];
    const observationRows = observations.data ?? [];
    const outcomeRows = outcomes.data ?? [];
    const openLaneRows = rows.filter(isOpenLaneQualityRow);
    const uniqueKeys = new Set(rows.map((row) => String(row.listing_url ?? "")).filter(Boolean));
    const imageUsable = rows.filter((row) => {
      const features = row.image_features as Record<string, unknown> | null;
      return Number(features?.imageCount ?? 0) > 0 || Number(features?.photoQualityScore ?? 0) > 0;
    }).length;
    const freshnessDays = rows
      .map((row) => row.captured_at ? Math.max(0, Math.round((Date.now() - new Date(String(row.captured_at)).getTime()) / 86_400_000)) : 999)
      .filter(Number.isFinite);
    const validVinCount = openLaneRows.filter((row) => isValidOpenLaneVin(row.vin)).length;
    const missingVinCount = openLaneRows.filter((row) => !stringMetric(row.vin)).length;
    const invalidVinCount = openLaneRows.filter((row) => stringMetric(row.vin) && !isValidOpenLaneVin(row.vin)).length;
    const carfaxStatuses = openLaneRows.map(openLaneCarfaxStatus);
    const identityKeys = identityRows.map((row) => stringMetric(row.vin) || stringMetric(row.fallback_key)).filter(Boolean);
    const duplicateIdentityCount = duplicateKeyCount(identityKeys);
    const dataQualityValues = [
      ...rows.map((row) => numberMetric(row.data_quality_score)),
      ...observationRows.map((row) => numberMetric(row.data_quality_score)),
      ...outcomeRows.map((row) => numberMetric(row.data_quality_score)),
    ].filter((value): value is number => value !== undefined);
    const extractionConfidenceValues = [
      ...openLaneRows.map((row) => numberMetric(row.extraction_confidence_score)),
      ...observationRows.map((row) => numberMetric(row.evidence_confidence_score)),
      ...outcomeRows.map((row) => numberMetric(row.evidence_confidence_score)),
    ].filter((value): value is number => value !== undefined);
    return NextResponse.json({
      ok: true,
      metrics: {
        totalListings: rows.length,
        sourceCounts: rows.reduce<Record<string, number>>((acc, row) => {
          const sourceName = String((row as Record<string, unknown>).source_name ?? "Unknown");
          acc[sourceName] = (acc[sourceName] ?? 0) + 1;
          return acc;
        }, {}),
        validListings: rows.filter((row) => row.mileage_km !== null && row.listed_price !== null).length,
        invalidListings: rows.filter((row) => row.mileage_km === null || row.listed_price === null).length,
        duplicateListings: Math.max(0, rows.filter((row) => row.listing_url).length - uniqueKeys.size),
        missingMileageCount: rows.filter((row) => row.mileage_km === null).length,
        missingPriceCount: rows.filter((row) => row.listed_price === null).length,
        missingTrimCount: rows.filter((row) => !row.trim).length,
        usablePhotoFeatureCount: imageUsable,
        openLaneListingCount: openLaneRows.length,
        vinCoverageRate: ratioPercent(validVinCount, openLaneRows.length),
        missingVinCount,
        invalidVinCount,
        carfaxUrlFoundCount: carfaxStatuses.filter((status) => status === "url_found").length,
        carfaxTextOnlyCount: carfaxStatuses.filter((status) => status === "text_only").length,
        carfaxMissingCount: carfaxStatuses.filter((status) => status === "missing").length,
        duplicateIdentityRate: ratioPercent(duplicateIdentityCount, identityRows.length),
        trainingEligibleOutcomeCount: outcomeRows.filter((row) => row.is_training_eligible === true).length,
        candidateOutcomeCount: outcomeRows.filter((row) => row.capture_kind === "candidate_outcome" || String(row.outcome_type ?? "").includes("candidate")).length,
        verifiedOutcomeCount: outcomeRows.filter((row) => row.capture_kind === "verified_outcome" || row.capture_kind === "manual_confirmation").length,
        observationCount: observationRows.length,
        averageExtractionConfidence: averageMetric(extractionConfidenceValues),
        averageDataQualityScore: averageMetric(dataQualityValues),
        averageDataQuality: rows.length ? Math.round(rows.reduce((sum, row) => sum + Number(row.data_quality_score ?? 0), 0) / rows.length) : 0,
        averageConfidence: averageMetric(extractionConfidenceValues) || (rows.length ? Math.round(rows.reduce((sum, row) => sum + Number(row.data_quality_score ?? 0), 0) / rows.length) : 0),
        averageDataFreshness: freshnessDays.length ? Math.round(freshnessDays.reduce((sum, value) => sum + value, 0) / freshnessDays.length) : 0,
      },
    });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function calibrationReport(request: Request) {
  return withMarketSnapAuth(request, "market-snap-calibration-report", async ({ client, userId }) => {
    const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
    const payload = dealRadarQuerySchema.pick({ organizationId: true }).parse({ organizationId });
    await requireOrganizationRole(client, userId, payload.organizationId, ["owner", "admin"]);
    const { data, error } = await client.rpc("market_snap_calibration_report", {
      p_organization_id: payload.organizationId,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, report: data ?? emptyCalibrationReport() });
  });
}

const OPENLANE_VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;

function isOpenLaneQualityRow(row: Record<string, unknown>) {
  const sourceName = String(row.source_name ?? "").toLowerCase();
  if (sourceName.includes("openlane")) return true;
  if (objectMetric(row.openlane_metadata) && Object.keys(objectMetric(row.openlane_metadata)).length > 0) return true;
  const normalized = objectMetric(row.normalized_payload);
  return String(normalized.sourceName ?? normalized.source_name ?? "").toLowerCase().includes("openlane")
    || Boolean(normalized.pageType || normalized.captureKind || normalized.openlaneMetadata);
}

function isValidOpenLaneVin(value: unknown) {
  return OPENLANE_VIN_PATTERN.test(stringMetric(value).toUpperCase());
}

function openLaneCarfaxStatus(row: Record<string, unknown>) {
  if (stringMetric(row.carfax_url)) return "url_found";
  const metadata = objectMetric(row.openlane_metadata);
  const normalized = objectMetric(row.normalized_payload);
  const normalizedMetadata = objectMetric(normalized.openlaneMetadata);
  const rawPayload = objectMetric(row.sanitized_raw_payload);
  const rawMetadata = objectMetric(rawPayload.openlaneMetadata);
  const statuses = [
    metadata.carfaxUrlStatus,
    normalized.carfaxUrlStatus,
    normalizedMetadata.carfaxUrlStatus,
    rawPayload.carfaxUrlStatus,
    rawMetadata.carfaxUrlStatus,
  ].map((value) => stringMetric(value).toLowerCase());
  if (statuses.includes("url_found")) return "url_found";
  if (statuses.includes("text_only") || row.carfax_available === true) return "text_only";
  return "missing";
}

function duplicateKeyCount(keys: string[]) {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return Array.from(counts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

function ratioPercent(count: number, total: number) {
  return total ? Math.round((count / total) * 100) : 0;
}

function averageMetric(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function numberMetric(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringMetric(value: unknown) {
  return String(value ?? "").trim();
}

function objectMetric(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function emptyCalibrationReport() {
  return {
    outcomeCount: 0,
    averageError: 0,
    medianError: 0,
    averagePercentageError: 0,
    errorByMakeModel: [],
    errorBySource: [],
    confidenceVsError: [],
  };
}

export async function importListings(request: Request, importType: "csv" | "json") {
  return withMarketSnapAuth(request, `market-snap-import-${importType}`, async ({ client, userId, body }) => {
    const payload = importPayloadSchema.parse(body);
    await requireOrganizationRole(client, userId, payload.organizationId, ["owner", "admin"]);
    const rows = payload.rows.map((row) => ({ ...row, organizationId: payload.organizationId, sourceName: row.sourceName || payload.sourceName }));
    const inserted = await insertMarketListings(client, rows);
    const { error } = await client.from("market_import_jobs").insert({
      organization_id: payload.organizationId,
      source_name: payload.sourceName,
      import_type: importType,
      status: "succeeded",
      total_rows: rows.length,
      valid_rows: rows.length,
      invalid_rows: 0,
      completed_at: new Date().toISOString(),
      created_by: userId,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, imported: inserted.inserted });
  });
}

export async function trainCandidate(request: Request) {
  return withMarketSnapAuth(request, "market-snap-train-candidate", async ({ client, userId, body }) => {
    const payload = dealRadarQuerySchema.pick({ organizationId: true }).parse(body);
    await requireOrganizationRole(client, userId, payload.organizationId, ["owner", "admin"]);
    const { data, error } = await client.from("ml_training_runs").insert({
      organization_id: payload.organizationId,
      status: "pending",
      metrics: { queued_from: "admin_market_data_page", model: "CatBoostRegressor" },
      created_by: userId,
    }).select("id").single();
    if (error) throw error;
    return NextResponse.json({ ok: true, trainingRunId: data.id, status: "pending" });
  });
}

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return request.json();
  if (request.method === "GET" || request.method === "HEAD") return {};
  return Object.fromEntries((await request.formData()).entries());
}

async function readVehicle(client: Client, organizationId: string, vehicleId: string): Promise<Vehicle> {
  const { data, error } = await client.from("vehicles").select("*").eq("organization_id", organizationId).eq("id", vehicleId).single();
  if (error) throw error;
  return mapVehicle(data as Record<string, unknown>);
}

async function readVehicleExpenses(client: Client, organizationId: string, vehicleId: string): Promise<VehicleExpense[]> {
  const { data, error } = await client.from("vehicle_expenses").select("*").eq("organization_id", organizationId).eq("vehicle_id", vehicleId);
  if (error) throw error;
  return (data ?? []).map((row) => mapExpense(row as Record<string, unknown>));
}

function buildLastTwelveMonths() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1);
    return { month: date.toISOString().slice(0, 7), buyTotal: 0, sellTotal: 0, count: 0 };
  });
}
