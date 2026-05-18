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


# Phase 09 — Runtime, Widget, and Debug Integration

## Mission

Integrate the deep extraction engine into the extension runtime and widget.

## Root problem

Users need to know what was captured, why a value was chosen, and why a field is missing.

## Consequences

Second order: live bugs require guesswork.  
Third order: users cannot trust widget output.  
Fourth order: production rollout becomes unstable.

## Required solution

Runtime:
- classify page
- build section map
- safe expand if enabled
- observe page-generated network data if enabled
- score field candidates
- map to legacy payload
- analyze listing
- capture observation/outcome
- debounce and dedupe

Widget:
- draggable/collapsible/hideable
- shows vehicle identity, VIN status, current bid, buy price, pageType, captureKind, Carfax status, photo/video count
- shows condition/dealer-note warnings
- data quality panel shows confidence, top evidence, rejected candidates
- Copy JSON includes normalized extraction, legacy payload, section map, candidate scores, backend/capture responses
- debug mode logs decisions without secrets

## Acceptance criteria

- Widget does not block bid controls.
- Copy JSON explains missing VIN/Carfax/condition clearly.
- Bid update refreshes widget.
- Settings can be changed inside widget.


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
