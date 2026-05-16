import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  isMarketSnapDeepCapturePayload,
  requireMarketSnapDeepCaptureConsent,
} from "../src/lib/server/market-snap-consent";
import { marketListingPayloadSchema } from "../src/lib/market-snap/validation";
import {
  DEEP_CAPTURE_CONSENT_VERSION,
  DEEP_CAPTURE_PRIVACY_VERSION,
  DEEP_CAPTURE_TERMS_VERSION,
} from "../src/lib/market-snap/deep-capture-policy";

const repoRoot = process.cwd();
const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const consentId = "33333333-3333-4333-8333-333333333333";

test("Deep Capture consent helper rejects missing, withdrawn, and stale consent", async () => {
  await assert.rejects(
    () => requireMarketSnapDeepCaptureConsent(new FakeConsentClient([]) as never, organizationId, userId, ["network_response_observation"]),
    /Deep Capture consent is required/,
  );

  await assert.rejects(
    () => requireMarketSnapDeepCaptureConsent(new FakeConsentClient([consentRow({ status: "withdrawn" })]) as never, organizationId, userId, ["network_response_observation"]),
    /Deep Capture consent is required/,
  );

  await assert.rejects(
    () => requireMarketSnapDeepCaptureConsent(new FakeConsentClient([consentRow({ consent_version: "old-version" })]) as never, organizationId, userId, ["network_response_observation"]),
    /current Deep Capture consent version/,
  );
});

test("Deep Capture consent helper accepts active current consent with required scopes", async () => {
  const active = await requireMarketSnapDeepCaptureConsent(
    new FakeConsentClient([consentRow()]) as never,
    organizationId,
    userId,
    ["network_response_observation", "media_url_capture"],
    consentId,
  );

  assert.equal(active.id, consentId);
  assert.deepEqual(active.captureScopes.slice(0, 2), ["dom_visible", "safe_read_only_expansion"]);

  await assert.rejects(
    () => requireMarketSnapDeepCaptureConsent(new FakeConsentClient([consentRow()]) as never, organizationId, userId, ["model_improvement"]),
    /does not include required scope/,
  );
});

test("Deep Capture detection treats basic DOM as basic and network/outcome scopes as deep", () => {
  assert.equal(isMarketSnapDeepCapturePayload({
    organizationId,
    sourceName: "OpenLane",
    captureLevel: "basic_dom",
    captureScopes: ["dom_visible"],
  }), false);

  assert.equal(isMarketSnapDeepCapturePayload({
    organizationId,
    sourceName: "OpenLane",
    openlaneMetadata: { networkEvidence: [{ endpointPattern: "app.openlane.ca/api/vdp/:id" }] },
  }), true);

  assert.equal(isMarketSnapDeepCapturePayload({
    organizationId,
    sourceName: "OpenLane",
    captureLevel: "deep_capture",
    captureScopes: ["dom_visible", "fee_outcome_capture"],
  }), true);
});

test("Market Snap validation accepts versioned Deep Capture consent fields and source evidence", () => {
  const result = marketListingPayloadSchema.safeParse({
    organizationId,
    sourceName: "OpenLane",
    sourceType: "auction",
    captureLevel: "deep_capture",
    captureScopes: ["dom_visible", "network_response_observation", "media_url_capture"],
    deepCaptureConsentId: consentId,
    sourceEvidence: [{
      scope: "network_response_observation",
      evidenceType: "network_response_summary",
      endpointPattern: "app.openlane.ca/api/vdp/:id",
      capturedAt: "2026-05-16T12:00:00.000Z",
      confidenceScore: 80,
    }],
    title: "2021 Toyota RAV4",
    year: 2021,
    make: "Toyota",
    model: "RAV4",
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.captureLevel, "deep_capture");
  assert.equal(result.data?.deepCaptureConsentId, consentId);
  assert.equal(result.data?.sourceEvidence?.[0]?.scope, "network_response_observation");
});

test("Deep Capture consent migration is versioned, auditable, RLS-protected, and non-destructive", () => {
  const migration = readFileSync(join(repoRoot, "supabase/migrations/20260525_market_snap_deep_capture_consent.sql"), "utf8");

  assert.match(migration, /create table if not exists market_snap_capture_consents/i);
  assert.match(migration, /create table if not exists market_snap_capture_consent_events/i);
  assert.match(migration, /alter table market_snap_capture_consents\s+enable row level security/i);
  assert.match(migration, /alter table market_snap_capture_consent_events\s+enable row level security/i);
  assert.match(migration, /has_org_role\(organization_id, array\['owner','admin'\]::app_role\[\]\)/i);
  assert.match(migration, /is_org_member\(organization_id\)/i);
  assert.match(migration, /unique.*where status = 'active'/is);
  assert.match(migration, /consent_created/i);
  assert.match(migration, /consent_withdrawn/i);
  assert.match(migration, /model_improvement_enabled/i);
  assert.match(migration, new RegExp(DEEP_CAPTURE_CONSENT_VERSION));
  assert.match(migration, new RegExp(DEEP_CAPTURE_TERMS_VERSION));
  assert.match(migration, new RegExp(DEEP_CAPTURE_PRIVACY_VERSION));
  assert.doesNotMatch(migration, /\bdelete\s+from\s+(market_snap|openlane|market_listings|deal_radar_saved_listings)/i);
});

test("Market Snap capture and save routes enforce consent before persisting Deep Capture", () => {
  const api = readFileSync(join(repoRoot, "src/lib/server/market-snap-api.ts"), "utf8");

  assert.match(api, /export async function captureListing[\s\S]*isMarketSnapDeepCapturePayload\(listing\)[\s\S]*requireMarketSnapDeepCaptureConsent/i);
  assert.match(api, /export async function saveListing[\s\S]*isMarketSnapDeepCapturePayload\(listing\)[\s\S]*requireMarketSnapDeepCaptureConsent/i);
  assert.match(api, /persistOpenLaneCapture\(client, listing, userId\)/);
  assert.match(api, /saveListingToDealRadar\(client, listing, valuation\)/);
});

function consentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: consentId,
    organization_id: organizationId,
    user_id: userId,
    status: "active",
    consent_version: DEEP_CAPTURE_CONSENT_VERSION,
    terms_version: DEEP_CAPTURE_TERMS_VERSION,
    privacy_version: DEEP_CAPTURE_PRIVACY_VERSION,
    capture_scopes: ["dom_visible", "safe_read_only_expansion", "network_response_observation", "fee_outcome_capture", "media_url_capture"],
    allowed_hosts: ["app.openlane.ca", "*.openlane.ca", "*.openlane.com"],
    accepted_at: "2026-05-16T12:00:00.000Z",
    withdrawn_at: null,
    accepted_by_user_id: userId,
    withdrawn_by_user_id: null,
    source: "web_app_settings",
    extension_installation_id: null,
    ...overrides,
  };
}

class FakeConsentClient {
  constructor(private rows: Array<Record<string, unknown>>) {}

  from(table: string) {
    assert.equal(table, "market_snap_capture_consents");
    return new FakeConsentQuery(this.rows);
  }
}

class FakeConsentQuery {
  private filters: Array<(row: Record<string, unknown>) => boolean> = [];

  constructor(private rows: Array<Record<string, unknown>>) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  maybeSingle() {
    const data = this.rows.find((row) => this.filters.every((filter) => filter(row))) ?? null;
    return { data, error: null };
  }
}
