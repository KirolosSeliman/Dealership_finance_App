# Phase 4 — Purchase Fee Details Outcome Extractor

## /goal

Extract verified purchase and fee data from OpenLane Purchases/Fee Details pages so Dealer Flow can learn true wholesale and acquisition outcomes.

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

The strongest wholesale/acquisition labels are on purchase/fee pages, not active bid pages. Current extraction focuses on active listings and cannot reliably capture Buy price - auction, transaction fee, vehicle history fee, taxes, total, paid status, and purchase state.

## Second, Third, and Fourth Order Consequences

- Wholesale model lacks verified final auction purchase prices.
- Acquisition cost model lacks all-in totals.
- Dealer must manually enter data visible on OpenLane.
- Active bids may still be overused because verified outcomes are not captured.

## Production-Grade Solution

Build purchase/fee extraction that maps purchase economics into verified outcome fields, separating wholesale buy price from all-in acquisition cost.

## Implementation Requirements

- Classify purchase_list, purchase_detail, fee_details, purchase_info.
- Extract vehicle card identity: VIN, title, sale date, seller/dealer, release form status, title status, inspection, transport.
- Extract fee values: Buy price - auction, Transaction Fee, Vehicle history - auction, Subtotal, Taxes, Total, currency, Paid status.
- Map Buy price - auction to buyPriceAuction.
- Map Total to totalInvoiceAmount/finalAcquisitionCost.
- Store fees separately and do not merge them into wholesale label.
- Set captureKind verified_outcome only when purchase/fee context is visible.
- If fee details are absent, save identity/candidate purchase context only.
- Add Copy JSON support for outcome extraction.

## Verification Requirements

- Fixture for purchase list + selected fee details panel.
- Test buy price 6900, transaction fee 280, vehicle history fee 46.55, subtotal 7226.55, taxes 939.45, total 8166.
- Test buyPriceAuction and totalInvoiceAmount are distinct.
- Test missing fee details does not create verified outcome.
- Run all verification commands.

## Deliverables

- Purchase/fee details extractor.
- Outcome fields in payload.
- Tests for purchases and fees.
- No ML training consumption yet.

## Final Self-Check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
