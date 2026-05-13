import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { generateBackupExport } from "@/lib/backup/export";
import { assertSameOrigin, checkRateLimit, requireOrganizationRole, routeErrorResponse } from "@/lib/server/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadAppData } from "@/lib/supabase/repository";
import { backupRequestSchema, formatValidationError } from "@/lib/validation";

const required = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
] as const;

export async function GET() {
  const missing = required.filter((key) => !process.env[key]);
  return NextResponse.json({
    configured: missing.length === 0,
  });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await checkRateLimit(request, "backup-r2", { limit: 8, windowMs: 60_000 });

    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      return NextResponse.json(
        { ok: false, message: "Cloudflare R2 credentials are not configured.", missing },
        { status: 503 },
      );
    }

    const body = backupRequestSchema.parse(await request.json());

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
    }
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    }
    await checkRateLimit(request, "backup-r2-user", { limit: 4, windowMs: 60_000, userId: userData.user.id });
    await requireOrganizationRole(supabase, userData.user.id, body.organizationId, ["owner", "admin"]);

    const appData = await loadAppData(supabase, userData.user, body.organizationId);
    const backup = await generateBackupExport(appData);
    const backupBuffer = Buffer.from(await backup.arrayBuffer());
    if (backupBuffer.byteLength > 50 * 1024 * 1024) {
      return NextResponse.json({ ok: false, message: "Backup file is too large." }, { status: 400 });
    }

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const fileName = `dealer-flow-backup-${now.toISOString().slice(0, 10)}-${now.getTime()}.zip`;
    const key = `dealer-flow-backups/${body.organizationId}/${year}/${month}/${fileName}`;
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });

    const { data: job, error: jobError } = await supabase.from("backup_jobs").insert({
      organization_id: body.organizationId,
      destination: "cloudflare_r2",
      status: "running",
      created_by: userData.user.id,
    }).select("id").single();
    if (jobError) throw jobError;

    await client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        Body: backupBuffer,
        ContentType: "application/zip",
      }),
    );

    await supabase.from("backup_files").insert({
      organization_id: body.organizationId,
      backup_job_id: job.id,
      storage_path: key,
      file_size_bytes: backupBuffer.byteLength,
    });
    await supabase.from("backup_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", job.id);
    await supabase.from("activity_logs").insert({
      organization_id: body.organizationId,
      action: "backup_uploaded_to_r2",
      entity_type: "backup",
      entity_id: job.id,
      message: "Manual Cloudflare R2 backup uploaded.",
      created_by: userData.user.id,
    });

    return NextResponse.json({ ok: true, key });
  } catch (error) {
    const response = routeErrorResponse(error);
    return NextResponse.json({ ...response.body, message: formatValidationError(error) }, { status: response.status });
  }
}
