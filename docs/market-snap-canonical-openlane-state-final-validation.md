# Market Snap Canonical OpenLane State Final Validation

## Summary

The Canonical OpenLane State pipeline is covered by automated extension, backend validation, fixture regression, and production build checks. The test suite now locks the latest known OpenLane failures for active bid extraction, purchased VDP outcomes, purchase-list candidate outcomes, CARFAX source truth, condition cleanup, network observer diagnostics, multi-word vehicle identity parsing, and backend/ML safety gates.

Live authenticated OpenLane validation remains a manual release gate because this environment cannot access the user's logged-in Chrome/OpenLane session.

## Live Bid Validation

Automated coverage:

- `openlane-vdp-nissan-final-minute-bid-refresh.html` selects `currentBid = 14200`.
- The same fixture rejects stale sticky bid `13800`.
- The same fixture rejects bid count `71`.
- `openlane-bid-live-monitor.test.ts` verifies the bid-only live monitor updates from `13800` to `14200` without backend analyze/save/capture calls.
- Canonical/legacy copy payload tests verify the canonical current bid overrides stale legacy values.

Manual browser gate:

- On a live Nissan Frontier final-minute VDP, confirm `pageType = active_listing`, `captureKind = observation`, `currentBid = 14200`, and `canonical.activeAuction.currentBid = 14200`.

## Purchase Detail Validation

Automated coverage:

- `openlane-vdp-kia-purchase-detail-sold-price-picked-up.html` maps the visible `Sold price $4,000` purchase detail into `soldPriceCandidate = 4000`.
- Verified purchase detail context maps `buyPriceAuction = 4000` when trusted picked-up/order-history evidence is present.
- Purchase detail readiness does not require `listedPrice`.

Manual browser gate:

- On the live Kia Forte purchased VDP, confirm the widget shows `pageType = purchase_detail`, `captureKind = verified_outcome`, `soldPriceCandidate = 4000`, and no `listedPrice` missing-data warning.

## Purchase List Validation

Automated coverage:

- `openlane-vdp-kia-purchase-list-sold-price-card.html` maps a visible sold-price purchase card into `pageType = purchase_list`, `captureKind = candidate_outcome`, and `soldPriceCandidate = 4000`.
- The purchase-list fixture does not promote the candidate price into verified `buyPriceAuction`.
- Purchase-list readiness no longer asks for `listedPrice` when the sold price is present.

Manual browser gate:

- On a live purchase-list card, confirm visible sold price becomes a candidate outcome and does not create stale active-listing price fields.

## Carfax Validation

Automated coverage:

- Text-only CARFAX fixtures remain `carfaxUrlStatus = text_only` with no invented URL.
- Router, DOM metadata, and allowed network JSON fixtures become `url_found` only when a safe CARFAX/OpenLane vehicle-history URL is visible in page evidence.
- Backend validation rejects fake CARFAX URLs such as non-OpenLane/non-CARFAX hosts.
- Copy JSON and widget debug now expose CARFAX source counts, source status, and text-only explanation.

Manual browser gate:

- Confirm live pages show `url_found` only when the URL is exposed by safe DOM/router/network evidence, and `text_only` when only CARFAX text is visible.

## Condition Validation

Automated coverage:

- Condition fixtures reject section header bleed such as Mechanical -> Exterior and Tire -> wheels.
- Canonical condition arrays exclude bid values, full bid history, legal/footer text, navigation, and transport estimate noise.
- Backend validation rejects canonical condition payloads polluted by bid/legal/transport text.
- Widget and Copy JSON expose condition extractor mode, rejected condition-line count, section-boundary decisions, and ignored noisy-zone count.

Manual browser gate:

- On live condition-heavy VDPs, confirm real damage/disclosure terms remain while bid rows, footer/legal text, and navigation labels are absent from canonical condition fields.

## Network Observer Validation

Automated coverage:

