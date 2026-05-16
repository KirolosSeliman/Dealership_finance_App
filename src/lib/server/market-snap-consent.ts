import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEEP_CAPTURE_CONSENT_VERSION,
  DEEP_CAPTURE_PRIVACY_VERSION,
  DEEP_CAPTURE_SCOPES,
  DEEP_CAPTURE_TERMS_VERSION,
} from "@/lib/market-snap/deep-capture-policy";
import { RouteSecurityError } from "@/lib/server/security";
import type { MarketListingInput, MarketSnapCaptureScope } from "@/types/market-snap";

type Client = SupabaseClient;

export interface MarketSnapCaptureConsent {
  id: string;
  organizationId: string;
  userId?: string;
  status: "active" | "withdrawn" | "expired" | "superseded";
  consentVersion: string;
  termsVersion: string;
  privacyVersion: string;
  captureScopes: MarketSnapCaptureScope[];
  allowedDomains: string[];
  allowedHosts: string[];
  allowedDataCategories: string[];
  deniedDataCategories: string[];
  acceptedAt: string;
  acceptedByUserId?: string;
  withdrawnAt?: string;
}

export async function getActiveMarketSnapCaptureConsent(client: Client, organizationId: string, userId: string) {
  void userId;
  const { data, error } = await client
    .from("market_snap_capture_consents")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .is("withdrawn_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapConsentRow(data as Record<string, unknown>);
}

export async function requireMarketSnapDeepCaptureConsent(
  client: Client,
  organizationId: string,
  userId: string,
  scopes: MarketSnapCaptureScope[] = [],
  deepCaptureConsentId?: string,
) {
  const consent = await getActiveMarketSnapCaptureConsent(client, organizationId, userId);
  if (!consent) {
    throw new RouteSecurityError(403, "Deep Capture consent is required before Dealer Flow can persist Deep Capture evidence.");
  }
  if (
    consent.consentVersion !== DEEP_CAPTURE_CONSENT_VERSION
    || consent.termsVersion !== DEEP_CAPTURE_TERMS_VERSION
    || consent.privacyVersion !== DEEP_CAPTURE_PRIVACY_VERSION
  ) {
    throw new RouteSecurityError(403, "Deep Capture requires the current Deep Capture consent version before capture can continue.");
  }
  if (deepCaptureConsentId && consent.id !== deepCaptureConsentId) {
    throw new RouteSecurityError(403, "Deep Capture consent does not match the active organization consent record.");
  }

  const missingScope = scopes.find((scope) => !consent.captureScopes.includes(scope));
  if (missingScope) {
    throw new RouteSecurityError(403, `Deep Capture consent does not include required scope: ${missingScope}.`);
  }

  return consent;
}

export async function recordMarketSnapConsentEvent(
  client: Client,
  input: {
    organizationId: string;
    consentId?: string;
    eventType:
      | "consent_created"
      | "consent_updated"
      | "consent_withdrawn"
      | "consent_version_superseded"
      | "model_improvement_enabled"
      | "model_improvement_disabled"
      | "capture_scope_enabled"
      | "capture_scope_disabled";
    actorUserId: string;
    details?: Record<string, unknown>;
  },
) {
  const { error } = await client.from("market_snap_capture_consent_events").insert({
    organization_id: input.organizationId,
    consent_id: input.consentId ?? null,
    event_type: input.eventType,
    actor_user_id: input.actorUserId,
    details: input.details ?? {},
  });
  if (error) throw error;
}

export function isMarketSnapDeepCapturePayload(input: Partial<MarketListingInput>) {
  if (input.captureLevel === "deep_capture") return true;
  if (input.captureScopes?.some((scope) => scope !== "dom_visible")) return true;
  if (input.sourceEvidence?.some((evidence) => evidence.scope !== "dom_visible")) return true;

  const metadata = input.openlaneMetadata as { networkEvidence?: unknown } | undefined;
  if (Array.isArray(metadata?.networkEvidence) && metadata.networkEvidence.length > 0) return true;

  return Boolean(
    input.pageContext
      || input.auctionObservation
      || input.purchaseOutcome
      || input.condition
      || input.media
      || input.carfax
      || input.debug,
  );
}

export function requiredDeepCaptureScopes(input: Partial<MarketListingInput>): MarketSnapCaptureScope[] {
  const scopes = new Set<MarketSnapCaptureScope>();
  for (const scope of input.captureScopes ?? []) {
    if (DEEP_CAPTURE_SCOPES.includes(scope)) scopes.add(scope);
  }
  for (const evidence of input.sourceEvidence ?? []) {
    if (DEEP_CAPTURE_SCOPES.includes(evidence.scope)) scopes.add(evidence.scope);
  }
  if (input.pageContext || input.identity) scopes.add("dom_visible");
  if (input.auctionObservation) scopes.add("safe_read_only_expansion");
  if (input.purchaseOutcome || input.buyPriceAuction || input.totalInvoiceAmount || input.finalAcquisitionCost) scopes.add("fee_outcome_capture");
  if (input.captureKind === "candidate_outcome" || input.captureKind === "verified_outcome" || input.captureKind === "manual_confirmation") scopes.add("post_sale_outcome_capture");
  if (input.photos?.length || input.videos?.length || input.media) scopes.add("media_url_capture");

  const metadata = input.openlaneMetadata as { networkEvidence?: unknown } | undefined;
  if (Array.isArray(metadata?.networkEvidence) && metadata.networkEvidence.length > 0) scopes.add("network_response_observation");

  scopes.delete("dom_visible");
  return Array.from(scopes);
}

function mapConsentRow(row: Record<string, unknown>): MarketSnapCaptureConsent {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userId: stringOrUndefined(row.user_id),
    status: String(row.status) as MarketSnapCaptureConsent["status"],
    consentVersion: String(row.consent_version),
    termsVersion: String(row.terms_version),
    privacyVersion: String(row.privacy_version),
    captureScopes: normalizeScopes(row.capture_scopes),
    allowedDomains: normalizeStringArray(row.allowed_domains),
    allowedHosts: normalizeStringArray(row.allowed_hosts),
    allowedDataCategories: normalizeStringArray(row.allowed_data_categories),
    deniedDataCategories: normalizeStringArray(row.denied_data_categories),
    acceptedAt: String(row.accepted_at),
    acceptedByUserId: stringOrUndefined(row.accepted_by_user_id),
    withdrawnAt: stringOrUndefined(row.withdrawn_at),
  };
}

function normalizeScopes(value: unknown): MarketSnapCaptureScope[] {
  return normalizeStringArray(value).filter((scope): scope is MarketSnapCaptureScope =>
    DEEP_CAPTURE_SCOPES.includes(scope as MarketSnapCaptureScope),
  );
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return [];
}

function stringOrUndefined(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
