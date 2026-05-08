import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, message: "Cloudflare R2 credentials are not configured.", missing },
      { status: 503 },
    );
  }

  const body = (await request.json()) as {
    organizationId?: string;
    fileName?: string;
    backupBase64?: string;
  };

  if (!body.organizationId || !body.fileName || !body.backupBase64) {
    return NextResponse.json({ ok: false, message: "Missing backup payload." }, { status: 400 });
  }
  if (!/^dealer-flow-backup-\d{4}-\d{2}-\d{2}-\d+\.zip$/.test(body.fileName)) {
    return NextResponse.json({ ok: false, message: "Invalid backup file name." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
  }
  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", body.organizationId)
    .eq("user_id", userData.user.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) {
    return NextResponse.json({ ok: false, message: "Owner or admin role required." }, { status: 403 });
  }

  const backupBuffer = Buffer.from(body.backupBase64, "base64");
  if (backupBuffer.byteLength > 50 * 1024 * 1024) {
    return NextResponse.json({ ok: false, message: "Backup file is too large." }, { status: 400 });
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const key = `dealer-flow-backups/${body.organizationId}/${year}/${month}/${body.fileName}`;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: backupBuffer,
      ContentType: "application/zip",
    }),
  );

  return NextResponse.json({ ok: true, key });
}