- Page hook diagnostics distinguish early hook, proven page hook install, content listener, queue flush, allowed/denied/irrelevant events, duplicates, and parse failures.
- Sensitive endpoints such as profile/session/account/payment/token paths are denied without response-body capture.
- Allowed vehicle/history/report JSON contributes only normalized candidates and capped evidence snippets.
- Network evidence redacts token, cookie, email, phone, auth, session, secret, credential, CSRF, JWT, and bearer values.

Manual browser gate:

- In the widget/Copy JSON, confirm hook status and allowed/denied/irrelevant event counts are accurate on live OpenLane pages.

## Vehicle Identity Validation

Automated coverage:

- `2014 Hyundai Santa Fe Sport SE` parses as `make = Hyundai`, `model = Santa Fe Sport`, `trim = SE`.
- Tests also cover Toyota Camry Hybrid, Mazda Mazda3, Mercedes-Benz G-Class, Nissan Frontier, Nissan Titan, and Honda Accord.
- VIN validation rejects invalid VINs and label noise such as barcode text.

Manual browser gate:

- Confirm live Hyundai/Toyota/Mazda pages preserve multi-word models and trims in the widget and Copy JSON.

## Backend / ML Guard Validation

Automated coverage:

- Active listing observations can store `currentBid` as an observation feature.
- Active listings reject outcome fields such as `soldPriceCandidate`.
- Bid-count evidence such as `71 Bids` is rejected as canonical price data.
- Transport estimates are rejected as canonical mileage/price evidence.
- Purchase outcomes require supported purchase/post-sale/fee page types, outcome capture kind, visible sold/acquisition price evidence, and valid VIN for verified outcomes.
- Training export excludes `currentBid`, `listedPrice`, and `soldPriceCandidate` as labels.
- Training eligibility requires verified/manual outcomes, model-improvement opt-in, verified labels, and evidence.

## Commands Run

Latest automated validation for Phase 13:

- `npm.cmd run verify:extension` - passed, 113 extension tests.
- `npm.cmd test` - passed, 346 total tests.
- `npm.cmd run lint` - passed.
- `npm.cmd run build` - passed.

Automated release gate: passed in this environment.

## Manual Browser Results

Not executed in this environment. Required manual steps:

1. Pull the latest `codex/vehicle-safe-archive` branch.
2. Run the commands listed above locally.
3. Reload the unpacked extension in `chrome://extensions`.
4. Configure Dealer Flow URL, Organization ID, Auto-analyze ON, Capture observations/outcomes ON, Auto-save OFF, Deep Capture ON/default active, Observe page network data ON, Include media URLs ON, Include raw text ON, Debug mode ON, Model improvement opt-in OFF.
5. Test live Nissan final-minute bid, Kia purchase detail, Kia purchase list, CARFAX, condition cleanup, network observer diagnostics, multi-word identity parsing, and Save to Deal Radar.

## Remaining Risks

- OpenLane can change DOM labels, router metadata, endpoint paths, or response shapes after release.
- Real authenticated pages may contain layout variants not represented by sanitized fixtures.
- Deep Capture network evidence depends on consent settings, page hook install timing, and allowed endpoint visibility.
- Manual Save to Deal Radar still needs a live organization/user role check in the target deployment.

## Rollback Plan

Rollback is safe by reverting the Market Snap extension/debug/backend validation commits on `codex/vehicle-safe-archive` and redeploying the previous extension bundle. Database migrations added earlier in the Market Snap hardening path are append-only/protective and should not be rolled back destructively. If a live extraction regression appears, disable Deep Capture/network observation in extension settings first, then reload the unpacked extension while preserving backend validation guards.

## Final Go/No-Go

Automated gate: Go after `verify:extension`, `test`, `lint`, and `build` pass.

Manual live-browser gate: Not yet Go. The release becomes Go only after the authenticated Chrome/OpenLane checklist confirms live Nissan bid, live Kia purchase detail, live purchase-list, CARFAX truth, condition cleanup, network diagnostics, vehicle identity parsing, backend save behavior, and no sensitive data exposure.
