# Phase 06 — Backend Persistence, Retention, and ML Training Guards

## Goal

Persist Deep Capture data cleanly and safely, enforce retention/minimization, and protect ML training exports from polluted labels.


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

Act as a senior backend/data engineer. Update Market Snap persistence so Deep Capture payloads are stored in a normalized, auditable, retention-aware way without turning observations into labels.

## Required storage behavior

The backend should separate:

1. Vehicle identity
2. OpenLane observations
3. OpenLane candidate outcomes
4. OpenLane verified outcomes
5. Field evidence/provenance
6. Deal Radar saved listings
7. Training export rows

Current architecture already has some of this. Enhance it instead of duplicating.

## Data retention/minimization

Implement or verify:

- Raw visible text capped.
- Network JSON evidence capped and redacted.
- Full raw response bodies are not stored unless there is a strong documented reason.
- Unsaved market captures expire.
- Saved Deal Radar listings persist as business records.
- Deep Capture evidence has retention metadata:
  - `retention_policy`
  - `expires_at`
  - `capture_level`
  - `consent_id`
  - `source_type`
- Add cleanup job/documentation if no cleanup exists.

## Training guard rules

Enforce these rules in code/tests:

- `currentBid`, `currentOffer`, `bestOffer`, `buyNowPrice` on active listing = feature only, never label.
- `soldPriceCandidate` on pending/candidate post-sale = not a training label.
- `acceptedAmount`, `negotiatedAmount`, `finalBidAmount` only become wholesale labels if capture is `verified_outcome` or `manual_confirmation`.
- `buyPriceAuction`, `totalInvoiceAmount`, `finalAcquisitionCost` only become labels from verified fee/invoice/purchase context.
- Dealer Flow retail sale records are retail labels only when active and not voided.
- Model improvement must require separate opt-in.

## Implementation requirements

1. Inspect existing:
   - `src/lib/market-snap/repository.ts`
   - `src/lib/market-snap/training-export.ts`
   - Market Snap migrations
   - validation schemas and types
2. Add/adjust DB columns or tables only if necessary.
3. Add consent checks before saving deep evidence.
4. Add retention and cleanup logic if missing.
5. Add data-quality scoring for:
   - source type
   - evidence confidence
   - missing fields
   - raw vs typed source
   - page type
6. Update training export tests to prove polluted labels are excluded.
7. Ensure migrations are safe and deployable.

## Acceptance criteria

- Deep Capture payloads are linked to consent/version/provenance.
- Sensitive fields are redacted before persistence.
- Retention metadata exists and is used.
- Training exports do not use active bids as labels.
- Verified outcome rules are covered by tests.
- Existing Deal Radar and valuation flows still work.

## Required validation

Run:

```bash
npm run lint
npm run build
npm test
```

If database tests/tooling exist:

```bash
supabase db reset
supabase test db
```

Also run any targeted Market Snap tests.

## Final Codex response format

Return:

1. Summary
2. Persistence changes
3. Retention/minimization behavior
4. Training guard behavior
5. Migration/deployment instructions
6. Tests run and results
7. Risks/loopholes found and fixed

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
