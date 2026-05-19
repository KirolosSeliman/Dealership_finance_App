# Market Snap Price And Carfax Final Validation

## Summary

This report covers the current-bid, listed-price, CARFAX URL/status, network diagnostics, and backend evidence-guard work completed on branch `codex/vehicle-safe-archive` through commit `ad96fde`.

Automated validation is passing. Live authenticated Chrome/OpenLane validation is still required because the local agent environment does not have access to the user's logged-in OpenLane session or the installed unpacked extension profile.

## Current Bid Validation

Automated fixture coverage now reproduces the live bug shape:

```txt
Current bid
4 Bids
$13,700
```

Validated behavior:

- `openlane-vdp-active-current-bid-with-bid-count.html` extracts `currentBid = 13700`.
- `openlane-vdp-active-current-bid-footer-fallback.html` extracts `currentBid = 8450` from a sticky footer/bottom bid area.
- `openlane-vdp-active-current-bid-no-money.html` leaves `currentBid` undefined when only `4 Bids` is present.
- Bid-count candidates such as `4 Bids` are kept as rejected debug evidence, not accepted canonical prices.

Live browser checks still required:

- 2018 Kia Stinger active VDP: confirm `currentBid = 13700`, not `4`.
- Hyundai active VDP: confirm `currentBid = 5100`, not `29` and not transport estimate.

## Listed Price Validation

Automated behavior:

- Active OpenLane `listedPrice` no longer blindly falls back to arbitrary money or bid count text.
- If active `listedPrice` mirrors `currentBid`, it must carry `priceSemantics.listedPrice = "observation_alias_current_bid"`.
- Transport estimates such as `CAD $378 / 194km` are rejected as canonical `listedPrice` evidence.
- `listedPrice = 4` from `4 Bids` is rejected by backend validation.

Live browser checks still required:

- Confirm Copy JSON never shows `listedPrice = 4`.
- Confirm either `listedPrice` is absent or equals the bid amount only with explicit observation-alias semantics.

## Price Evidence Validation

Backend schema validation now rejects canonical price fields when accepted evidence text indicates non-price UI context:

- `Bids`
- `Outbid`
- `Watchlist`
- `photos`
- `disclosure`
- `videos`
- `Transport estimate`
- `/km`

Low prices are not rejected by amount alone. A valid OpenLane observation with `currentBid = 4` and explicit money evidence such as `Current bid $4` remains accepted.

## Carfax Validation

Automated behavior:

- `openlane-vdp-carfax-text-only.html` remains `carfaxUrlStatus = "text_only"` when no real URL exists.
- `openlane-router-carfax-url.html` resolves a safe router metadata URL.
- `openlane-network-carfax-url.json` resolves a consent-gated network JSON URL.
- CARFAX URLs strip sensitive query params.
- Asset/logo URLs are rejected.
- No CARFAX content is fetched, clicked, or fabricated.

Live browser checks still required:

- On the Stinger page, confirm `carfaxUrlStatus` is `text_only` or `url_found` truthfully.
- If `url_found`, confirm the URL came from DOM/router/network metadata and contains no token/session/auth query values.

## Network Observer Validation

Automated behavior:

- The network observer remains consent-gated.
- It captures sanitized vehicle/listing candidates from allowed OpenLane JSON only.
- It rejects auth/session/profile/payment/user/token endpoints.
- It reports diagnostics for no events, denied endpoints, irrelevant JSON, duplicates, parse errors, and zero vehicle/CARFAX/price candidates.
- It does not capture headers, cookies, authorization values, credentials, or full sensitive URLs.

Live browser checks still required:

- Confirm debug panel shows the real observer state.
- Confirm `networkObserverMessage`, `networkEvidenceCount`, and `carfaxDiagnostics` explain whether CARFAX evidence was found or absent.

## Backend Guard Validation

Automated behavior:

- `currentBid = 4` with `sourceText = "Current bid 4 Bids"` is rejected.
- `listedPrice = 4` with `sourceText = "Current bid 4 Bids"` is rejected.
- `currentBid = 4` with `sourceText = "Current bid $4"` is accepted as observation evidence.
- `currentBid`, `listedPrice`, and `soldPriceCandidate` reject transport-estimate evidence.
- Active OpenLane pages still cannot carry outcome price fields.
- Current bid remains observation-only and is not an ML label.
- Existing ML feature schema rejects `listed_price` and `current_bid` as targets unless a verified target field is present.

## Commands Run

Final automated validation for this phase:

```txt
npm run verify:extension
Result: passed, 91/91 extension tests

npm test
Result: passed, 290/290 tests

npm run lint
Result: passed

npm run build
Result: passed

cd ml-service && python -m pytest
Result: passed, 25/25 tests
```

## Manual Browser Results

Not completed in this environment.

Reason: this Codex workspace cannot access the user's authenticated Chrome/OpenLane session or reload the installed unpacked extension in that profile. Marking live OpenLane results as passed from here would be false release evidence.

Required manual checks:

1. Pull branch `codex/vehicle-safe-archive`.
2. Open `chrome://extensions`.
3. Reload the unpacked Dealer Flow Market Snap extension.
4. Open Dealer Flow in the same Chrome profile and sign in.
5. Configure extension settings:
   - Dealer Flow URL set.
   - Organization ID set.
   - Auto-analyze on.
   - Capture observations/outcomes on.
   - Auto-save off for testing.
   - Deep Capture on/default active.
   - Observe page network data on.
   - Include media URLs on.
   - Include raw text on.
   - Debug mode on.
   - Model improvement opt-in off.
6. Open the live Kia Stinger VDP and confirm:
   - `pageType = active_listing`
   - `captureKind = observation`
   - `currentBid = 13700`
   - `listedPrice != 4`
   - `currentBid` source text contains `$13,700`
   - rejected price candidates include `4 Bids`
   - CARFAX status is truthful.
7. Open the Hyundai VDP and confirm:
   - `currentBid = 5100`
   - bid count and transport distance are not selected as prices.
8. Open a purchased VDP and confirm:
   - purchased/outcome fields are separated from active current bid observations.
9. Click Save only after the payload is clean and confirm Deal Radar stores the clean listing.

## Remaining Risks

- Live OpenLane SPA markup may contain a new current-bid or CARFAX shape not represented by sanitized fixtures.
- CARFAX may remain `text_only` when OpenLane exposes only button text and no safe href/router/network URL.
- Deep Capture network evidence depends on active consent/settings and OpenLane responses actually passing through observable page fetch/XHR paths.
- GitHub reported two moderate Dependabot vulnerabilities on the default branch during push; they are outside this price/CARFAX phase and should be triaged separately.

## Rollback Plan

If live testing finds a regression:

1. Preserve this report and the regression fixtures.
2. Revert the latest implementation commit that introduced the faulty behavior, not the fixture tests.
3. Add a sanitized fixture that reproduces the live failure.
4. Re-run:

```bash
npm run verify:extension
npm test
npm run lint
npm run build
```

5. If backend or ML target behavior changes, also run:

```bash
cd ml-service
python -m pytest
```

## Final Go/No-Go

Automated release evidence: Go.

Production release based on live OpenLane behavior: No-Go until the manual authenticated Chrome checks above pass on the real Stinger, Hyundai, purchased VDP, CARFAX, and Save-to-Deal-Radar flows.
