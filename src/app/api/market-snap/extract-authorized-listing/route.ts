import { NextResponse } from "next/server";
import { authorizedExtractionRequestSchema } from "@/lib/market-snap/validation";
import { extractAuthorizedListing } from "@/lib/server/market-snap-extraction";
import { assertSameOrigin, checkRateLimit, requireOrganizationRole, routeErrorResponse } from "@/lib/server/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const headers = extractionCorsHeaders(request);
  try {
    assertAllowedExtractionOrigin(request);
    checkRateLimit(request, "market-snap-extract-authorized-listing", { limit: 30, windowMs: 60_000 });
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503, headers });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401, headers });
    checkRateLimit(request, "market-snap-extract-authorized-listing-user", { limit: 20, windowMs: 60_000, userId: data.user.id });
    const payload = authorizedExtractionRequestSchema.parse(await request.json());
    await requireOrganizationRole(client, data.user.id, payload.organizationId, ["owner", "admin", "member"]);
    const extraction = await extractAuthorizedListing(payload);
    return NextResponse.json(extraction, { status: extraction.ok ? 200 : 502, headers });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers });
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: extractionCorsHeaders(request) });
}

function assertAllowedExtractionOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const extensionOrigins = (process.env.MARKET_SNAP_EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (extensionOrigins.includes(origin)) return;
  assertSameOrigin(request);
}

function extractionCorsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const headers = new Headers();
  const extensionOrigins = (process.env.MARKET_SNAP_EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && extensionOrigins.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-allow-headers", "content-type");
    headers.set("vary", "Origin");
  }
  return headers;
}
