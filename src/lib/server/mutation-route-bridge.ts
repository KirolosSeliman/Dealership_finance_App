import { NextResponse } from "next/server";
import { assertSameOrigin, checkRateLimit } from "@/lib/server/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleDomainMutation, isDomainMutationOperation } from "@/lib/server/domain-mutation-handlers";

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
    if (!isDomainMutationOperation(operation)) {
      return NextResponse.json({ ok: false, message: "Unknown domain mutation." }, { status: 400 });
    }
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
    }
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    }
    await checkRateLimit(request, `${options.bucket}-user`, {
      limit: options.limit ?? 45,
      windowMs: options.windowMs ?? 60_000,
      userId: userData.user.id,
    });
    return handleDomainMutation({
      client: supabase,
      user: userData.user,
      operation,
      organizationId: String(formData.get("organizationId") || ""),
      formData,
    });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number((error as { status: number }).status) : 400;
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Request failed." }, { status });
  }
}
