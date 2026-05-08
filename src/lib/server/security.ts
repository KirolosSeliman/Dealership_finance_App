import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/types/domain";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

export class RouteSecurityError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const allowedOrigins = new Set<string>();
  allowedOrigins.add(new URL(request.url).origin);
  if (process.env.NEXT_PUBLIC_APP_URL) {
    allowedOrigins.add(normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL));
  }

  if (!allowedOrigins.has(normalizeOrigin(origin))) {
    throw new RouteSecurityError(403, "Invalid request origin.");
  }
}

export function checkRateLimit(request: Request, bucket: string, options?: { limit?: number; windowMs?: number; userId?: string }) {
  const limit = options?.limit ?? 60;
  const windowMs = options?.windowMs ?? 60_000;
  const key = `${bucket}:${options?.userId ?? clientAddress(request)}`;
  const now = Date.now();
  const current = rateLimitStore.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  current.count += 1;
  if (current.count > limit) {
    throw new RouteSecurityError(429, "Too many requests. Please try again shortly.");
  }
}

export async function requireOrganizationRole(
  client: SupabaseClient,
  userId: string,
  organizationId: string,
  roles: Role[],
) {
  if (!organizationId) throw new RouteSecurityError(400, "Organization is required.");
  const { data, error } = await client
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .in("role", roles)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RouteSecurityError(403, "You do not have permission for this action.");
  return data.role as Role;
}

export function routeErrorResponse(error: unknown) {
  const status = error instanceof RouteSecurityError ? error.status : 400;
  const message = error instanceof Error ? error.message : "Request failed.";
  return { status, body: { ok: false, message } };
}

export function resetRateLimitForTests() {
  rateLimitStore.clear();
}

function normalizeOrigin(value: string) {
  return new URL(value).origin;
}

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}
