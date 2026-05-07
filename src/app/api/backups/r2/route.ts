import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const required = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
  ] as const;
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
      Body: Buffer.from(body.backupBase64, "base64"),
      ContentType: "application/zip",
    }),
  );

  return NextResponse.json({ ok: true, key });
}
