# Market Snap Kia / Mazda / Incoherence Final Validation

## Summary

This report closes the Kia/Mazda/OpenLane incoherence fix sequence on branch `codex/vehicle-safe-archive`.

Automated validation is passing for extension behavior, OpenLane fixture extraction, backend validation guards, lint, and production build. The remaining release gate is live Chrome/Brave validation in the user's authenticated OpenLane session. This environment cannot access the real logged-in OpenLane pages, so live browser results are intentionally marked pending rather than simulated.

## Kia Purchase Outcome Validation

Automated fixture coverage proves a purchased Kia VDP with true order-history evidence is treated as an outcome page:

- Fixture: `tests/fixtures/openlane/openlane-vdp-kia-purchase-sold-price-picked-up.html`
- Expected and verified:
  - `pageType = "purchase_detail"`
  - `captureKind = "verified_outcome"`
  - `soldPriceCandidate = 4000`
  - `buyPriceAuction = 4000`
  - outcome evidence includes `Sold price` and `Mark as picked up`

Live expected result remains:

- `VIN = 3KPFL4A72HE119966`
- `currentBid` absent or not used as an outcome
- `listedPrice` absent unless explicitly marked as a non-label observation

## Mazda Current Bid Validation

Automated fixture coverage proves the fresh bid-panel amount wins over a stale sticky bid bar:

- Fixture: `tests/fixtures/openlane/openlane-vdp-mazda-stale-bidbar-fresh-bidpanel.html`
- Expected and verified:
  - `pageType = "active_listing"`
  - `captureKind = "observation"`
  - `currentBid = 10300`
  - not `8500`
  - stale current-bid candidate diagnostics include `8500`

Live expected result:

- `staleActiveBidBarCandidate = 8500`
- `bidPanelTopCandidate = 10300`
- bid counts such as `59 Bids` remain rejected as counters.

## Camry Current Bid Validation

Automated fixture coverage proves highest-proxy/current-bid evidence wins over lower bid-history rows and bid counts:

- Fixture: `tests/fixtures/openlane/openlane-vdp-camry-highest-proxy-lower-row.html`
- Expected and verified:
  - `currentBid = 21000`
  - not `11100`
  - not `2`

Live expected result:

- source is `highest_proxy_applied` or trusted active current-bid evidence.
- lower full bid-history rows stay diagnostic only.

## Stinger Bid Count Validation

Automated fixture coverage proves the current bid is not confused with a nearby bid count:

- Fixture: `tests/fixtures/openlane/openlane-vdp-stinger-bid-count-vs-current-bid.html`
- Expected and verified:
  - `currentBid = 13700`
  - not `4`
  - `4 Bids` rejected as bid-count noise.

## False Purchase Marker Validation

Automated fixture coverage proves weak pickup/instruction text on an active VDP does not create a purchase outcome:

- Fixture: `tests/fixtures/openlane/openlane-vdp-active-pickup-instructions-not-purchase.html`
- Expected and verified:
  - `pageType = "active_listing"`
  - `captureKind = "observation"`
  - `soldPriceCandidate` absent
  - classification diagnostics include a rejected purchase marker sourced from pickup text.

## Condition Cleanup Validation

Automated fixture coverage proves Q&A and page chrome do not pollute canonical vehicle fields:

- Fixture: `tests/fixtures/openlane/openlane-vdp-hyundai-qa-condition-pollution.html`
- Expected and verified:
  - `currentBid = 5100`
  - not `29`
  - Q&A text does not populate canonical `engine`
  - Q&A text does not populate canonical `transmission`
  - canonical condition fields do not include full bid history, bid counts, transport estimate, or legal footer text.

Live Hyundai model parsing is still a manual checkpoint if OpenLane presents an unexpected title/identity layout.

## Carfax Validation

Automated coverage proves CARFAX status stays truthful:

- Text-only fixture remains `carfaxUrlStatus = "text_only"` with no invented URL.
- Router metadata fixture becomes `carfaxUrlStatus = "url_found"` only when a safe report URL exists.
- Allowed network JSON fixture can contribute a safe CARFAX URL.
- The extension does not fetch paid CARFAX report content.
- Diagnostics expose candidate counts and rejection reasons without secrets.

Live expected result:

