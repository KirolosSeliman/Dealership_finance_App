import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { BACKUP_VERSION, generateReportPdf, toCsv } from "@/lib/backup/export";
import { checkRateLimit, routeErrorResponse } from "@/lib/server/security";

const organizationTables = [
  "vehicles",
  "vehicle_expenses",
  "sales",
  "company_cash_transactions",
  "external_cash_transactions",
  "contacts",
  "tax_reports",
  "attachments",
  "activity_logs",
];

export async function GET(request: Request) {
  try {
    await checkRateLimit(request, "daily-backup", { limit: 5, windowMs: 60_000 });
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");
    if (!cronSecret?.trim()) {
      return NextResponse.json(
        { ok: false, message: "CRON_SECRET is required before daily backups can run." },
        { status: 503 },
      );
    }
    if (!hasValidBearerSecret(authHeader, cronSecret)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

  const missing = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
  ].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    return NextResponse.json({ ok: false, message: "Backup credentials are not configured.", missing }, { status: 503 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  const { data: organizations, error: orgError } = await supabase.from("organizations").select("id, name");
  if (orgError) throw orgError;

  const uploaded: string[] = [];
  for (const organization of organizations ?? []) {
    const organizationId = String(organization.id);
    const now = new Date();
    const backupData: Record<string, unknown[]> = {};
    const zip = new JSZip();

    for (const table of organizationTables) {
      const { data, error } = await supabase.from(table).select("*").eq("organization_id", organizationId);
      if (error) throw error;
      backupData[table] = data ?? [];
    }

    zip.file("full-backup.json", JSON.stringify({ organization, ...backupData }, null, 2));
    zip.file("backup-manifest.json", JSON.stringify({
      appName: "Dealer Flow",
      backupVersion: BACKUP_VERSION,
      generatedAt: now.toISOString(),
      organizationId,
      counts: Object.fromEntries(Object.entries(backupData).map(([table, rows]) => [table, rows.length])),
    }, null, 2));
    zip.file("vehicles.csv", toCsv(backupData.vehicles as object[]));
    zip.file("expenses.csv", toCsv(backupData.vehicle_expenses as object[]));
    zip.file("sales.csv", toCsv(backupData.sales as object[]));
    zip.file("company-cash-transactions.csv", toCsv(backupData.company_cash_transactions as object[]));
    zip.file("external-cash-transactions.csv", toCsv(backupData.external_cash_transactions as object[]));
    zip.file("contacts.csv", toCsv(backupData.contacts as object[]));
    zip.file("tax-reports.csv", toCsv(backupData.tax_reports as object[]));
    zip.file("attachments-metadata.json", JSON.stringify(backupData.attachments, null, 2));
    zip.file("activity-logs.csv", toCsv(backupData.activity_logs as object[]));
    const summaryPdf = await generateReportPdf({
      title: "Dealer Flow Daily Backup Summary",
      organizationId,
      lines: [
        `Generated: ${now.toISOString()}`,
        `Vehicles: ${backupData.vehicles.length}`,
        `Expenses: ${backupData.vehicle_expenses.length}`,
        `Sales: ${backupData.sales.length}`,
        `Contacts: ${backupData.contacts.length}`,
      ],
    });
    zip.file("summary.pdf", await summaryPdf.arrayBuffer());

    const date = now.toISOString().slice(0, 10);
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const fileName = `dealer-flow-backup-${date}-${now.getTime()}.zip`;
    const key = `dealer-flow-backups/${organizationId}/${year}/${month}/${fileName}`;
    const body = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

    const { data: job, error: jobError } = await supabase.from("backup_jobs").insert({
      organization_id: organizationId,
      destination: "cloudflare_r2",
      status: "running",
    }).select("id").single();
    if (jobError) throw jobError;

    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: body,
      ContentType: "application/zip",
    }));

    await supabase.from("backup_files").insert({
      organization_id: organizationId,
      backup_job_id: job.id,
      storage_path: key,
      file_size_bytes: body.byteLength,
    });
    await supabase.from("backup_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", job.id);
    await supabase.from("activity_logs").insert({
      organization_id: organizationId,
      action: "backup_generated",
      entity_type: "backup",
      message: "Daily Cloudflare R2 backup generated.",
    });
    uploaded.push(key);
  }

    return NextResponse.json({ ok: true, uploaded });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

function hasValidBearerSecret(authHeader: string | null, secret: string) {
  const prefix = "Bearer ";
  if (!authHeader?.startsWith(prefix)) return false;
  const provided = authHeader.slice(prefix.length);
  const providedBuffer = Buffer.from(provided);
  const secretBuffer = Buffer.from(secret);
  return providedBuffer.length === secretBuffer.length && timingSafeEqual(providedBuffer, secretBuffer);
}
