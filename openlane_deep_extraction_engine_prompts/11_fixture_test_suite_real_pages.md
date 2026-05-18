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


# Phase 11 — Realistic Fixture and Regression Test Suite

## Mission

Build tests that catch real OpenLane extraction failures before production.

## Root problem

Automated tests passed while live pages still failed. Fixtures were not realistic enough.

## Required fixtures

Create or update:
- `openlane-vdp-active-fr-touareg.html`
- `openlane-vdp-active-en.html`
- `openlane-vdp-purchased-selling-price.html`
- `openlane-fee-details-realistic.html`
- `openlane-post-sale-pending.html`
- `openlane-post-sale-accepted.html`
- `openlane-carfax-url.html`
- `openlane-media-lazy-gallery.html`
- `openlane-hidden-tabs-disclosures.html`
- optional network sample JSON fixture

Tests must fail if:
- visible VIN is missing
- title becomes auction date
- Carfax URL visible but not extracted
- dealer notes/disclosures not structured
- logos/icons enter photos
- active bid becomes outcome
- VDP page becomes purchase_list because of sidebar
- fee total is confused with buy price
- condition warning says missing when sections are visible

## Acceptance criteria

- Tests cover English and French.
- Tests cover DOM-only and network-evidence paths if implemented.
- Tests cover all critical ML-ready fields.


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
