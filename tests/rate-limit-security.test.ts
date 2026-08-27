import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRateLimit, resetRateLimitForTests, RouteSecurityError } from "../src/lib/server/security";

test("production cannot downgrade rate limiting to the in-memory backend", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousBackend = process.env.RATE_LIMIT_BACKEND;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  process.env.NODE_ENV = "production";
  process.env.RATE_LIMIT_BACKEND = "memory";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  resetRateLimitForTests();

  await assert.rejects(
    () => checkRateLimit(new Request("http://localhost:3000/api/mutations"), "production-test", { limit: 1 }),
    (error: unknown) => error instanceof RouteSecurityError && error.status === 503,
  );

  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousBackend === undefined) delete process.env.RATE_LIMIT_BACKEND;
  else process.env.RATE_LIMIT_BACKEND = previousBackend;
  if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  if (previousAnon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnon;
  resetRateLimitForTests();
});
