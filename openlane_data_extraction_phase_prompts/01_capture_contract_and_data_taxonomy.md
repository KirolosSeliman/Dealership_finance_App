# Phase 1 — Capture Contract and Data Taxonomy

## /goal

Create the formal OpenLane capture contract that separates vehicle identity, observations, candidate outcomes, verified outcomes, wholesale labels, retail labels, and acquisition-cost labels.

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

The current system can extract prices, but the meaning of each price is ambiguous. A current bid, buy-now price, post-sale displayed price, negotiated accepted price, auction buy price, invoice total, and retail sale price can accidentally be mixed.

## Second, Third, and Fourth Order Consequences

- Live bids can poison the wholesale model if treated as final labels.
- Invoice totals can be confused with wholesale price if fees/taxes are not separated.
- Negotiated outcomes cannot be learned if they are stored as the same thing as final bid.
- Downstream ML cannot filter safe labels without source page type and outcome confidence.

## Production-Grade Solution

Define a typed, validated data taxonomy before deeper extraction work. Active pages produce observations. Purchase/fee pages and confirmed negotiations produce outcomes. Every price field must have clear semantics.

## Implementation Requirements

- Inspect `src/types/market-snap.ts`, `src/lib/market-snap/validation.ts`, repository functions, migrations, and extension payloads.
- Add/refine types for page type, capture kind, observation, outcome, outcome confidence, and price semantics.
- Page types: active_listing, watchlist, pending, closing, post_sale, purchase_list, purchase_detail, fee_details, purchase_info, documents, unknown.
- Capture kinds: observation, candidate_outcome, verified_outcome, manual_confirmation.
- Price fields: currentBid, buyNowPrice, soldPriceCandidate, finalBidAmount, negotiatedAmount, buyPriceAuction, transactionFee, vehicleHistoryFee, otherFees, taxes, totalInvoiceAmount, finalAcquisitionCost.
- Document that current bids are features only and must never be final labels.
- Update validation without breaking existing Market Snap payloads.
- Add tests proving ambiguous final-price misuse is rejected.

## Verification Requirements

- Active listing payload cannot set verified outcome unless required outcome fields exist.
- currentBid is accepted as observation but not as finalBidAmount by default.
- purchase fee payload can carry buyPriceAuction, fees, taxes, totalInvoiceAmount.
- Run npm run verify:extension, npm test, npm run lint, npm run build.

## Deliverables

- Updated types/validation.
- Tests for price semantics.
- Documentation/comments for observation vs outcome.
- No broad UI changes in this phase.

## Final Self-Check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
