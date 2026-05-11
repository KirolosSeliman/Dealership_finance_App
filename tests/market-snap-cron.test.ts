import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("Market Snap daily cron is protected and refreshes active inventory only", () => {
  const route = readFileSync(join(repoRoot, "src/app/api/market-snap/cron/daily-refresh/route.ts"), "utf8");

  assert.match(route, /CRON_SECRET/);
  assert.match(route, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(route, /market_data_jobs/);
  assert.match(route, /cleanup_market_snap_retention/);
  assert.match(route, /\.in\("status", \["purchased", "in_repair", "listed_for_sale"\]\)/);
  assert.doesNotMatch(route, /\.in\("status", \[[^\]]*"sold"[^\]]*\]\)/);
});

test("Market Snap retention cleanup RPC is service-role only in production hardening migration", () => {
  const migration = readFileSync(join(repoRoot, "supabase/migrations/20260512_market_snap_production_hardening.sql"), "utf8");

  assert.match(migration, /revoke execute on function (public\.)?cleanup_market_snap_retention\(\) from authenticated/i);
  assert.match(migration, /grant execute on function (public\.)?cleanup_market_snap_retention\(\) to service_role/i);
});
