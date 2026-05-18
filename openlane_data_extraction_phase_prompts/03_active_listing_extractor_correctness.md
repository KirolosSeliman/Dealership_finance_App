# Phase 3 — Active Listing Extractor Correctness

## /goal

Fix active OpenLane vehicle-page extraction so visible data is extracted correctly: VIN, mileage, year/make/model/trim, current bid, buy-now, photos, videos, disclosures, Carfax, location, and condition evidence.

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

Real OpenLane testing showed mileage wrong, VIN missing, photos missing, and disclosures incomplete. The root cause is brittle label/value parsing and regex against the real OpenLane DOM.

## Second, Third, and Fourth Order Consequences

- Wrong mileage corrupts retail and wholesale estimates.
- Missing VIN breaks deduplication, outcome linking, and inventory conversion.
- Missing photos/disclosures hide risk and lower model quality.
- Bad active observations make bid-trajectory features unreliable.

## Production-Grade Solution

Replace fragile extraction with stricter OpenLane-specific parsing. Prefer real DOM regions, robust label/value lookup, visible badge parsing, and evidence snippets. Never invent fields.

## Implementation Requirements

- Fix mileage so `Odometer 40,100 KM` returns 40100 and never parses `4WD Crew Cab 157` as 4157.
- Remove standalone `KM` as a dangerous label.
- Extract VIN from body text, header/title overlay, adjacent copy button text, aria labels, and data attributes.
- Parse truck titles and trims correctly, including Silverado 1500 and Crew Cab trims.
- Extract currentBid and buyNowPrice separately.
- Extract photo count from badges like `21 total` and `56 total` even if URLs are lazy-loaded.
- Extract photo URLs from img/currentSrc/srcset/data-src/data-original/background-image/gallery links without downloading blobs.
- Extract video count from badges like `0 videos` and video URLs if visible.
- Extract disclosure count and visible disclosure details from badges/sections.
- Extract Carfax URL if visible; otherwise mark available if only text is visible.
- Add evidence snippets to Copy JSON: sourceText, matchedLabel, matchedSelector if practical.

## Verification Requirements

- Fixture based on Silverado: VIN 1GCUDEE88RZ142915, mileage 40100, currentBid 50700, photos 21, disclosures 12, videos 0.
- Fixture based on Kia Forte: VIN 3KPFL4A78JE224744, mileage 163042, photos 56, disclosures 22, videos 0.
- Test `4WD Crew Cab 157` never becomes mileage.
- Test media count works when image URLs are lazy or extensionless CDN URLs.
- Run all verification commands.

## Deliverables

- Corrected active listing extractor.
- Realistic fixtures/tests.
- Improved debug payload.
- No outcome training changes in this phase.

## Final Self-Check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
