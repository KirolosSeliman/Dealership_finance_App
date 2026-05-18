# Phase 01 — Terms, Privacy Policy, and Consent Language for Deep Capture

## Goal

Create a legally cautious, product-ready Terms/Privacy/Consent foundation for a new Dealer Flow “Deep Capture Mode” that allows richer OpenLane/auction extraction only with clear client consent.

Important: do not silently enable deep access just because the Terms say so. The product may make Deep Capture remain ON by default after a user/admin explicitly accepts the consent, but it must not be pre-enabled for users or organizations that have not affirmatively consented.


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

Act as a senior full-stack engineer and privacy-conscious product architect. Find the existing legal, terms, privacy, settings, onboarding, and Market Snap pages. If legal pages do not exist, create a clean minimal structure that fits the current app architecture.

Implement draft legal/product copy for:

1. Terms of Service section: “Authorized Browser Data Capture”
2. Privacy Policy section: “Market Snap and Deep Capture”
3. Consent disclosure shown in the UI before Deep Capture can be enabled
4. Settings/help copy explaining capture levels
5. Changelog/version constant for the consent text

The copy must clearly explain:

- What Deep Capture does:
  - Reads vehicle/listing/business data visible to the client in their authenticated browser session
  - May read page DOM, safe expanded read-only sections, visible JSON responses already loaded by the page, media URLs, condition/disclosure details, bid/offer observations, post-sale or fee/invoice details when visible
- What it does not do:
  - No CAPTCHA bypass
  - No anti-bot bypass
  - No access to accounts the client cannot access
  - No credential/cookie/token/session capture
  - No hidden request manipulation
  - No unauthorized use of third-party systems
- Consent and authorization:
  - Client confirms they are authorized to use Dealer Flow with the third-party account/page
  - Client confirms they have the right to process vehicle/listing data for business operations, valuation, inventory, Deal Radar, reports, and model improvement if separately enabled
  - Client can withdraw consent
- Data categories:
  - Vehicle identity: VIN, year, make, model, trim, mileage
  - Listing economics: current bid, offer, buy-now, fees, invoice amounts, final acquisition cost when visible
  - Condition: known history, disclosures, mechanical, structural, exterior/interior, OBD2 status when visible
  - Media metadata: photo/video URLs and counts, not unnecessary unrelated images
  - Evidence/provenance: source type, confidence, capped snippets, endpoint pattern
- Sharing:
  - Data is stored in Dealer Flow/Supabase for the organization
  - It may be processed by Dealer Flow services for valuation and reporting
  - Do not claim it is shared with unrelated third parties unless the repo actually does that
- Retention:
  - Observations and raw/capped evidence should have retention limits
  - Saved Deal Radar/inventory records may be retained while the organization keeps them
- Model improvement:
  - Must be a separate toggle/consent from ordinary capture
  - Active current bids are not labels
  - Only verified outcomes/manual confirmations/Dealer Flow sales can become labels

## “On by default” product interpretation

Implement the policy copy and related constants around this rule:

- Basic visible-page extraction can remain normal behavior for Market Snap.
- Deep Capture must be default OFF for any user/org/install that has not accepted the current Deep Capture consent.
- Once an owner/admin explicitly accepts the Deep Capture consent for an organization, the app may default Deep Capture ON for that consenting organization/user until it is withdrawn.
- The UI must make this state visible and reversible.

Do not implement silent opt-in.

## Implementation requirements

1. Locate current legal/routes/layout:
   - Search for terms, privacy, legal, settings, onboarding, market-snap, extension docs.
   - If no legal pages exist, create minimal pages consistent with the app router/project style.
2. Add versioned constants:
   - `DEEP_CAPTURE_CONSENT_VERSION`
   - `DEEP_CAPTURE_TERMS_VERSION`
   - `DEEP_CAPTURE_PRIVACY_VERSION`
   - Put them in the best existing constants/config location or create one if needed.
3. Add legal copy in app UI and/or markdown docs:
   - Keep it plain English first.
   - If app supports French, add French strings or structure it for translation.
4. Add a developer note:
   - “This is a product/legal draft and must be reviewed by qualified legal counsel before production rollout.”
5. Do not over-collect or promise something impossible.
6. Keep copy accurate to actual code behavior. If the code does not yet support something, mark it as “planned” only in docs or avoid claiming it.

## Acceptance criteria

- There is a clear Terms section for Authorized Browser Data Capture.
- There is a clear Privacy section for Market Snap and Deep Capture.
- The consent copy is not buried only in Terms; it is available in-product.
- The wording states that Deep Capture requires affirmative consent and can be withdrawn.
- The wording states that consent does not authorize bypassing third-party platform protections or violating third-party rights.
- The wording separates normal capture, Deep Capture, and model improvement.
- The final report identifies the exact files changed and whether a legal review is still needed.

## Required validation

Run, where available:

```bash
npm run lint
npm run build
npm test
```

If the repo has targeted tests for legal pages/content snapshots, run those too.

## Final Codex response format

Return:

1. Summary
2. Files changed
3. Exact legal/consent behavior now
4. Security/privacy guardrails added
5. Tests run and results
6. Remaining legal review warning
7. Risks/loopholes found and fixed

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
