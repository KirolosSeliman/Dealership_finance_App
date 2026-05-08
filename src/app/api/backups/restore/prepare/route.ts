import { NextResponse } from "next/server";
import JSZip from "jszip";
import { MAX_BACKUP_VERIFY_BYTES } from "@/lib/security";
import { restoreBackupDryRun } from "@/lib/backup/export";
import { assertSameOrigin, checkRateLimit, requireOrganizationRole, routeErrorResponse } from "@/lib/server/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AppData } from "@/types/domain";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    checkRateLimit(request, "restore-prepare", { limit: 6, windowMs: 60_000 });

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    }
    checkRateLimit(request, "restore-prepare-user", { limit: 3, windowMs: 60_000, userId: userData.user.id });

    const formData = await request.formData();
    const organizationId = String(formData.get("organizationId") || "");
    const file = formData.get("file");
    if (!organizationId) {
      return NextResponse.json({ ok: false, message: "Organization is required." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "Backup ZIP file is required." }, { status: 400 });
    }
    if (file.size > MAX_BACKUP_VERIFY_BYTES) {
      return NextResponse.json({ ok: false, message: "Backup ZIP is larger than the restore preparation limit." }, { status: 400 });
    }

    await requireOrganizationRole(supabase, userData.user.id, organizationId, ["owner"]);
    const result = await restoreBackupDryRun(file);
    const existingIdConflicts = result.ok ? await findExistingIdConflicts(supabase, organizationId, file) : [];
    const organizationMismatch =
      result.summary?.organizationId && result.summary.organizationId !== organizationId
        ? [`Backup organization ${result.summary.organizationId} does not match selected organization ${organizationId}.`]
        : [];
    const conflicts = [...result.conflicts, ...organizationMismatch, ...existingIdConflicts];
    const ok = result.ok && conflicts.length === 0;

    const { data: job } = await supabase.from("backup_jobs").insert({
      organization_id: organizationId,
      destination: "restore_prepare",
      status: ok ? "pending" : "failed",
      created_by: userData.user.id,
    }).select("id").maybeSingle();

    await supabase.from("activity_logs").insert({
      organization_id: organizationId,
      action: "restore_dry_run_executed",
      entity_type: "backup_job",
      entity_id: job?.id,
      message: ok ? "Restore preparation validated a backup ZIP." : "Restore preparation rejected a backup ZIP.",
      created_by: userData.user.id,
    });

    return NextResponse.json({
      ok,
      jobId: job?.id,
      summary: result.summary,
      verification: result.verification,
      conflicts,
      message: ok
        ? "Restore preparation created a pending restore job. No business data was written."
        : "Restore preparation found conflicts. No business data was written.",
    }, { status: ok ? 200 : 400 });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

async function findExistingIdConflicts(
  client: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  organizationId: string,
  file: File,
) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const fullBackup = JSON.parse(await zip.file("full-backup.json")!.async("text")) as AppData;
  const checks: Array<[string, string, string[]]> = [
    ["vehicles", "Vehicle", fullBackup.vehicles.map((row) => row.id)],
    ["vehicle_expenses", "Expense", fullBackup.expenses.map((row) => row.id)],
    ["sales", "Sale", fullBackup.sales.map((row) => row.id)],
    ["company_cash_transactions", "Company cash transaction", fullBackup.companyCashTransactions.map((row) => row.id)],
    ["external_cash_transactions", "External cash transaction", fullBackup.externalCashTransactions.map((row) => row.id)],
    ["contacts", "Contact", fullBackup.contacts.map((row) => row.id)],
    ["attachments", "Attachment", fullBackup.attachments.map((row) => row.id)],
  ];
  const conflicts: string[] = [];

  for (const [table, label, ids] of checks) {
    const filteredIds = ids.filter(Boolean);
    if (filteredIds.length === 0) continue;
    const { data, error } = await client
      .from(table)
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", filteredIds);
    if (error) throw error;
    for (const row of data ?? []) {
      conflicts.push(`${label} ${row.id} already exists in this organization.`);
    }
  }

  return conflicts;
}
