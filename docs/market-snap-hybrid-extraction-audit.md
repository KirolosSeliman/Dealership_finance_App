# Market Snap Hybrid Extraction Audit

## Current Runtime State

The current content-script runtime starts on OpenLane hosts after `document.body` is available. `browser-extension/src/content-script.js` loads settings through `DealerFlowMarketSnapStorage.getSettings()`, refreshes Deep Capture consent state, starts or stops the network observer, creates the capture runtime, observes SPA route/storage/DOM changes, then runs stable capture.

Recent behavior already fixed in the branch:

- `runRuntime()` no longer blocks stable capture behind the old strict page detector. It now mounts the widget on OpenLane hosts and lets `openlane-stable-capture.js` decide `unsupported_page`, `pending_vehicle_data`, `incomplete_identity`, or `ready_to_capture`.
- Manual refresh clears the section-map extraction cache before extraction.
- Route changes and DOM mutations clear extraction caches and schedule a rerun.
- Widget settings save now has visible success/error handling.
- Blank stored Dealer Flow URL now normalizes to `http://localhost:3000`.

Current runtime still fails closed to `basic_dom` unless all formal active-consent fields are present. That is the main conflict with the new hybrid prompt, which asks for temporary default Deep Capture while the future download/onboarding consent UI is pending.

## Current Settings State

Settings are defined in `browser-extension/src/storage.js`.

Current defaults:

- `dealerFlowBaseUrl: "http://localhost:3000"`
- `organizationId: ""`
- `autoAnalyze: true`
- `autoCapture: true`
- `autoSave: false`
- `includeMediaUrls: true`
- `includeRawVisibleText: true`
- `observePageNetworkData: false`
- `deepCaptureEnabled: false`
- `deepCaptureConsentStatus: "off"`
- `deepCaptureConsentId: ""`

`normalizeSettings()` currently requires:

```txt
organizationId
+ deepCaptureEnabled
+ deepCaptureConsentStatus === "active"
+ deepCaptureConsentId
```

before it returns `deepCaptureEnabled: true`. It also normalizes `observePageNetworkData` to true only when that same active-consent gate is true.

This means checking Deep Capture or Observe page network data in the widget/options UI is not sufficient. Without an active backend consent record and ID, the setting is normalized back to inactive.

## Deep Capture Activation Path

The activation chain is currently strict in four places:

1. `storage.js` normalizes Deep Capture to inactive unless consent status is active and a consent ID exists.
2. `content-script.js` calls `refreshDeepCaptureConsentState()` during boot and settings refresh.
3. `refreshDeepCaptureConsentState()` calls `/api/market-snap/deep-capture-consent`; if the backend returns inactive or is unreachable, it saves Deep Capture as disabled/off or paused.
4. `content-script.js`, `openlane-stable-capture.js`, and `openlane-network-observer.js` each use `hasActiveDeepCaptureConsent()` style checks that require active status plus consent ID.

Confirmed root cause for `captureLevel: "basic_dom"` and stopped network observer:

- The code was intentionally designed to fail closed until formal active consent exists.
- The new ZIP changes the product requirement temporarily: Deep Capture should default active on OpenLane when Dealer Flow URL, organization ID, and capture settings exist, even if formal consent ID/status is not available yet.
- Therefore Phase 1 must introduce an explicit temporary activation mode instead of pretending the existing active-consent model is satisfied.

## Network Observer Path

`browser-extension/src/openlane-network-page-hook.js` passively wraps page `fetch` and `XMLHttpRequest` responses. It only posts capped JSON-like response bodies back to the content script when:

- host matches OpenLane or KAR media,
- endpoint path matches vehicle/listing/media/condition/bid/fee/sale concepts,
- endpoint path does not match auth, OAuth, login, logout, session, profile, account, payment, billing, user/me, token, cookie, or password concepts.

The hook does not capture request headers, cookies, authorization headers, credentials, or tokens.

`browser-extension/src/openlane-network-observer.js` receives those snippets only after `startOpenLaneNetworkObserver()` is called. Today that function returns:

```txt
enabled: false
reason: "deep_capture_consent_required"
```

unless `deepCaptureEnabled`, `deepCaptureConsentStatus === "active"`, and `deepCaptureConsentId` are all present. If enabled, it sanitizes payloads, caps observations to 10, redacts sensitive keys/strings, extracts candidates, and stores only summary/candidate evidence.

The observer safety model is strong. The activation predicate is the part that must change in Phase 1 for the temporary default mode.

## VIN Extraction Path

VIN can currently come from:

- visible DOM text,
- section-mapped main text,
- label/value extraction,
- `data-vin`,
- `aria-label`,
- `data-testid`,
- `title`,
- buttons and role buttons,
- generic safe attributes,
- URL path/query recovery,
- allowed network JSON when Deep Capture is active.

Validation uses the strict pattern:

```txt
/^[A-HJ-NPR-Z0-9]{17}$/i
```

Known safeguards:

- VIN barcode label noise is explicitly rejected.
- Invalid candidates containing excluded VIN characters are rejected.
- Network VINs merge only when there is no existing VIN, the VIN matches, or network confidence beats the existing source.
- Missing VIN keeps OpenLane capture preview-only through `missing_vin_openlane_preview_only`.

Confirmed remaining root cause for live missing VIN:

- If the live page exposes VIN only in page-loaded JSON, Deep Capture being inactive prevents the network candidate from merging.
- If the VIN appears after initial SPA load, stable capture can recover on reruns, but it still cannot use network JSON while the observer is stopped.

## Carfax Extraction Path

CARFAX can currently come from:

