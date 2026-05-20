# Market Snap Live Bid / Kia / Carfax / Incoherence Audit

## Problem Restatement

Latest live OpenLane evidence shows the extension is closer to production-ready, but still has data-quality gaps:

- A live active Nissan Frontier page showed `Current bid $14,200`, `Under 1 min`, and `71 Bids`, while the extension could select stale `$13,800` evidence.
- A Kia Forte purchase page is correctly classified as `purchase_detail` / `verified_outcome`, but the UI can still miss structured sold/acquisition price display.
- CARFAX text is visible, but a safe URL is often not present in DOM/router/network evidence.
- Condition fields can still absorb headers, bid rows, footer/legal text, and transport copy.
- Purchase pages can report `listedPrice` as missing even when the relevant price is sold/acquisition price.
- Network observation can be enabled with zero allowed events and no early hook diagnostics.
- Multi-word models such as `2014 Hyundai Santa Fe Sport` can be split as `model: Santa`, `trim: Fe Sport`.

## Confirmed Facts From Payloads

Facts from the prompt-provided live evidence:

- Nissan live visible evidence: `$14,200`, `Under 1 min`, `71 Bids`.
- Nissan extension-selected stale evidence: `currentBid = 13,800`, source resembling stale active bid bar.
- Kia live visible evidence: `Order history`, `Sold price`, `$4,000`, `Mark as picked up`.
- Kia classification evidence: `pageType = purchase_detail`, `captureKind = verified_outcome`, `outcomeConfidence = verified`.
- CARFAX visible evidence can be text-only.
- Network observer evidence can show `enabled = true`, `allowedEventCount = 0`, `networkEvidenceCount = 0`, and `earlyHookInstalled = false`.
- Condition payloads can contain pollution such as `mechanicalDisclosures: ["Exterior"]`, bid rows in exterior fields, and `tireWheelDisclosures: ["& wheels"]`.

Facts proven from the current code paths:

- `browser-extension/src/openlane-extractor.js` currently builds generic missing data from `vin`, `year`, `make`, `model`, `mileageKm`, and `listedPrice` for every listing context.
- `browser-extension/src/openlane-extractor.js` currently parses title identity with a simple word split, so `2014 Hyundai Santa Fe Sport SE` becomes `model = Santa`, `trim = Fe Sport SE`.
- `browser-extension/src/openlane-stable-capture.js` has bounded bid stabilization for unstable/current-bid conflict, but it still runs through the broader stable extraction loop.
- `browser-extension/src/openlane-network-observer.js` exposes observer status counters including page hook, early hook, allowed, denied, irrelevant, parse error, duplicate, and observation counts.
- `browser-extension/src/openlane-network-page-hook.js` observes fetch/XHR JSON passively, only for allowed OpenLane/KAR vehicle/listing endpoints, and does not capture request headers, cookies, auth headers, credentials, or tokens.

## Fast Live Bid Evidence

Fixture created:

- `tests/fixtures/openlane/openlane-vdp-nissan-final-minute-bid-refresh.html`

The fixture contains:

- vehicle: `2023 Nissan Frontier Crew Cab SV`
- VIN: `1N6ED1EK0PN123456`
- stale sticky active bid bar: `$13,800`, `Last refreshed earlier`
- fresh bid panel: `Current bid`, `$14,200`, `Under 1 min`, `71 Bids`

Current extractor behavior on this fixture:

- `pageType = active_listing`
- `captureKind = observation`
- `currentBid = 14200`
- stale diagnostics include `$13,800`
- the active-bid-bar zone still mixes fresh and stale snippets, so Phase 1 should harden arbitration and freshness diagnostics rather than assume the current fixture result is enough for fast live auctions.

## Kia Purchase Outcome Evidence

Fixture created:

- `tests/fixtures/openlane/openlane-vdp-kia-purchase-sold-price-picked-up-live.html`

The fixture contains:

- VIN: `3KPFL4A72HE119966`
- `Order history`
- `Sold price`
- `$4,000`
- `Mark as picked up`
- `Full bid history`
- transport estimate noise: `CAD $378 / 211km`

Current extractor behavior on this fixture:

- `pageType = purchase_detail`
- `captureKind = verified_outcome`
- `soldPriceCandidate = 4000`
- `buyPriceAuction = 4000`
- `carfaxUrlStatus = text_only`
- `missingData` still includes `listedPrice`

The remaining Phase 3/4 work is therefore UI/readiness/backend integration and context-aware missing-data behavior, not page classification.

## Carfax Evidence

Fixtures created:

- `tests/fixtures/openlane/openlane-vdp-carfax-text-only-live.html`
- `tests/fixtures/openlane/openlane-network-carfax-url-live.json`

Text-only fixture evidence:

- visible text: `Always view the CARFAX report`
- no `href`
- no `data-href`
- no `data-url`
- no router metadata

