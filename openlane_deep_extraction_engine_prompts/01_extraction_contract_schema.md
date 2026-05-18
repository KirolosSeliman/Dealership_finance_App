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


# Phase 01 — Extraction Contract and Evidence Schema

## Mission

Define the deep extraction contract before changing field behavior.

## Root problem

The current extractor returns a loose listing object. It guesses fields from text, and later code cannot always tell whether a value came from the hero, bid panel, market guide, sidebar, footer, raw text, attributes, or page-loaded data.

## Consequences

Second order: wrong-looking values can look valid, such as `2026 à 7:15 pm` becoming vehicle title/year.  
Third order: Market Snap sends bad inputs to valuation and persistence.  
Fourth order: ML training data becomes polluted.

## Required solution

Create or formalize a central extraction contract, for example:

`browser-extension/src/openlane-extraction-contract.js`

The extraction output must support both legacy flat fields and structured evidence:

```js
{
  sourceName: "OpenLane",
  listingUrl,
  pageContext: { pageType, captureKind, outcomeConfidence, language, urlPattern, decisiveEvidence, ignoredEvidence },
  identity: { vin, year, make, model, trim, mileageKm, confidence, evidence },
  auctionObservation: { currentBid, currentOffer, bestOffer, buyNowPrice, bidCount, timeRemaining, evidence },
  purchaseOutcome: { buyPriceAuction, soldPriceCandidate, acceptedAmount, negotiatedAmount, finalBidAmount, transactionFee, taxes, totalInvoiceAmount, finalAcquisitionCost, evidence },
  condition: { knownHistoryItems, safetyDisclosures, mechanicalDisclosures, exteriorDisclosures, interiorDisclosures, tireWheelDisclosures, obd2Status, dealerNotes, conditionReportText, evidence },
  media: { photoCountVisible, videoCountVisible, photos, videos, rejectedMedia, evidence },
  carfax: { mentioned, available, url, urlStatus, evidence },
  debug: { sectionMapSummary, candidateScores, rejectedCandidates, warnings }
}
```

Keep existing flat fields working:
`vin`, `year`, `make`, `model`, `trim`, `mileageKm`, `currentBid`, `buyPriceAuction`, `photos`, `videos`, `carfaxUrl`, `carfaxUrlStatus`, etc.

## Acceptance criteria

- Existing extension and release tests still pass.
- A basic OpenLane fixture produces legacy fields and structured evidence fields.
- Raw visible text remains capped.
- No secrets/tokens/credentials appear in extraction output.


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
