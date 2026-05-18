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


# Phase 03 — Vehicle Identity Candidate Scoring

## Mission

Create a candidate-scoring engine for VIN, title, year, make, model, trim, mileage, and specs.

## Root problem

The extractor accepts superficial matches. It selected auction datetime as title/year and missed visible VIN badges.

## Consequences

Second order: wrong vehicle identity enters Market Snap.  
Third order: wrong comparables and observations/outcomes are stored.  
Fourth order: ML learns from false labels/features.

## Required solution

Collect multiple candidates for each identity field and score them.

Candidate sources:
- vehicle hero/header zone
- VIN badge/copy button parent/sibling
- visible text nodes
- `aria-label`, `title`, `data-*`, `alt`
- vehicle specs zone
- later network evidence if available

VIN rules:
- exactly 17 characters, no I/O/Q
- prefer hero/title/copy badge source
- expose `vinCandidates` and chosen `vinEvidence`

Title rules:
- reject auction datetime lines like `2026 à 7:15 pm`
- reject `Launched`, `Encan démarré`, `Sales history`, `Historique des ventes`, `Market overview`
- prefer `year + make + model + trim`
- prefer candidate near VIN/mileage/gallery

Mileage rules:
- prefer `Odometer/Odomètre/Mileage`
- never confuse trim digits with mileage
- numeric km only

## Acceptance criteria

- Touareg fixture returns `2013 Volkswagen Touareg 4dr TDI`, not `2026 à 7:15 pm`.
- Visible VIN is extracted and `vinCandidates` is not empty.
- Silverado mileage is `40,100`, not `4,157`.
- Missing VIN only occurs when no DOM/attribute/network evidence exists, and debug explains it.


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