Current extractor behavior on text-only fixture:

- `carfaxUrlStatus = text_only`
- no invented `carfaxUrl`

Network fixture evidence:

- allowed OpenLane vehicle JSON includes `carfaxReportUrl`
- URL query includes a token-like parameter so sanitizer behavior is testable

Current network helper behavior:

- extracts `carfaxUrl`
- normalizes to `https://app.openlane.ca/vehicle-history/carfax/FORTE-LIVE-123`
- redacts the query in `sourceText`

## Condition Pollution Evidence

Fixture created:

- `tests/fixtures/openlane/openlane-vdp-condition-pollution-live.html`

The fixture contains:

- `Mechanical` heading followed by `Exterior`
- `Exterior` subsection containing `Full bid history`, `Current bid $5,100`, and `OPENLANE Inc. All rights reserved.`
- `Tires and wheels` subsection containing `& wheels`
- transport estimate noise

Current extractor behavior confirms remaining pollution:

- `tireWheelDisclosures` can include `& wheels`
- canonical condition text can include `$5,100`
- diagnostics reject many noisy lines, but rejected lines can still coexist with canonical pollution in some boundary shapes

Phase 5 should clean section boundaries and reject header fragments without deleting legitimate condition findings.

## Context-Aware Missing Data Evidence

Current code evidence:

- `buildMissingData()` always requires `listedPrice`.
- Purchase outcomes should require sold/acquisition outcome price fields instead of `listedPrice`.

Fixture evidence:

- `openlane-vdp-kia-purchase-sold-price-picked-up-live.html` extracts `soldPriceCandidate = 4000` and `buyPriceAuction = 4000`, but still reports `missingData = ["listedPrice"]`.

Phase 8 should make missing-data/readiness context-aware:

- active listing: current bid or buy-now/listed observation can satisfy price preview.
- purchase/outcome page: sold/acquisition/final outcome price should satisfy the relevant price field.
- CARFAX `text_only` should not block readiness when no safe URL exists.

## Network Observer Evidence

Fixture created:

- `tests/fixtures/openlane/openlane-network-observer-zero-evidence-live.json`

The fixture captures the failure state:

- `enabled = true`
- `pageHookInstalled = false`
- `earlyHookInstalled = false`
- `allowedEventCount = 0`
- `networkEvidenceCount = 0`
- `observationCount = 0`

Current code evidence:

- `openlane-network-page-hook.js` is passive and endpoint-filtered.
- `openlane-network-observer.js` has status counters but later phases should make the widget/copy JSON explanation more actionable when the observer is active but no useful vehicle JSON is seen.

## Multi-Word Model Evidence

Fixture created:

- `tests/fixtures/openlane/openlane-vdp-hyundai-santa-fe-sport-live.html`

Current extractor behavior:

- title: `2014 Hyundai Santa Fe Sport SE`
- current result: `model = Santa`, `trim = Fe Sport SE`
- desired result in Phase 9: `model = Santa Fe Sport`, trim containing only remaining trim/package text such as `SE`

The root cause is the generic `parseTitle()` word-split strategy in `openlane-extractor.js`.

## Fixture Plan

Phase 0 created or confirmed these fixtures for later phases:

- `openlane-vdp-nissan-final-minute-bid-refresh.html`
- `openlane-vdp-kia-purchase-sold-price-picked-up-live.html`
- `openlane-vdp-carfax-text-only-live.html`
- `openlane-network-carfax-url-live.json`
- `openlane-vdp-condition-pollution-live.html`
- `openlane-network-observer-zero-evidence-live.json`
- `openlane-vdp-hyundai-santa-fe-sport-live.html`

Existing fixtures still cover Mazda stale bid bar, Camry highest proxy, Stinger bid count, Hyundai Q&A pollution, CARFAX router metadata, backend bad price evidence, and active pickup false purchase markers.

## Phase Plan

1. Phase 1: harden freshness-aware current-bid arbitration for final-minute bid movement.
2. Phase 2: add a fast bid-only live monitor so current-bid changes can update without waiting for a full stable extraction loop.
3. Phase 3: harden Kia purchase sold-price structured fields.
4. Phase 4: integrate purchase UI/backend and context-aware missing data.
5. Phase 5: clean condition section boundaries and reject header/noise fragments.
6. Phase 6: improve CARFAX network diagnostics and safe URL recovery while preserving truthful `text_only`.
7. Phase 7: harden network observer endpoint and early-hook diagnostics without broadening sensitive capture.
8. Phase 8: make missing data and readiness context-aware.
9. Phase 9: normalize multi-word vehicle models.
10. Phase 10: surface contradiction diagnostics in widget and Copy JSON.
11. Phase 11: keep backend/ML guards strict.
12. Phase 12: consolidate regression tests and fixtures.
13. Phase 13: complete final live browser validation report.
