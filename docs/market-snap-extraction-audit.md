# Market Snap Extraction Audit

## Current Flow

```txt
OpenLane page
  -> browser-extension/manifest.json injects content scripts on https://*.openlane.ca/* and https://*.openlane.com/*
  -> content-script.js boots at document_idle, loads settings, checks consent, starts/stops Deep Capture observer
  -> content-script.js waits/retries for a supported OpenLane capture page
  -> openlane-page-classifier.js classifies pageType and captureKind from URL plus section-mapped main text
  -> openlane-section-map.js builds cached document text regions and zones
  -> openlane-extractor.js extracts DOM fields, visible text, attributes, media, CARFAX metadata, condition, prices
  -> openlane-safe-expander.js optionally opens read-only sections when Deep Capture consent is active
  -> openlane-network-page-hook.js passively observes page fetch/XMLHttpRequest JSON responses
  -> openlane-network-observer.js filters, redacts, normalizes, and merges allowed network JSON candidates
  -> openlane-extraction-contract.js builds structured identity/auction/condition/media/carfax blocks and fieldEvidence
  -> market-snap-widget.js displays extracted data, diagnostics, settings, save/copy/refresh actions
  -> api-client.js sends analyze/capture/save requests with credentials to the configured Dealer Flow URL
  -> market-snap API routes call server-side auth, origin, rate-limit, org-role, consent, and schema checks
  -> validation.ts validates listing payloads, fieldEvidence, safe URLs, VIN, mileage, Deep Capture evidence, and save payloads
  -> market-snap-api.ts analyzes, captures, or saves; save recomputes valuation server-side
  -> repository.ts persists market_listings, deal_radar_saved_listings, openlane_vehicle_identities, openlane_observations, and openlane_outcomes
```

## VIN Extraction Points

- DOM visible text and section-mapped main text in `openlane-extractor.js`.
- Label/value extraction through OpenLane labels.
- DOM attributes from `data-vin`, `aria-label`, `data-testid`, `title`, buttons, role buttons, and data attributes.
- Network JSON candidates from `openlane-network-observer.js` when active Deep Capture consent exists.
- Backend validation in `validation.ts` accepts only `/^[A-HJ-NPR-Z0-9]{17}$/i`.
- Persistence stores VIN in `market_listings`, `deal_radar_saved_listings`, and `openlane_vehicle_identities`.

## Carfax Extraction Points

- Visible links from `a[href]`.
- DOM attributes from `aria-label`, `title`, `data-href`, `data-url`, and safe string parsing of inline metadata.
- HTML attribute text captured by the extractor.
- Visible text fallback sets `carfaxUrlStatus: "text_only"` when CARFAX is mentioned but no URL is present.
- Network JSON candidates can provide `carfaxUrl` when Deep Capture is active.
- Backend validation requires CARFAX URLs to be HTTP/HTTPS.
- Persistence stores `carfax_url`, `carfax_url_status`, and normalized payload metadata.

## Places Where VIN Can Be Lost

- A dynamic OpenLane SPA can initially render a supported shell before VIN appears. `content-script.js` mitigates this with readiness retries and mutation-triggered reruns, but early extraction can still produce a listing without VIN if year/make/model plus mileage/price/media are present.
- `isVehicleListing()` intentionally allows a vehicle listing without VIN when year, make, model, and at least one mileage/price/media marker exist. This keeps the widget usable but means VIN is not required before analysis/capture.
- If Deep Capture consent is inactive, network JSON candidates are intentionally discarded, so a VIN visible only in app JSON will not be merged.
- If an OpenLane component stores VIN in an attribute/key outside the current DOM/network candidate list, the current resolver may miss it.
- Backend validation rejects invalid VINs rather than repairing them, which is correct for data integrity but can drop weak candidates.

## Places Where Carfax Can Be Lost

- If OpenLane renders only CARFAX text with no link/metadata, extraction correctly records text-only status but no URL.
- If CARFAX metadata appears only in network JSON and Deep Capture is off, the URL will not be merged.
- If the URL is relative or stored in an unsupported attribute shape, the DOM resolver may miss it.
- Unsafe protocols or oversized/sensitive structured payloads are rejected by backend validation.
- The extension does not and must not fetch paid CARFAX report content, so only visible/link metadata is expected.

## Premature Capture Risks

- `runRuntime()` checks support before mounting and analysis, but `isVehicleListing()` can pass without VIN.
- `queueCapture()` can store a basic observation once a vehicle listing is considered valid; this is useful for active listing observations but can preserve low-quality records if critical fields load later.
- `listingSignature()` deduplication can skip repeated analysis unless force/manual refresh or DOM/route mutation changes the signature.
- Section map caches are document-level (`__openlaneSectionMap`, `__openlaneTextRegions`, `__openlaneMediaRejected`). Current code clears them on readiness retries, route changes, DOM mutations, and forced extraction, which is the right mitigation for SPA staleness.
- Active current bids/offers are treated as observations, not labels, which avoids supervised-training pollution.

## Consent / Deep Capture Risks