- visible `a[href]`,
- `data-href`,
- `data-url`,
- `aria-label`,
- `title`,
- safe inline HTML/onclick/router metadata parsing,
- visible text fallback,
- allowed network JSON when Deep Capture is active.

The extractor truthfully reports:

- `url_found` when a safe URL is available,
- `text_only` when CARFAX is visible but no URL is present,
- `missing` when neither text nor URL evidence exists.

Confirmed remaining root cause for live `text_only`:

- If OpenLane renders only visible CARFAX text, `text_only` is correct and must not be inflated to a URL.
- If the actual URL exists only in page-loaded JSON or delayed app metadata, the stopped network observer prevents recovery.

## Widget Error Path

Current widget behavior after the latest branch fix:

- Settings save is wrapped in `try/catch`.
- Successful save reloads normalized settings into the form and renders `Settings saved.`
- Failed save renders `Settings save failed: <error>`.
- `copyExtractedJson()` catches extraction/clipboard failures and renders the real error.
- `runAnalysis()` catches extraction failures before backend analysis and renders `status: "error"`.
- Save is guarded against duplicate requests by `STATE.saving`.
- Save sends no `valuation` key when valuation is null/undefined in `api-client.js`.
- Backend `saveListingSchema` accepts `valuation: null` defensively and normalizes it away.

`readinessSummary()` and data-quality rendering helpers are null-safe for missing listing/metadata; they default to empty objects and show `No extraction yet` when no listing/valuation exists.

## Backend/Deployment Dependencies

Backend auth and persistence remain strict:

- API routes expose CORS preflight through `marketSnapOptions`.
- `MARKET_SNAP_EXTENSION_ORIGINS` controls extension origins.
- API calls use `credentials: "include"`.
- Server auth/org role checks remain in `market-snap-api.ts`.
- `captureListing()` and `saveListing()` currently require active Deep Capture consent before persisting Deep Capture payloads.
- `saveListing()` recomputes valuation server-side before saving.
- `validation.ts` rejects invalid VIN, unsafe URLs, credential/session/token-like keys, oversized debug payloads, and mileage evidenced as transport distance.

Deployment state before this audit:

- Latest pushed commit before this phase built locally and Vercel status was green.

## Confirmed Root Causes

1. Deep Capture inactive is caused by formal-consent-only gates in `storage.js`, `content-script.js`, `openlane-stable-capture.js`, and `openlane-network-observer.js`.
2. Network evidence count is zero because the observer is never started unless active consent status and ID exist.
3. VIN remains missing on pages where VIN is only present in page-loaded JSON because inactive Deep Capture prevents JSON candidate collection and merge.
4. CARFAX remains `text_only` when no safe URL is visible in DOM, and may fail to upgrade if the URL is only in network JSON while the observer is stopped.
5. Missing VIN correctly blocks capture through `missing_vin_openlane_preview_only`; this should remain true until a valid VIN is recovered.
6. The old settings/button reliability failures have been addressed on this branch, but live Chrome must still verify the unpacked extension was reloaded.

## Hidden Edge Cases

- The new temporary default Deep Capture rule can conflict with backend persistence consent enforcement. Phase 1 must either keep backend persistence at basic/preview for default mode or add explicit backend semantics for temporary local capture without weakening production consent/audit rules.
- If default Deep Capture marks payloads as `deep_capture` without a real consent ID, current backend save/capture routes will reject persistence.
- If the network observer starts by default, the endpoint denylist and sanitizer must remain the safety boundary. Tests must prove auth/session/profile/payment/user/token endpoints are ignored.
- Model improvement must remain off unless explicitly opted in. Default Deep Capture must not imply training consent.
- The options page currently disables Deep Capture and Observe Network checkboxes unless status is `active`; this conflicts with default-enabled pending-consent mode and needs a clear UI state in a later phase.
- The widget label currently says `On - active consent` only when `captureLevel === "deep_capture"`; default mode needs truthful wording such as default-enabled pending consent UI, not active consent.
- Backend and docs still contain legally cautious copy requiring affirmative consent. The temporary rule must be visibly reversible and must not remove the formal consent path.

## Phase Plan Confirmation

The ZIP phase order should be followed as listed:

1. Phase 0: context and root-cause audit. This document completes that phase.
2. Phase 1: default Deep Capture safe activation. Add a feature-flagged temporary activation mode, runtime metadata, strict host/settings checks, and tests.
3. Phase 2: widget settings and null safety. Make UI truthfully show default mode and preserve reliable settings behavior.
4. Phase 3: network observer and safe evidence pipeline. Ensure default-mode observer remains allowlisted, denied, redacted, capped, and candidate-only.
5. Phase 4: VIN extraction header, DOM, and network. Prove VIN recovery across visible and network evidence.
6. Phase 5: CARFAX URL recovery and text-only truth. Keep text-only honest and recover safe URLs when available.
7. Phase 6: evidence arbitration and capture gate. Keep missing VIN blocked and protect canonical data.
8. Phase 7: widget debug and manual-testing UX. Expose the runtime truth clearly.
9. Phase 8: test suite and fixture hardening. Expand regression fixtures.
10. Phase 9: deployment env and Vercel validation. Validate deploy state and required env.
11. Phase 10: final live browser validation. Requires real Chrome/OpenLane session.

Phase 1 should not weaken the network denylist, backend auth, org role checks, safe URL validation, VIN validation, or model-improvement/training gates. The clean implementation path is to introduce explicit activation metadata, for example:

```txt
deepCaptureActivationMode: "default_enabled_pending_consent_ui"
consentMode: "future_download_consent_pending"
```

and make every layer consciously handle that mode instead of overloading `deepCaptureConsentStatus: "active"`.
