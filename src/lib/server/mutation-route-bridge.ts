import { NextResponse } from "next/server";
import { POST as legacyMutationPost } from "@/app/api/mutations/route";
import { assertSameOrigin, checkRateLimit } from "@/lib/server/security";

export async function forwardDomainMutation(
  request: Request,
  operation: string,
  options: {
    bucket: string;
    limit?: number;
    windowMs?: number;
    fields?: Record<string, string | undefined>;
  },
) {
  try {
    assertSameOrigin(request);
    await checkRateLimit(request, options.bucket, { limit: options.limit ?? 45, windowMs: options.windowMs ?? 60_000 });
    const formData = await request.formData();
    formData.set("operation", operation);
    for (const [key, value] of Object.entries(options.fields ?? {})) {
      if (value) formData.set(key, value);
    }
    const headers = new Headers(request.headers);
    headers.delete("content-type");
    return legacyMutationPost(new Request(request.url, { method: "POST", headers, body: formData }));
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number((error as { status: number }).status) : 400;
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Request failed." }, { status });
  }
}
