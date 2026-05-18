# Phase 03 — Extension Consent Gate, Settings UX, and “Enabled After Consent” Default

## Goal

Update the browser extension so Deep Capture is visible, consent-gated, and easy to withdraw. The product should satisfy the business request “on by default” only after explicit consent has been accepted.


## Repository context

Repository: KirolosSeliman/Dealership_finance_App

Relevant existing extension files likely include:
- browser-extension/manifest.json
- browser-extension/src/storage.js
- browser-extension/src/api-client.js
- browser-extension/src/openlane-extraction-contract.js
- browser-extension/src/openlane-section-map.js
- browser-extension/src/openlane-page-classifier.js
- browser-extension/src/openlane-network-observer.js
- browser-extension/src/openlane-network-page-hook.js
- browser-extension/src/openlane-safe-expander.js
- browser-extension/src/openlane-extractor.js
- browser-extension/src/market-snap-widget.js
- browser-extension/src/capture-runtime.js
- browser-extension/src/content-script.js
- browser-extension/options.html / options scripts if present
- browser-extension/popup.html / popup scripts if present

Relevant backend files likely include:
- src/lib/server/market-snap-api.ts
- src/lib/market-snap/repository.ts
- src/lib/market-snap/validation.ts
- src/types/market-snap.ts
- src/lib/market-snap/training-export.ts
- src/app/api/market-snap/* routes
- supabase/migrations/*
- tests/fixtures/openlane/*
- tests/*market-snap* or *openlane* test files

You must discover the exact current file names and code before modifying anything.



## Global non-negotiables for every phase

- Do not implement, suggest, or preserve any CAPTCHA bypass, anti-bot bypass, stealth scraping, credential harvesting, cookie extraction, session-token storage, header exfiltration, hidden tracking, or request tampering.
- Deep Capture must mean: collecting vehicle/listing/business data that the authenticated client is already authorized to view in their own browser session.
- Terms/Privacy language does not override third-party platform terms. Add language requiring the client to confirm they are authorized to use Dealer Flow on the relevant platform/account.
- Do not store authorization headers, cookies, session tokens, passwords, CSRF tokens, JWTs, refresh tokens, or unrelated personal data.
- If buyer/client/seller personal information appears in captured content, redact it unless it is strictly necessary for a clearly disclosed Dealer Flow feature.
- Use data minimization: store normalized vehicle fields, evidence snippets, endpoint patterns, confidence/provenance, and capped payloads; avoid raw full responses unless explicitly necessary and retention-limited.
- Keep active bids/current offers as observation features only. They must not become ML training labels unless later connected to a verified outcome, manual confirmation, accepted negotiation, invoice, or Dealer Flow sale.
- Every changed file must be read before editing. Follow existing architecture, naming style, TypeScript strictness, RLS/security patterns, and tests.
- Run lint/build/tests where available. If a command cannot run, explain exactly why and what remains unverified.
- Produce a final implementation report with changed files, behavior before/after, security/privacy notes, tests run, and deployment/migration instructions.


## Specific task

Act as a senior browser-extension engineer. Implement the extension-side consent gate and settings flow for Deep Capture.

## Product behavior

Use this exact behavior:

- For new installs or users with no active consent:
  - Basic visible DOM extraction can run as before.
  - Deep Capture/network observation is OFF.
  - The widget/options page shows a clear prompt to enable Deep Capture.
- When an authorized user accepts the Deep Capture consent:
  - Store the consent server-side through the backend.
  - Store local extension state that Deep Capture is enabled for that organization/user/install.
  - Deep Capture becomes ON by default for future OpenLane pages in that same consenting context.
- When the user withdraws consent:
  - Deep Capture turns OFF immediately.
  - Local settings are updated.
  - Server consent status is withdrawn.
  - Current page capture stops using network/deep evidence.

## UI requirements

Update the options page and/or widget to include:

- Deep Capture status badge:
  - Off — consent needed
  - On — active consent
  - Paused — backend unreachable
  - Requires renewal — consent version changed
- A clear modal or panel:
  - What data is collected
  - What is not collected
  - What it is used for
  - Risks/limits
  - Withdrawal instructions
- Two separate toggles:
  - Deep Capture
  - Model Improvement
- Model Improvement cannot be forced on by Deep Capture consent.
- Add “View captured JSON” / “Copy extracted JSON” path only with secrets redacted.

## Technical requirements

1. Inspect existing:
   - `browser-extension/src/storage.js`
   - `browser-extension/src/api-client.js`
   - options and popup files
   - `content-script.js`
   - `market-snap-widget.js`
2. Add extension settings:
   - `deepCaptureEnabled`
   - `deepCaptureConsentId`
   - `deepCaptureConsentVersion`
   - `deepCaptureConsentAcceptedAt`
   - `deepCaptureConsentStatus`
   - `modelImprovementOptIn`
3. Keep `observePageNetworkData` false unless:
   - `deepCaptureEnabled === true`
   - active consent exists
   - backend validates the consent
4. Add API methods:
   - `getDeepCaptureConsentStatus`
   - `acceptDeepCaptureConsent`
   - `withdrawDeepCaptureConsent`
5. Avoid collecting deep data before consent verification.
6. If the backend is unreachable:
   - fail closed for Deep Capture
   - keep basic DOM extraction if safe
   - show a clear warning
7. If extension already has an options page, enhance it instead of creating a second disconnected settings UI.

## “On by default” interpretation

After active consent exists, Deep Capture should auto-start for supported OpenLane pages without asking again every time. But it must remain obvious in the widget and settings that it is active, and withdrawal must be one click away.

Do not silently enable Deep Capture for users who never accepted it.

## Acceptance criteria

- Deep Capture is not active until explicit consent.
- After consent, it stays enabled by default for the consenting context.
- Withdrawal immediately disables deep capture.
- Basic extraction still works without deep consent.
- User can see what is happening.
- No tokens/cookies/credentials are stored.
- Model improvement has independent consent.

## Tests

Add or update tests for:

- default settings
- accepting consent
- withdrawing consent
- backend unavailable
- old consent version
- storage migration from old settings
- content script not starting network observer without consent
- content script starting network observer after active consent

Run:

```bash
npm run lint
npm run build
npm test
```

## Final Codex response format

Return:

1. Summary
2. Extension settings/UI changes
3. Consent-gating behavior
4. Files changed
5. Tests run and results
6. Manual test steps in Chrome/Brave
7. Risks/loopholes found and fixed

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
