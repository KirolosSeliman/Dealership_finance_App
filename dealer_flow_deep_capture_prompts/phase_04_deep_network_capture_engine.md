# Phase 04 — Deep Capture Network Observation Engine

## Goal

Strengthen the current OpenLane network observation system so it extracts cleaner vehicle/listing JSON data after consent, while remaining passive, scoped, sanitized, and safe.


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

Act as a senior browser-extension/security engineer. Improve the existing OpenLane network observer and page hook so Deep Capture can use browser-loaded JSON responses as a high-confidence data source.

## Important implementation direction

Prefer enhancing the existing files:

- `browser-extension/src/openlane-network-observer.js`
- `browser-extension/src/openlane-network-page-hook.js`
- `browser-extension/src/content-script.js`
- `browser-extension/src/openlane-extractor.js`
- `browser-extension/src/openlane-extraction-contract.js`

Do not add powerful APIs such as `chrome.debugger`, `chrome.cookies`, or `webRequestAuthProvider`.

If you introduce `chrome.webRequest`, use it only for passive metadata/URL observation with optional permissions and clear UI. Do not intercept, modify, cancel, redirect, or replay requests.

## Deep Capture scope

Allowed after consent:

- Observe JSON response bodies already loaded by the OpenLane frontend in the client browser.
- Extract vehicle-related candidates:
  - VIN
  - year/make/model/trim
  - mileage
  - current bid/offer/buy-now
  - media URLs
  - condition/disclosure/known history/dealer notes/Q&A
  - fee/invoice/post-sale fields when visible in loaded JSON
- Capture endpoint pattern, content type, candidate keys, and evidence.
- Cap payload sizes and response counts.

Not allowed:

- Request headers
- Response headers containing auth/session data
- Cookies
- Authorization bearer tokens
- CSRF tokens
- Passwords
- Session IDs
- Hidden account data unrelated to the current vehicle/listing
- Background crawling of URLs that the page did not naturally load
- Replaying API calls from Dealer Flow servers
- Generating synthetic OpenLane API calls outside the user’s normal browsing interaction

## Implementation requirements

1. Consent gate:
   - The observer must not start unless `deepCaptureEnabled` and valid consent are present.
2. Endpoint filtering:
   - Maintain a strict allowlist of relevant OpenLane/KAR endpoint patterns.
   - Add a denylist for auth/profile/account/payment/session endpoints.
3. Payload sanitation:
   - Redact keys matching auth, authorization, cookie, token, secret, session, password, csrf, jwt, bearer.
   - Redact emails and phone numbers unless explicitly needed and disclosed.
   - Cap depth, array length, string length, and total stored payload size.
4. Candidate extraction:
   - Build structured candidates with:
     - `field`
     - `value`
     - `source`
     - `endpointPattern`
     - `confidence`
     - `sourceText` capped/redacted
     - `capturedAt`
5. Merge logic:
   - Network evidence can fill missing DOM fields or increase confidence.
   - It should not blindly overwrite high-confidence DOM/invoice values unless the source confidence is higher.
6. Debugging:
   - In debug mode, show counts and candidate summaries, not raw full payloads.
7. Safety:
   - Observer failures must never break OpenLane page functionality.

## Suggested field confidence

Use a priority model like:

- Verified invoice/fee page label: 98
- Network JSON exact typed field: 92
- DOM exact label/value pair: 85
- Section-map zone text: 75
- Raw visible text regex: 55
- Heuristic fallback: 35

## Acceptance criteria

- Deep network observation is impossible without consent.
- Only relevant vehicle/listing JSON is used.
- Sensitive data is redacted before storage/debug output.
- Cleaner data is merged into extraction payload with evidence/provenance.
- The page still works normally.
- The extension does not send credentials, cookies, tokens, or headers to Dealer Flow.

## Tests

Add tests for:

- consent off -> observer disabled
- consent on -> observer enabled
- irrelevant endpoint ignored
- auth/session endpoint ignored
- token/cookie/email redaction
- VIN/media/condition candidate extraction
- network candidate merges missing VIN/photos/condition
- network candidate does not overwrite verified invoice/fee value incorrectly
- payload size/depth caps

Run:

```bash
npm run lint
npm run build
npm test
```

## Final Codex response format

Return:

1. Summary
2. Observer changes
3. Consent gate behavior
4. Sanitization/redaction rules
5. Candidate extraction model
6. Tests run and results
7. Manual OpenLane test steps
8. Risks/loopholes found and fixed

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
