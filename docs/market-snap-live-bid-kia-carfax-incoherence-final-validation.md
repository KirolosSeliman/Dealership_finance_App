# Market Snap Live Bid / Kia / Carfax / Incoherence Final Validation

## Summary

Automated validation passed for the final OpenLane live-bid, Kia purchase, CARFAX, condition cleanup, network diagnostics, multi-word model, backend guard, and ML label-safety fixes.

This report does not claim authenticated live OpenLane browser validation. The local environment cannot access the user's logged-in Chrome/OpenLane session. Live Chrome validation remains the final release gate.

## Nissan Live Bid Validation

Automated fixture: `tests/fixtures/openlane/openlane-vdp-nissan-final-minute-bid-refresh.html`.

Validated by:

- `tests/openlane-extractor.test.ts`
- `tests/openlane-bid-live-monitor.test.ts`
- `tests/openlane-phase12-fixtures.test.ts`

Expected and covered:

- `pageType = active_listing`
- `captureKind = observation`
- `currentBid = 14200`
- stale sticky `13800` is rejected
- `71 Bids` is rejected as count text, not price
- bid-only live monitor updates from `13800` to `14200` without backend side effects

## Kia Purchase Sold Price Validation

Automated fixture: `tests/fixtures/openlane/openlane-vdp-kia-purchase-sold-price-picked-up-live.html`.

Expected and covered:

- `pageType = purchase_detail`
- `captureKind = verified_outcome`
- `soldPriceCandidate = 4000`
- `buyPriceAuction = 4000`
- `Mark as picked up` is treated as trusted purchase evidence only in the purchase panel context
- purchase `missingData` does not require `listedPrice` once sold price evidence exists

## Carfax Validation

Automated fixtures:

- `tests/fixtures/openlane/openlane-vdp-carfax-text-only-live.html`
- `tests/fixtures/openlane/openlane-network-carfax-url-live.json`

Expected and covered:

- visible CARFAX text without a safe URL remains `text_only`
- safe OpenLane network CARFAX URL becomes `url_found`
- token-like query parameters are stripped
- no CARFAX report content is fetched

## Condition Cleanup Validation

Automated fixture: `tests/fixtures/openlane/openlane-vdp-condition-section-boundary-noise.html`.

Expected and covered:

- no `Mechanical: Exterior`
- no `Exterior: Interior`
- no `Tire & wheels` header as a canonical tire/wheel value
- no bid history, current bid, legal footer, or transport estimate pollution in canonical condition fields

## Network Observer Validation

Automated fixtures:

- `tests/fixtures/openlane/openlane-network-observer-zero-evidence-live.json`
- `tests/fixtures/openlane/openlane-network-carfax-url-live.json`

Expected and covered:

- zero evidence state explains that no OpenLane vehicle JSON has been observed yet
- safe CARFAX/vehicle-history endpoint evidence is allowed and normalized
- sensitive profile endpoint diagnostics are denied without response body capture
- observer diagnostics do not expose authorization, cookie, or token values

## Multi-Word Model Validation

Automated fixture: `tests/fixtures/openlane/openlane-vdp-hyundai-santa-fe-sport-title.html`.

Expected and covered:

- `make = Hyundai`
- `model = Santa Fe Sport`
- `trim = SE`

Existing fixture coverage also protects Camry, Stinger, Mazda, Hyundai Tucson, Kia Forte, and Nissan Frontier parsing.

## Backend Guard Validation

Backend validation now rejects:

- bid-count evidence as canonical price data
- transport estimate evidence as canonical price/outcome data
- active listing payloads carrying outcome price fields
- observation payloads carrying verified/candidate outcome fields
- verified OpenLane outcomes without a valid VIN
- verified outcomes without verified price fields
- current bid semantics marked as a training label

Training export validation confirms:

- `currentBid` is observation feature data only
- `listedPrice` is not a training target
- `soldPriceCandidate` alone is not a verified label
- verified labels require eligible verified outcomes and model-improvement opt-in

## Commands Run

- `npm.cmd run verify:extension` - passed, 108/108 tests
- `npx.cmd tsx --test tests/market-snap-validation.test.ts tests/market-snap-training-export.test.ts` - passed, 35/35 tests
- `npx.cmd tsx --test tests/openlane-phase12-fixtures.test.ts` - passed, 4/4 tests
- `npm.cmd test` - passed, 327/327 tests
- `npm.cmd run lint` - passed
- `npm.cmd run build` - passed, Next.js production build completed

`ml-service` was inspected but not changed in these final phases, so `python -m pytest` was not required for the touched-file validation gate.

## Manual Browser Results

Pending. Must be performed in the user's authenticated Chrome or Brave profile:

1. Pull latest branch `codex/vehicle-safe-archive`.
2. Open `chrome://extensions`.
3. Reload the unpacked Dealer Flow Market Snap extension.
4. Configure Dealer Flow URL and organization ID.
5. Enable Auto-analyze, Capture observations/outcomes, Deep Capture, Observe page network data, Include media URLs, Include raw text, and Debug mode.
6. Keep Auto-save off for testing.
7. Keep Model improvement opt-in off unless explicitly testing training eligibility.
8. Open a live Nissan Frontier final-minute VDP and confirm `currentBid = 14200`, not `13800` or `71`.
9. Open the live Kia Forte purchase page and confirm `soldPriceCandidate = 4000`, `buyPriceAuction = 4000`, and no `listedPrice` missing-data noise.
10. Confirm CARFAX status is `url_found` only when a safe URL exists, otherwise `text_only`.
11. Confirm condition sections do not show header or bid/legal/footer pollution.
12. Confirm network diagnostics show early hook/allowed/denied state clearly.
13. Confirm Hyundai Santa Fe Sport parses as model `Santa Fe Sport` with trim `SE`.
14. Save only a clean payload to Deal Radar and confirm the saved record has the correct observation/outcome semantics.

## Remaining Risks

- Live OpenLane may expose additional SPA or network shapes not represented in the sanitized fixtures.
- Authenticated browser extension behavior still needs real Chrome validation because this environment cannot access the user's OpenLane session.
- GitHub reported two moderate Dependabot vulnerabilities on the default branch during push; they were not introduced by this phase but should be reviewed before release.

## Rollback Plan

If live validation finds a regression:

1. Keep the Phase 12 fixtures and tests.
2. Revert only the implementation commit that caused the regression.
3. Add a sanitized fixture for the newly observed live shape.
4. Re-run `npm.cmd run verify:extension`, `npm.cmd test`, `npm.cmd run lint`, and `npm.cmd run build`.

## Final Go/No-Go

Automated gate: Go.

Production release gate: No-Go until the manual authenticated Chrome/OpenLane validation above is completed and recorded.
