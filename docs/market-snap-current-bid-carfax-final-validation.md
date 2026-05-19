# Market Snap Current Bid And Carfax Final Validation

## Summary

The OpenLane current-bid and CARFAX fixes are covered by automated regression tests and production build validation. The extension now prioritizes trusted active bid bar evidence, rejects bid/media/disclosure/transport counters, exposes lower ignored bid rows in Copy JSON and widget debug, preserves active listing observation semantics, and keeps CARFAX URL recovery limited to safe DOM/router/network evidence.

## Current Bid Validation

- `openlane-vdp-active-current-bid-with-lower-history-row.html` selects `currentBid = 21000`, not `11100` and not `2`.
- `openlane-vdp-active-current-bid-before-label-4-bids.html` selects `currentBid = 13700`, not `4`.
- `openlane-vdp-active-current-bid-29-bids.html` selects `currentBid = 5100`, not `29` and not the transport estimate.
- `fieldEvidence.currentBid.sourceType` identifies trusted active bid bar or network JSON sources.

## Listed Price Validation

Active OpenLane listed price is controlled by explicit semantics. When it mirrors current bid for display, `priceSemantics.listedPrice = "observation_alias_current_bid"`. Tests assert `listedPrice` does not become bid counts, lower history rows, or transport estimates.

## Price Evidence Validation

Rejected candidates now include reasons such as `bid_count_not_money`, `media_count_not_money`, `disclosure_count_not_money`, `transport_estimate_not_vehicle_price`, and `lower_bid_history_candidate`. Backend validation rejects canonical price evidence sourced from bid counts, transport estimates, active-outcome contamination, or unsupported semantics.

## Carfax Validation

CARFAX stays truthful:

- `url_found` only when a safe URL exists in DOM attributes, router metadata, or allowed network JSON.
- `text_only` when only CARFAX text/button evidence is visible.
- Static assets, unsafe protocols, token-like query fields, and non-report URLs are rejected.

## Network Observer Validation

Network observer diagnostics expose hook state, queue flush state, allowed/denied/irrelevant/duplicate/parse-error counts, endpoint patterns, and a concise explanation when evidence is absent. It remains consent-gated and does not capture headers, cookies, authorization values, credentials, or account/profile/payment endpoints.

## Backend Guard Validation

Backend payload validation guards active listing observations, outcome fields, low-price evidence, bid-count evidence, transport evidence, unsafe URLs, and training export labels. Existing ML/export tests confirm active bids are not supervised labels.

## Commands Run

- `npm run verify:extension` - passed.
- `npm test` - passed.
- `npm run lint` - passed.
- `npm run build` - passed.

`python -m pytest` was not run because this ZIP did not change ML service files.

## Manual Browser Results

Not performed in this environment because it does not have the user's authenticated OpenLane session. Required live checks remain:

- Reload the unpacked extension in `chrome://extensions`.
- Open the live Camry page and confirm `currentBid = 21000`, rejected `2 Bids`, ignored `$11,100`.
- Open the live Kia Stinger page and confirm `currentBid = 13700`, rejected `4 Bids`.
- Open the Hyundai active page and confirm `currentBid = 5100`, rejected `29 Bids`.
- Confirm CARFAX is `url_found` only when a real URL exists, otherwise `text_only`.
- Save a clean payload to Deal Radar and verify no outcome/training contamination.

## Remaining Risks

OpenLane may change its live SPA markup or network endpoint names. The implementation mitigates this with source diagnostics, capped evidence, fixtures for known failure shapes, backend guardrails, and truthful `text_only` CARFAX fallback.

## Rollback Plan

Revert these commits in reverse order if needed:

1. Widget/Copy JSON lower-bid diagnostics.
2. Current-bid resolver diagnostics.
3. Strict current-bid money parser.
4. Active bid bar section-map zone.
5. Fixture/audit additions.

Backend validation and security guards should not be weakened during rollback unless a specific false positive is reproduced with safe evidence.

## Final Go/No-Go

Automated validation is GO. Live release remains NO-GO until the manual Chrome/OpenLane checks above are completed in the authenticated dealer profile.
