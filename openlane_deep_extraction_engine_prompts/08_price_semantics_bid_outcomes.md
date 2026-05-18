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


# Phase 08 — Price Semantics, Bid Updates, and Outcomes

## Mission

Make every price field mean the right thing.

## Root problem

Active bids are observations, not final prices. Purchase pages, fee details, and accepted negotiations are different outcome sources.

## Consequences

Second order: wrong price can be used as label.  
Third order: wholesale model becomes wrong.  
Fourth order: users receive bad bid guidance.

## Required solution

Price categories:
- currentBid/currentOffer/bestOffer = observation only
- buyNowPrice = observation/offer unless purchase confirms
- soldPriceCandidate = candidate outcome
- acceptedAmount/negotiatedAmount/finalBidAmount = verified only with accepted evidence
- buyPriceAuction = wholesale purchase label
- transactionFee/vehicleHistoryFee/taxes = acquisition components
- totalInvoiceAmount/finalAcquisitionCost = all-in cost only when total is visible

Requirements:
- extract active bid from bidPanel
- extract VDP selling price from purchase/order block
- extract fee details exactly
- extract post-sale pending vs accepted
- MutationObserver updates when bid changes
- capture signature includes bid/offer/count changes
- active bid can never create outcome row

## Acceptance criteria

- Active VDP stores observations only.
- VDP selling price maps to buyPriceAuction, not finalAcquisitionCost unless fees/total exist.
- Fee details map exact invoice economics.
- Pending post-sale is not training eligible.
- Accepted post-sale is training eligible only with evidence.


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
