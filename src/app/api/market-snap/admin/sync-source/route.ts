import { NextResponse } from "next/server";
import { runAdminSourceSync, type SupportedSyncSource } from "@/lib/market-snap/source-sync";
import { requireOrganizationRole } from "@/lib/server/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dealRadarQuerySchema } from "@/lib/market-snap/validation";
import { routeErrorResponse } from "@/lib/server/security";

export async function POST(request: Request) {
  try {
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const payload = dealRadarQuerySchema.pick({ organizationId: true }).parse(body);
    const source = String((body as Record<string, unknown>).source ?? "");
    if (source !== "openlane" && source !== "marketplace") {
      return NextResponse.json({ ok: false, message: "Unsupported source." }, { status: 400 });
    }
    await requireOrganizationRole(client, data.user.id, payload.organizationId, ["owner", "admin"]);
    const summary = await runAdminSourceSync(source as SupportedSyncSource);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
