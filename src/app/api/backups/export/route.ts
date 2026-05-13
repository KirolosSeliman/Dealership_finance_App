import { NextResponse } from "next/server";
import { generateBackupExport } from "@/lib/backup/export";
import { assertSameOrigin, checkRateLimit, requireOrganizationRole, routeErrorResponse } from "@/lib/server/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadAppData } from "@/lib/supabase/repository";
import { backupRequestSchema, formatValidationError } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await checkRateLimit(request, "backup-export", { limit: 10, windowMs: 60_000 });

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    }
    await checkRateLimit(request, "backup-export-user", { limit: 5, windowMs: 60_000, userId: userData.user.id });

    const body = backupRequestSchema.parse(await request.json());
    await requireOrganizationRole(supabase, userData.user.id, body.organizationId, ["owner", "admin"]);

    const appData = await loadAppData(supabase, userData.user, body.organizationId);
    const backup = await generateBackupExport(appData);
    const buffer = Buffer.from(await backup.arrayBuffer());
    const fileName = `dealer-flow-backup-${new Date().toISOString().slice(0, 10)}-${Date.now()}.zip`;

    await supabase.from("activity_logs").insert({
      organization_id: body.organizationId,
      action: "backup_generated",
      entity_type: "backup",
      message: "Local full backup generated.",
      created_by: userData.user.id,
    });

    return new Response(buffer, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json({ ...response.body, message: formatValidationError(error) }, { status: response.status });
  }
}