- Deep Capture is off by default in `storage.js`.
- `observePageNetworkData` is false by default and normalizes to true only when organization ID, active consent status, consent ID, and Deep Capture are present.
- `content-script.js` refreshes backend consent state and listens to `chrome.storage.onChanged`.
- `openlane-network-page-hook.js` observes fetch/XHR responses only on allowed OpenLane/KAR hosts and only endpoint paths matching vehicle/listing concepts.
- Deny rules block auth, OAuth, login/logout, session, profile, account, payment, billing, user/me, token, cookie, and password endpoints before allow rules.
- The page hook does not capture request headers, cookies, authorization headers, credentials, or tokens.
- Network evidence is capped and sanitized before merge/storage.
- Main operational risk: if backend consent status is unreachable, runtime must fail closed to basic DOM, which reduces extraction quality but preserves privacy.

## Backend Persistence Risks

- `saveListing()` recomputes valuation server-side before saving, so the extension does not control canonical valuation.
- `marketListingPayloadSchema` rejects invalid VINs, unsafe URLs, dangerous structured keys, oversized deep records, and mileage evidenced only by transport/distance context.
- `saveListingSchema` defensively accepts `valuation: null` and normalizes it away.
- `persistOpenLaneCapture()` separates active listing observations from candidate/verified outcomes.
- Training eligibility requires model improvement opt-in, verified/manual capture kind, non-pending negotiation status, and a verified label.
- Migrations add retention policies, consent references, RLS, and training-eligibility constraints.
- Remaining risk: saved Deal Radar records can still contain missing VIN/CARFAX when the page simply does not expose those fields or Deep Capture is inactive; UI/backend must keep communicating missing data clearly.

## Test Coverage Gaps

- Existing tests cover OpenLane manifest injection, widget controls, extension settings, network observer safety, cache clearing, VIN rejection, mileage-vs-transport selection, CARFAX metadata, validation guardrails, save payload behavior, and OpenLane fixture extraction.
- Additional Phase 2+ tests should prove the orchestrator does not mark extraction stable until either VIN/CARFAX are found or explicit missing/rejection reasons are recorded.
- Additional tests should cover delayed CARFAX and delayed VIN arrival separately from delayed generic vehicle content.
- Additional tests should verify a basic DOM pass can be upgraded by later Deep Capture network evidence without stale signature suppression.
- Additional tests should prove fieldEvidence contains accepted and rejected candidates for VIN and CARFAX in the widget copy/debug payload.

## Recommended Phase Plan

1. Phase 2 should introduce or tighten a stable extraction orchestrator that waits for critical field readiness, reruns after SPA/network evidence changes, and records explicit missing reasons.
2. Phase 3 should harden VIN recovery across DOM, attributes, copy controls, embedded safe JSON, and network JSON while preserving strict rejection rules.
3. Phase 4 should harden CARFAX URL/status recovery with explicit text-only reasons and no report fetching.
4. Phase 5 should verify Deep Capture network evidence is transformed into canonical candidates and reruns extraction when new evidence arrives.
5. Phase 6 should improve widget debug feedback so users can see whether a field is missing, rejected, delayed, or blocked by consent.
6. Phase 7 should keep backend quality gates authoritative before persistence.
7. Phase 8 should add realistic delayed-SPA and network fixtures.
8. Phase 9 should keep ML candidate-only until extraction quality and verified-label quality are measurable.
9. Phase 10 should run final release validation and live Chrome QA.

## No-Code Fixes / Settings To Verify

- Confirm the extension is reloaded in `chrome://extensions` after each build/copy.
- Confirm the configured Dealer Flow URL matches the logged-in app origin.
- Confirm Organization ID is present and belongs to the logged-in user.
- Confirm Deep Capture status is active in the options page, not merely checked.
- Confirm `observePageNetworkData` is enabled only after active consent.
- Confirm `MARKET_SNAP_EXTENSION_ORIGINS` contains the installed extension origin if using a deployed Dealer Flow backend.
- Confirm the live OpenLane page is a supported capture path such as `https://app.openlane.ca/vdp/...`.

## Code Fixes Needed

- Add stable extraction readiness semantics that distinguish "not yet loaded" from "loaded but missing".
- Trigger extraction refresh when new allowed network evidence arrives, not only on DOM/route/settings changes.
- Ensure VIN and CARFAX candidates include accepted and rejected evidence in a bounded debug structure.
- Make the widget show specific field-level status for VIN, CARFAX, mileage, Deep Capture, and network evidence.
- Keep backend validation strict; do not relax VIN, URL, credentials, or training-label guardrails.

## Ranked Root-Cause Hypotheses

### High Probability

- OpenLane SPA timing and candidate readiness are the main remaining reliability risk. The code now clears stale section-map caches, but `isVehicleListing()` can still proceed without VIN and without a final field-readiness decision.
- Deep Capture/network evidence may arrive after the DOM extraction signature has already been processed, so later VIN/CARFAX JSON can fail to upgrade the displayed listing unless an explicit network-evidence rerun is triggered.

### Medium Probability

- OpenLane stores VIN/CARFAX in app-specific attributes, router metadata, or JSON keys that are not yet fully covered by resolvers.
- CARFAX is sometimes visible only as text or behind a safe link component, so URL extraction may truthfully produce `text_only`.
- Missing/paused backend consent makes runtime fall back to `basic_dom`, which is expected but lowers field recovery.

### Low Probability

- Manifest host matching is the root cause. Current manifest matches `https://*.openlane.ca/*`, which includes `app.openlane.ca`.
- Backend persistence is silently accepting unsafe values. Current validation rejects unsafe VINs, unsafe URLs, credential/session keys, and suspicious transport-only mileage evidence.
- Supervised ML is polluting production valuation. Current production estimator is still comparable-estimator based, and CatBoost is candidate-only.
