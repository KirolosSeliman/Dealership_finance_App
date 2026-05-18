# Dealer Flow — OpenLane Deep Extraction Engine

Repository: `KirolosSeliman/Dealership_finance_App`

Role: You are Codex acting as a senior browser-extension engineer, senior data extraction engineer, senior software engineer, senior data analyst, security reviewer, and production QA lead.

Mission boundary:
- This is a first-party, user-consented, authorized page-capture system.
- Capture only OpenLane data visible to the logged-in user on pages the user opens.
- Do not bypass login, CAPTCHA, paywalls, Carfax access, rate limits, anti-bot systems, or private APIs.
- Do not place bids, submit forms, comment, watch/unwatch, mark retrieved, order services, or trigger destructive actions.
- Do not store credentials, service-role keys, session tokens, or raw secrets.
- Do not weaken validation, RLS, role checks, or financial data integrity.
- Keep the code clean, efficient, deployable, and backward-compatible.

Phase rule:
Work on this phase only. Do not move to the next phase until this one is fully implemented, tested, and verified.


# Phase 10 — Backend Validation and Persistence

## Mission

Make backend validation and persistence compatible with deeper extraction.

## Root problem

A richer payload can be dropped or become unsafe if validation/storage is not updated carefully.

## Consequences

Second order: ML-critical data is lost.  
Third order: too much unbounded data risks storage/security.  
Fourth order: production reliability degrades.

## Required solution

Update as needed:
- `src/types/market-snap.ts`
- `src/lib/market-snap/validation.ts`
- Market Snap repository/persistence

Validate:
- structured condition fields
- Carfax status
- media evidence/rejections
- candidate scores
- section map summary
- network summaries
- strict URL safety: http/https only, no script/data URLs
- caps for raw text, evidence, debug, media arrays

Persistence:
- observations/outcomes separated
- active bids only observations
- verified outcomes only with evidence
- no giant raw HTML/network blobs
- RLS remains organization-scoped
- no viewers writing captures unless allowed
- Deal Radar can show safe new fields

## Acceptance criteria

- Deep payload accepted safely.
- Unsafe URLs/oversized payloads rejected.
- Active bid cannot persist as outcome.
- No existing endpoints break.


## Verification required before completion

Run:

```bash
npm run verify:extension
npm run verify:release
```

Both must pass. If not, fix the root cause and rerun.

## Required final report

Report:
1. Root cause fixed.
2. Files changed.
3. Tests and fixtures added/updated.
4. Security/privacy impact.
5. Regression risks checked.
6. Results of `npm run verify:extension`.
7. Results of `npm run verify:release`.
8. Remaining risks.
9. Whether it is safe to move to the next phase.

## Final self-check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
