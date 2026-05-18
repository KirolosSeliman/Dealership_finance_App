# Phase 05 — Unified Evidence, Provenance, and Confidence Contract

## Goal

Create a reliable extraction contract where every important extracted field has source evidence, confidence, and provenance, so Dealer Flow can distinguish visible observations from verified outcomes.


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

Act as a senior data/platform engineer. Refactor or extend the OpenLane extraction contract so fields are not just flat values. Each important value should have evidence and confidence.

## Required normalized model

Add or update a normalized evidence structure like:

```ts
type ExtractionFieldEvidence = {
  field: string;
  value: unknown;
  normalizedValue?: unknown;
  sourceType:
    | "dom_label"
    | "dom_attribute"
    | "section_map"
    | "network_json"
    | "safe_expansion"
    | "fee_page"
    | "post_sale_page"
    | "manual_confirmation"
    | "fallback_regex";
  sourceName?: string;
  sourceText?: string;
  endpointPattern?: string;
  pageType?: string;
  captureKind?: string;
  confidenceScore: number;
  capturedAt: string;
  consentId?: string;
};
```

Create or enhance sections:

- `identity`
- `auctionObservation`
- `purchaseOutcome`
- `condition`
- `media`
- `carfax`
- `debug`

## Required field priorities

- VIN:
  - network typed field or data-vin attribute should outrank raw visible text
- Mileage:
  - exact Odometer/Mileage label should outrank random KM regex
  - never confuse trim/cab/engine numbers for mileage
- Current bid/current offer:
  - must stay observation, not outcome
- Buy now price:
  - observation unless on verified fee/outcome page
- Sold/accepted/final price:
  - candidate unless capture kind is verified outcome/manual confirmation
- Fee details/invoice:
  - can create acquisition cost fields only if classified as fee details / verified outcome
- Carfax:
  - distinguish URL found vs text only
- Condition:
  - keep known history, disclosure, safety, mechanical, exterior, interior, tires, OBD2 separate

## Implementation requirements

1. Inspect current `openlane-extraction-contract.js`.
2. Do not break legacy payload consumers.
3. Add new structured field evidence while preserving existing flat fields.
4. Add helper functions:
   - `addFieldEvidence`
   - `chooseBestEvidence`
   - `normalizeEvidenceValue`
   - `redactEvidence`
   - `scoreEvidence`
5. Include consent/provenance where Deep Capture data was used.
6. Add debug summaries that are helpful but do not expose sensitive raw data.
7. Update backend validation types if needed.

## Acceptance criteria

- Every key field has at least one evidence record when extracted.
- Best value selection is deterministic and testable.
- Network evidence improves confidence but does not blindly overwrite verified source values.
- Active listing price values are not mislabeled as final outcome.
- Backward compatibility is preserved.
- Extracted JSON remains readable for debugging.

## Tests

Create or update fixture tests for:

- active OpenLane listing with VIN in DOM attribute
- lazy media URLs
- disclosure count
- Carfax text-only vs URL
- fee-details page
- post-sale pending page
- accepted negotiation page
- conflicting field evidence where higher confidence wins
- sensitive evidence redaction

Run:

```bash
npm run lint
npm run build
npm test
```

## Final Codex response format

Return:

1. Summary
2. Contract changes
3. Evidence/confidence rules
4. Backward compatibility notes
5. Tests run and results
6. Example sanitized extraction payload
7. Risks/loopholes found and fixed

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
