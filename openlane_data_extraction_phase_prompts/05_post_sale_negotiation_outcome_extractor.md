# Phase 5 — Post-Sale and Negotiation Outcome Extractor

## /goal

Extract OpenLane post-sale and negotiation information while keeping uncertain prices separate from verified final outcomes.

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

Post-sale pages may show a sold price, but negotiation can change the final accepted amount. A displayed sold/post-sale amount is not automatically a verified training label.

## Second, Third, and Fourth Order Consequences

- Candidate prices can poison wholesale labels.
- Negotiated outcomes are lost if not captured separately.
- Model cannot learn divergence between bids and accepted prices.
- User may trust a price before it is actually accepted/paid.

## Production-Grade Solution

Create strict post-sale/negotiation extraction. Candidate values remain candidate outcomes until accepted/paid/confirmed evidence is visible or the user confirms manually.

## Implementation Requirements

- Classify post_sale and negotiation pages using Post Sale, Sold Price, Negotiation, Accepted, Rejected, Pending, Counter Offer, Paid, Purchase context.
- Extract soldPriceCandidate, negotiatedAmount, counterOfferAmount, acceptedAmount, negotiationStatus, relevant dates/timestamps.
- Default post-sale amounts to candidate_outcome.
- Promote to verified_outcome only with accepted/completed/paid/purchase-confirmed evidence.
- Add user confirmation hooks: userConfirmedFinalPrice, confirmedAt, confirmationNote.
- Link to earlier observations by VIN/listing URL.
- Never train candidate outcomes by default.

## Verification Requirements

- Fixtures for post-sale pending, accepted negotiation, rejected negotiation, and ambiguous sold price.
- Pending post-sale stays candidate.
- Accepted/paid evidence can become verified.
- Run all verification commands.

## Deliverables

- Post-sale/negotiation extractor.
- Candidate vs verified logic.
- Tests.
- Documentation of safe training status.

## Final Self-Check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
