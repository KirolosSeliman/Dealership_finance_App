import { NextResponse } from "next/server";
import { generateTaxReportExport } from "@/lib/backup/export";
import { assertSameOrigin, checkRateLimit, requireOrganizationRole, routeErrorResponse } from "@/lib/server/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadAppData } from "@/lib/supabase/repository";
import { formatValidationError, taxExportSchema } from "@/lib/validation";

const contentTypes = {
  pdf: "application/pdf",
  csv: "text/csv",
  json: "application/json",
};

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await checkRateLimit(request, "tax-export", { limit: 20, windowMs: 60_000 });

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    }
    await checkRateLimit(request, "tax-export-user", { limit: 10, windowMs: 60_000, userId: userData.user.id });

    const body = taxExportSchema.parse(await request.json());
    await requireOrganizationRole(supabase, userData.user.id, body.organizationId, ["owner", "admin", "accountant"]);
    const appData = await loadAppData(supabase, userData.user, body.organizationId);
    const exportBlob = await generateTaxReportExport(appData, body);
    const buffer = Buffer.from(await exportBlob.arrayBuffer());
    const fileName = `dealer-flow-tax-report-${body.startDate || "all"}-${body.endDate || "all"}.${body.format}`;

    await supabase.from("activity_logs").insert({
      organization_id: body.organizationId,
      action: "tax_report_generated",
      entity_type: "tax_report",
      message: `Tax report exported as ${body.format.toUpperCase()}.`,
      created_by: userData.user.id,
    });

    return new Response(buffer, {
      headers: {
        "content-type": contentTypes[body.format],
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json({ ...response.body, message: formatValidationError(error) }, { status: response.status });
  }
}
