# Phase 08 — End-to-End Testing, Security Review, and Deployable Release

## Goal

Perform a strict final verification that Deep Capture is secure, consent-gated, cleanly deployable, and does not break existing Dealer Flow/Market Snap functionality.


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

Act as a senior release engineer, security reviewer, and QA lead. Do not add new product scope unless required to fix a release-blocking issue. Audit the implementation from Phases 01–07, fix gaps, and prepare the release.

## Full audit checklist

### Consent/privacy

- Deep Capture is off without explicit consent.
- After consent, Deep Capture stays on by default for that consenting context.
- Withdrawal disables Deep Capture immediately.
- Model improvement is separate from Deep Capture.
- Terms/Privacy/Consent versioning is enforced.
- User can review what they accepted.
- No misleading copy.
- Consent does not claim to override third-party platform terms.

### Extension security

- No cookies/tokens/passwords/authorization headers collected.
- No CAPTCHA bypass or anti-bot bypass.
- No request replay from server.
- No hidden background crawling.
- Network observer only runs after valid consent.
- Extension fails closed when backend consent check fails.
- Debug output redacts secrets.
- Payload sizes/depths are capped.
- OpenLane page behavior is not broken.

### Backend security

- APIs enforce auth and organization role.
- APIs enforce active Deep Capture consent for deep payloads.
- RLS protects consent/capture data.
- Cross-org access is impossible.
- Rate limits still apply.
- Retention policy is clear.
- Sensitive fields are redacted before storage.

### Data quality

- VIN/mileage/title extraction chooses best evidence.
- Mileage is not confused with trim/cab/engine numbers.
- Current bid/current offer remain observations.
- Verified fee/outcome pages are separated from active listings.
- Training exports exclude candidate/pending/unverified labels.
- Evidence/confidence/provenance are stored.

### Regression

- Existing dashboard still builds.
- Existing inventory flows still work.
- Deal Radar save flow still works.
- Market Snap analyze flow still works.
- Basic extraction works without Deep Capture.
- Existing tests still pass.

## Required validation commands

Run all available commands. Start with:

```bash
npm install
npm run lint
npm run build
npm test
```

If present:

```bash
npm run typecheck
npm run test:unit
npm run test:e2e
npm run test:extension
supabase db reset
supabase test db
```

If Playwright/Chrome extension testing exists, run it. If not, create a clear manual QA script.

## Manual QA script required

Create or update a markdown QA checklist covering:

1. Load extension unpacked in Chrome/Brave.
2. Open Dealer Flow locally and sign in.
3. Open extension options.
4. Confirm Deep Capture is off before consent.
5. Open OpenLane active listing.
6. Confirm basic extraction works.
7. Accept Deep Capture consent.
8. Refresh OpenLane page.
9. Confirm Deep Capture badge is active.
10. Confirm network evidence appears only in sanitized debug/copy payload.
11. Save to Deal Radar.
12. Confirm backend persisted consent and capture.
13. Withdraw consent.
14. Refresh OpenLane page.
15. Confirm network observer no longer runs.
16. Confirm backend rejects deep capture.
17. Confirm basic extraction still works.
18. Confirm model improvement can be off while Deep Capture is on.
19. Confirm current bid is not training label.
20. Confirm build/deploy instructions.

## Release output

Produce:

- Final release notes
- Migration checklist
- Vercel deployment checklist
- Supabase migration checklist
- Chrome/Brave extension packaging checklist
- Rollback plan
- Known limitations
- Security/privacy assurance statement

## Acceptance criteria

- No release-blocking consent/security gap remains.
- All tests that can run have run.
- Any unverified parts are clearly listed.
- Deployment steps are precise.
- A rollback plan exists.
- The final result is production-reviewable by a senior engineer.

## Final Codex response format

Return:

1. Executive summary
2. Release readiness verdict: ready / blocked
3. All commands run with results
4. Security/privacy findings
5. Bugs fixed during audit
6. Remaining risks
7. Deployment steps
8. Rollback plan
9. Manual QA checklist location
10. Final file list

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
