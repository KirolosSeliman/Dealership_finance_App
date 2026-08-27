import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { getRouteState } from "../src/features/app/navigation";
import { PURCHASE_SOURCES } from "../src/lib/domain/constants";

const repoRoot = process.cwd();
const dealerFlowApp = readFileSync(join(repoRoot, "src/features/app/feature-views.tsx"), "utf8");

test("legacy Market routes fall back to the dashboard list", () => {
  for (const pathname of ["/market-snap", "/deal-radar", "/market-data"]) {
    const route = getRouteState(pathname, "");
    assert.equal(route.view, "dashboard", pathname);
    assert.equal(route.mode, "list", pathname);
  }
});

test("normal core and vehicle routes remain unchanged", () => {
  const expectedRoutes = [
    ["/dashboard", "dashboard"],
    ["/vehicles", "vehicles"],
    ["/vehicles/new", "vehicles"],
    ["/cash", "cash"],
    ["/contacts", "contacts"],
    ["/taxes", "taxes"],
    ["/backups", "backups"],
    ["/settings", "settings"],
  ] as const;

  for (const [pathname, view] of expectedRoutes) {
    const route = getRouteState(pathname, "");
    assert.equal(route.view, view, pathname);
    assert.equal(route.mode, pathname === "/vehicles/new" ? "new" : "list", pathname);
  }

  const vehicleDetail = getRouteState("/vehicles/vehicle-123", "tab=expenses");
  assert.equal(vehicleDetail.view, "vehicles");
  assert.equal(vehicleDetail.mode, "detail");
  assert.equal(vehicleDetail.vehicleId, "vehicle-123");
  assert.equal(vehicleDetail.tab, "expenses");
});

test("active main navigation contains only core Dealer Flow views", () => {
  const mainNavStart = dealerFlowApp.indexOf("const mainNav:");
  const mainNavEnd = dealerFlowApp.indexOf("const vehicleTabs:", mainNavStart);
  assert.ok(mainNavStart >= 0 && mainNavEnd > mainNavStart, "mainNav declaration not found");
  const mainNav = dealerFlowApp.slice(mainNavStart, mainNavEnd);

  for (const view of ["dashboard", "vehicles", "cash", "contacts", "taxes", "backups", "settings"]) {
    assert.match(mainNav, new RegExp("\\[\"" + view + "\""), "mainNav missing " + view);
  }
  for (const view of ["marketSnap", "dealRadar", "marketData"]) {
    assert.doesNotMatch(mainNav, new RegExp("\\[\"" + view + "\""), "mainNav still exposes " + view);
  }
});

test("Market settings are kept behind the disabled legacy UI guard", () => {
  assert.match(dealerFlowApp, /const LEGACY_MARKET_UI_VISIBLE = false;/);

  const guardedSettings = dealerFlowApp.match(/\{LEGACY_MARKET_UI_VISIBLE && \(\s*<>[\s\S]*?<\/>\s*\)\}/);
  assert.ok(guardedSettings, "Market Settings blocks are not wrapped in one visibility guard");
  assert.match(guardedSettings[0], /t\.marketSnap\.dataAiSettings/);
  assert.match(guardedSettings[0], /<DeepCaptureSettingsPanel\b/);
});

test("legacy Market pages redirect to the dashboard without mounting DealerFlowApp", () => {
  for (const pathname of ["market-snap", "deal-radar", "market-data"]) {
    const source = readFileSync(join(repoRoot, "src/app", pathname, "page.tsx"), "utf8");
    assert.match(source, /import \{ redirect \} from "next\/navigation";/, pathname);
    assert.match(source, /redirect\("\/dashboard"\);/, pathname);
    assert.doesNotMatch(source, /DealerFlowApp/, pathname);
  }
});

test("only the daily backup cron remains scheduled", () => {
  const vercel = JSON.parse(readFileSync(join(repoRoot, "vercel.json"), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };

  assert.equal(vercel.crons.length, 1);
  assert.deepEqual(vercel.crons[0], { path: "/api/backups/daily", schedule: "0 7 * * *" });
  assert.equal(vercel.crons.some((cron) => cron.path.includes("market-snap")), false);
});

test("OpenLane and the other purchase sources remain available", () => {
  for (const source of ["OpenLane", "dealerAuction", "IAA", "Copart", "FacebookMarketplace", "trade", "other"] as const) {
    assert.equal(PURCHASE_SOURCES.includes(source), true, "missing purchase source " + source);
  }
});