- `url_found` only for a real safe URL.
- `text_only` when only visible CARFAX text exists.
- network observer status clearly explains active, inactive, empty, or rejected evidence states.

## Backend Guard Validation

Automated validation proves backend canonical guards reject contaminated evidence:

- Clean Kia purchase outcome with trusted evidence is accepted.
- Active listing payloads with outcome prices are rejected.
- Unsupported OpenLane page types with outcome prices are rejected.
- Bid-count evidence such as `59 Bids` is rejected as canonical price data.
- Active current bids remain observation-only and are not training labels.
- Transport/distance evidence is rejected as mileage or price evidence.
- Unsafe URLs, invalid VINs, oversized debug payloads, and sensitive fields remain blocked by validation.

## Commands Run

- `npm.cmd run verify:extension` - passed, 99/99 extension and OpenLane tests.
- `npm.cmd test -- tests/openlane-phase10-fixtures.test.ts` - passed, 305/305 tests under the repo test script.
- `npm.cmd test` - passed, 305/305 tests.
- `npm.cmd run lint` - passed.
- `npm.cmd run build` - passed; Next.js production build completed successfully.

`vercel build` was not run because no deployment configuration changed in this phase.

## Manual Browser Results

Not performed in this environment. The sandbox does not have the user's authenticated Chrome/Brave OpenLane session or the real live VDP URLs.

Manual validation required before production release:

1. Pull latest branch `codex/vehicle-safe-archive`.
2. Run the validation commands listed above.
3. Open `chrome://extensions`.
4. Reload the unpacked Dealer Flow Market Snap extension.
5. Clear extension storage only if stale settings are suspected.
6. Configure Dealer Flow URL and Organization ID.
7. Set Auto-analyze ON.
8. Set Capture observations/outcomes ON.
9. Set Auto-save OFF for testing.
10. Set Deep Capture ON/default active.
11. Set Observe page network data ON.
12. Set Include media URLs ON.
13. Set Include raw text ON.
14. Set Debug mode ON.
15. Set Model improvement opt-in OFF.
16. Test the Kia Forte purchase page and confirm the expected outcome fields.
17. Test the Mazda active listing and confirm `currentBid = 10300`.
18. Test the Camry active listing and confirm `currentBid = 21000`.
19. Test the Stinger active listing and confirm `currentBid = 13700`.
20. Test the Hyundai active listing and confirm clean Q&A/condition behavior.
21. Confirm CARFAX `url_found` or `text_only` matches the real page.
22. Save only clean payloads to Deal Radar and verify no outcome contamination.

## Remaining Risks

- Live OpenLane DOM, labels, SPA timing, or network response shapes may differ from sanitized fixtures.
- A real page may omit VIN from visible/user-authorized evidence; in that case the extension should remain preview-only instead of saving low-quality data.
- Deep Capture may be active but see no allowed vehicle JSON if OpenLane changes endpoint names; diagnostics should make this visible.
- GitHub reported two moderate Dependabot vulnerabilities on the default branch during push; they are outside this OpenLane extraction sequence and should be triaged separately.

## Rollback Plan

If live validation finds a regression, revert the recent Kia/Mazda/OpenLane commits in reverse order on `codex/vehicle-safe-archive`:

1. `a19f990` - Phase 10 fixture regression matrix.
2. `0cacf4e` - backend price guards.
3. `864a1c4` - contradiction diagnostics.
4. `f44b05d` - condition section cleanup.
5. `b45c438` - weak purchase marker rejection.
6. `580aede` - fresh current-bid preference.
7. `be3dc29` - purchase outcome evidence in widget.
8. `578a471` - purchase outcome price resolver.
9. `6cd24af` - audit fixtures.

Do not weaken backend validation gates during rollback unless a replacement guard still prevents active bids, bid counts, transport estimates, and unsupported page outcome prices from entering Deal Radar or training data.

## Final Go/No-Go

Automated validation: Go.

Live production release: No-Go until authenticated Chrome/Brave validation confirms:

- live Kia page extracts structured sold price,
- live Mazda page extracts `currentBid = 10300`,
- live Camry page extracts `currentBid = 21000`,
- live Stinger page extracts `currentBid = 13700`,
- false purchase markers are rejected,
- condition sections are clean,
- CARFAX status is truthful,
- backend save behavior preserves clean observation/outcome semantics,
- no sensitive data is exposed.
