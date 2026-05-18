# Phase 10 — Training Dataset Export and ML Label Safety

## /goal

Protect ML training exports so only verified outcomes are labels and observations are features.

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

Correct extraction/storage is not enough. Training exports can still poison models if they use active bids or candidate outcomes as target labels.

## Second, Third, and Fourth Order Consequences

- Wholesale model learns unfinished bids.
- Acquisition model mixes buy price and invoice total.
- Retail and wholesale models train on incompatible outcomes.
- Confidence/recommendations become misleading.

## Production-Grade Solution

Create safe dataset export logic. Wholesale, acquisition, and retail labels must be separate. Active observations are features only. Candidate outcomes are excluded unless confirmed.

## Implementation Requirements

- Define export views/functions for wholesale, acquisition cost, and retail datasets.
- Wholesale label: buyPriceAuction, negotiatedAmount, or final accepted price from verified/user-confirmed outcomes.
- Acquisition label: finalAcquisitionCost or totalInvoiceAmount from verified purchase/invoice data.
- Retail label: Dealer Flow customer sale price or verified retail outcome, not OpenLane active bids.
- Active observation features may include currentBid, timeRemaining, bidCount, disclosureCount, photoCount, page state, bid velocity.
- Exclude observation_only, candidate_outcome, pending negotiation, missing final amount.
- Add data quality report: usable outcomes, rejected records by reason, confidence distribution.
- Do not train/promote CatBoost here unless already explicitly supported.

## Verification Requirements

- Tests prove active bids are excluded from labels.
- Purchase fee details included as verified wholesale/acquisition labels.
- Pending post-sale excluded until confirmed.
- Retail labels come from Dealer Flow sales, not OpenLane purchase pages.
- Run all verification commands.

## Deliverables

- Safe dataset export logic.
- Label filters.
- Data quality report.
- Tests for no label contamination.

## Final Self-Check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
