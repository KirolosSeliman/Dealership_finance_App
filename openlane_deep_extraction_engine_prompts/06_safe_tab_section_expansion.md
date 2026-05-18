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


# Phase 06 — Safe Read-Only Tab and Accordion Expansion

## Mission

Capture data behind OpenLane tabs/accordions without triggering destructive actions.

## Root problem

Important data may be hidden behind tabs: known history, disclosures, dealer notes, Q&A, fee details, purchase info, documents.

## Consequences

Second order: initial DOM misses important fields.  
Third order: extraction is incomplete despite user authorization.  
Fourth order: valuation misses major risk/cost data.

## Required solution

Add:
`browser-extension/src/openlane-safe-expander.js`

Allowed:
- open read-only tabs/accordions for condition, known history, dealer notes, Q&A, fee details, purchase info, documents metadata
- wait for content
- snapshot text/media/links

Forbidden:
- bid/offer/proxy actions
- watch/unwatch
- comments/Q&A submissions
- mark retrieved
- order services
- Carfax purchase/access bypass
- any form submission

Implementation:
- whitelist safe labels/selectors
- blacklist dangerous labels
- max step count and timeout
- idempotent, no repeated clicking
- preserve scroll when possible
- return section snapshots, do not directly decide fields

## Acceptance criteria

- Hidden disclosure/dealer-note test fixture becomes extractable.
- Dangerous controls are never clicked.
- No infinite loop or page-breaking behavior.


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
