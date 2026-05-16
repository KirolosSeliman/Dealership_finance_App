import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSameOrigin, checkRateLimit, requireOrganizationRole, routeErrorResponse } from "@/lib/server/security";
import { isMarketSnapDeepCapturePayload, requiredDeepCaptureScopes, requireMarketSnapDeepCaptureConsent } from "@/lib/server/market-snap-consent";
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
import { dealRadarQuerySchema, importPayloadSchema, marketListingPayloadSchema, saveListingSchema, valuationRequestSchema } from "@/lib/market-snap/validation";
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
      .select("sale_date, paper_sale_price, vehicle_total_cost")
      .eq("organization_id", organizationId)
      .is("voided_at", null)
      .eq("status", "active");
    if (error) throw error;
    const months = buildLastTwelveMonths();
    for (const sale of data ?? []) {
      const month = String(sale.sale_date ?? "").slice(0, 7);
      const row = months.find((item) => item.month === month);
      if (!row) continue;
      row.buyTotal += Number(sale.vehicle_total_cost ?? 0);
      row.sellTotal += Number(sale.paper_sale_price ?? 0);
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
    const { data, error } = await client
      .from("market_listings")
      .select("source_name, listing_url, mileage_km, listed_price, trim, data_quality_score, captured_at, image_features")
      .or(`organization_id.eq.${organizationId},organization_id.is.null`)
      .limit(1000);
    if (error) throw error;
    const rows = data ?? [];
    const uniqueKeys = new Set(rows.map((row) => String(row.listing_url ?? "")).filter(Boolean));
    const imageUsable = rows.filter((row) => {
      const features = row.image_features as Record<string, unknown> | null;
      return Number(features?.imageCount ?? 0) > 0 || Number(features?.photoQualityScore ?? 0) > 0;
    }).length;
    const freshnessDays = rows
      .map((row) => row.captured_at ? Math.max(0, Math.round((Date.now() - new Date(String(row.captured_at)).getTime()) / 86_400_000)) : 999)
      .filter(Number.isFinite);
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
        averageDataQuality: rows.length ? Math.round(rows.reduce((sum, row) => sum + Number(row.data_quality_score ?? 0), 0) / rows.length) : 0,
        averageConfidence: rows.length ? Math.round(rows.reduce((sum, row) => sum + Number(row.data_quality_score ?? 0), 0) / rows.length) : 0,
        averageDataFreshness: freshnessDays.length ? Math.round(freshnessDays.reduce((sum, value) => sum + value, 0) / freshnessDays.length) : 0,
      },
    });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
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
