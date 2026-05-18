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


# Phase 12 — Release and Manual OpenLane Verification

## Mission

Create and execute the final release verification checklist.

## Root problem

Only live OpenLane testing proves the extension works in production-like conditions.

## Required automated commands

```bash
npm run verify:extension
npm run verify:release
```

## Manual live matrix

Test:
1. French active VDP.
2. English active VDP.
3. VDP with purchase selling price.
4. Purchase fee details.
5. Post-sale pending.
6. Post-sale accepted.
7. Carfax URL page.
8. Video page.
9. Bid update page.
10. Unsupported/search page.

For each, verify:
- widget appears only when appropriate
- title/year/make/model/trim correct
- VIN extracted if visible
- mileage correct
- current bid observation only
- Carfax state truthful
- photos/videos clean
- disclosures/dealer notes structured
- Supabase rows correct
- no duplicate spam
- no outcome from active bid

## Supabase queries

Check:
- `openlane_vehicle_identities`
- `openlane_observations`
- `openlane_outcomes`

## Acceptance criteria

- No unresolved extraction-critical failures.
- Private beta only if matrix passes.
- Official launch only after multiple real users/pages/languages pass.


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
