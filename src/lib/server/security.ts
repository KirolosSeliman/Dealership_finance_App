import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/types/domain";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();
let rateLimitClient: SupabaseClient | undefined;

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

export async function checkRateLimit(request: Request, bucket: string, options?: { limit?: number; windowMs?: number; userId?: string }) {
  const limit = options?.limit ?? 60;
  const windowMs = options?.windowMs ?? 60_000;
  const identity = options?.userId ? `user:${options.userId}` : `ip:${clientAddress(request)}`;

  if (shouldUsePersistentRateLimit()) {
    await checkPersistentRateLimit(bucket, identity, limit, windowMs);
    return;
  }

  checkLocalRateLimit(bucket, identity, limit, windowMs);
}

function checkLocalRateLimit(bucket: string, identity: string, limit: number, windowMs: number) {
  const key = `${bucket}:${identity}`;
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

async function checkPersistentRateLimit(bucket: string, identity: string, limit: number, windowMs: number) {
  try {
    const client = getRateLimitClient();
    const { data, error } = await client.rpc("check_rate_limit", {
      p_bucket: bucket,
      p_identifier_hash: hashRateLimitIdentity(identity),
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    });
    if (error) {
      console.error("[rate-limit] persistent backend unavailable", error.message);
      throw new RouteSecurityError(503, "Persistent rate limiting is unavailable. Apply the rate-limit database migration, then try again.");
    }
    const allowed = typeof data === "object" && data !== null && "allowed" in data ? Boolean((data as { allowed?: unknown }).allowed) : false;
    if (!allowed) throw new RouteSecurityError(429, "Too many requests. Please try again shortly.");
  } catch (error) {
    if (error instanceof RouteSecurityError) throw error;
    console.error("[rate-limit] persistent backend request failed", error);
    throw new RouteSecurityError(503, "Persistent rate limiting is unavailable. Try again shortly.");
  }
}

function getRateLimitClient() {
  if (rateLimitClient) return rateLimitClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new RouteSecurityError(503, "Persistent rate limiting is not configured. Set Supabase environment variables.");
  }
  rateLimitClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return rateLimitClient;
}

function shouldUsePersistentRateLimit() {
  const backend = process.env.RATE_LIMIT_BACKEND?.trim().toLowerCase();
  if (process.env.NODE_ENV === "production") return true;
  if (backend === "supabase") return true;
  if (backend === "memory" || !backend) return false;
  throw new RouteSecurityError(503, "RATE_LIMIT_BACKEND must be either 'supabase' or 'memory'.");
}

function hashRateLimitIdentity(identity: string) {
  return createHash("sha256").update(identity).digest("hex");
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
  rateLimitClient = undefined;
}

function normalizeOrigin(value: string) {
  return new URL(value).origin;
}

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}
