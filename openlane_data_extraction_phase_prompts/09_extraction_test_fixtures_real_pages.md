# Phase 9 — Realistic OpenLane Extraction Fixtures

## /goal

Create realistic OpenLane fixtures and tests so live DOM bugs are caught before manual testing.

## Codex Role

You are a senior data analyst, senior data engineer, senior software engineer, browser-extension engineer, database engineer, security reviewer, and production launch judge for Dealer Flow / Market Snap.

Repository: `KirolosSeliman/Dealership_finance_App`

Dealer Flow handles dealer inventory, OpenLane captures, purchase outcomes, valuation estimates, tax-sensitive financial flows, and future ML training data. Treat this as a real production system.

## Hard Rules

- Work only on this phase.
- Inspect the real repo before editing.
- Identify the root cause before writing code.
- Capture only visible data from pages the authenticated user opens and is authorized to view.
- Do not bypass login, CAPTCHA, Carfax paywalls, access controls, anti-bot systems, or rate limits.
- Current bids are observations/features, never final training labels.
- Purchase fee details, invoices, accepted negotiations, and user confirmations are outcome candidates.
- Store data with source, page type, timestamp, organization/user, confidence, and evidence.
- Keep raw visible text capped.
- Do not store secrets, session tokens, service-role keys, Supabase keys, passwords, or OpenLane credentials.
- Do not break existing Market Snap, Deal Radar, financial, backup, or extension flows.
- Add or update tests.
- Run verification before moving on.

## Root Cause

Earlier tests passed but live OpenLane extraction still failed. The fixtures did not cover the actual DOM/text traps visible in real pages.

## Second, Third, and Fourth Order Consequences

- Extractor bugs survive CI.
- Wrong mileage/VIN/photo/disclosure extraction silently returns.
- Backend tests can pass while extension data is bad.
- Future changes can reintroduce known bugs.

## Production-Grade Solution

Build fixture tests from realistic sanitized OpenLane layouts, including active listing, purchase fee details, post-sale, lazy media, disclosures, and unknown pages.

## Implementation Requirements

- Create fixtures under tests/fixtures/openlane.
- Include Silverado active listing trap: Odometer 40,100 KM followed by 4WD Crew Cab 157 RST.
- Include Kia Forte purchase/detail page with 56 photos, 22 disclosures, post-sale price.
- Include Hyundai fee details page with buy price 6900, transaction fee 280, vehicle history fee 46.55, taxes 939.45, total 8166.
- Include post-sale pending and accepted negotiation fixtures.
- Include no-price and unknown pages.
- Test exact expected fields and negative traps.
- Keep fixtures sanitized and free of unrelated personal data.

## Verification Requirements

- All fixture tests pass.
- Known real-page traps are explicitly tested.
- Run extension/full verification commands.

## Deliverables

- Fixture files.
- Extractor/classifier tests.
- Regression tests for known bugs.
- Documentation for adding future fixtures.

## Final Self-Check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
