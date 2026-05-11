import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { runComparableEstimator, shouldStoreValuationSnapshot } from "@/lib/market-snap/engine";
import { fetchMarketComparables, saveVehicleValuation } from "@/lib/market-snap/repository";
import { checkRateLimit, routeErrorResponse } from "@/lib/server/security";
import { mapExpense, mapVehicle } from "@/lib/supabase/mappers";
import type { VehicleValuation } from "@/types/market-snap";

export async function GET(request: Request) {
  try {
    checkRateLimit(request, "market-snap-daily-refresh", { limit: 5, windowMs: 60_000 });
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret?.trim()) return NextResponse.json({ ok: false, message: "CRON_SECRET is required." }, { status: 503 });
    if (!hasValidBearerSecret(request.headers.get("authorization"), cronSecret)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((key) => !process.env[key]);
    if (missing.length > 0) return NextResponse.json({ ok: false, message: "Supabase service credentials are not configured.", missing }, { status: 503 });

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select("*")
      .in("status", ["purchased", "in_repair", "listed_for_sale"])
      .limit(500);
    if (error) throw error;

    let refreshed = 0;
    let skippedDuplicateSnapshots = 0;
    for (const row of vehicles ?? []) {
      const vehicle = mapVehicle(row as Record<string, unknown>);
      const { data: expenses, error: expenseError } = await supabase
        .from("vehicle_expenses")
        .select("*")
        .eq("organization_id", vehicle.organizationId)
        .eq("vehicle_id", vehicle.id);
      if (expenseError) throw expenseError;
      const comparables = await fetchMarketComparables(supabase, vehicle.organizationId, vehicle);
      const valuation = runComparableEstimator({
        organizationId: vehicle.organizationId,
        vehicle,
        expenses: (expenses ?? []).map((expense) => mapExpense(expense as Record<string, unknown>)),
        comparables,
      });
      const previous = await latestValuation(supabase, vehicle.organizationId, vehicle.id);
      if (!shouldStoreValuationSnapshot(previous, valuation)) {
        skippedDuplicateSnapshots += 1;
        continue;
      }
      await saveVehicleValuation(supabase, valuation);
      refreshed += 1;
    }

    return NextResponse.json({ ok: true, refreshed, skippedSoldVehicles: true, skippedDuplicateSnapshots });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

async function latestValuation(client: SupabaseClient, organizationId: string, vehicleId: string): Promise<VehicleValuation | undefined> {
  const { data, error } = await client
    .from("vehicle_valuations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("vehicle_id", vehicleId)
    .order("valuation_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  return {
    organizationId,
    vehicleId,
    marketType: String(data.market_type) as never,
    estimatedRetailMarketValue: Number(data.estimated_retail_market_value ?? 0),
    estimatedWholesaleBuyValue: Number(data.estimated_wholesale_buy_value ?? 0),
    estimatedWholesaleSellValue: Number(data.estimated_wholesale_sell_value ?? 0),
    suggestedListingPrice: Number(data.suggested_listing_price ?? 0),
    quickSalePrice: Number(data.quick_sale_price ?? 0),
    maxRecommendedPurchasePrice: Number(data.max_recommended_purchase_price ?? 0),
    maxRecommendedBid: Number(data.max_recommended_bid ?? 0),
    estimatedTotalAcquisitionCost: Number(data.estimated_total_acquisition_cost ?? 0),
    currentCostBasis: Number(data.current_cost_basis ?? 0),
    potentialGrossProfit: Number(data.potential_gross_profit ?? 0),
    potentialNetProfit: Number(data.potential_net_profit ?? 0),
    estimatedReconditioningCost: Number(data.estimated_reconditioning_cost ?? 0),
    estimatedTaxAmount: Number(data.estimated_tax_amount ?? 0),
    estimatedHiddenFees: Number(data.estimated_hidden_fees ?? 0),
    estimatedTransportCost: Number(data.estimated_transport_cost ?? 0),
    estimatedAuctionFees: Number(data.estimated_auction_fees ?? 0),
    estimatedInspectionCost: Number(data.estimated_inspection_cost ?? 0),
    comparableCount: Number(data.comparable_count ?? 0),
    dataFreshnessDays: Number(data.data_freshness_days ?? 999),
    confidenceScore: Number(data.confidence_score ?? 0),
    dealScore: Number(data.deal_score ?? 0),
    profitScore: Number(data.profit_score ?? 0),
    riskScore: Number(data.risk_score ?? 0),
    marketTrend: String(data.market_trend ?? "unknown") as never,
    recommendationBadge: String(data.recommendation_badge ?? "Negotiate") as never,
    explanation: String(data.explanation ?? ""),
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    missingData: Array.isArray(data.missing_data) ? data.missing_data : [],
    modelVersion: String(data.model_version ?? ""),
    estimatorType: String(data.estimator_type ?? "comparable_estimator") as never,
    valuationDate: String(data.valuation_date ?? new Date().toISOString()),
  };
}

function hasValidBearerSecret(authHeader: string | null, secret: string) {
  const prefix = "Bearer ";
  if (!authHeader?.startsWith(prefix)) return false;
  const providedBuffer = Buffer.from(authHeader.slice(prefix.length));
  const secretBuffer = Buffer.from(secret);
  return providedBuffer.length === secretBuffer.length && timingSafeEqual(providedBuffer, secretBuffer);
}
