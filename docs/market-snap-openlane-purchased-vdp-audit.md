# Market Snap OpenLane Purchased VDP Audit

## Problem Restatement

The live OpenLane VDP widget now appears, but copied debug payloads show purchased VDP pages are still not captured honestly. A purchased detail page containing `Purchases`, `Order history`, `Sold price`, `$4,000`, `Mark as picked up`, and `Full bid history` was reported as an active listing observation instead of a purchase/post-sale outcome. The same payload family shows transport estimates and noisy UI regions leaking into canonical listing fields.

## Confirmed Facts From Payload

- The problematic page is an authenticated OpenLane VDP URL under `https://app.openlane.ca/vdp/...`.
- The copied payload includes purchased/outcome text: `Purchases`, `Order history`, `Sold price`, `$4,000`, `Mark as picked up`, and `Full bid history`.
- The copied payload reported `pageType: active_listing`, `captureKind: observation`, and `outcomeConfidence: low`.
- The copied payload did not promote `$4,000` into a purchase outcome price.
- The copied payload allowed non-vehicle UI text into canonical-like fields, including examples such as `Q&A`, `Ownership`, `UNLESS STATED OTHERWISE`, and question text around engine/transmission.
- CARFAX was reported as text-only, while network evidence count was zero.

## Confirmed Facts From Local Fixture Probe

After adding sanitized Phase 0 fixtures, the current code produced these results:

- `openlane-vdp-purchased-sold-price-picked-up.html` classified as `post_sale`, `candidate_outcome`, with `soldPriceCandidate: 4000`, `mileageKm: 111486`, and `auctionStatus: Mark as picked up`.
- `openlane-vdp-active-current-bid-control.html` classified as `active_listing`, `observation`, with `currentBid/listedPrice: 4600` and `mileageKm: 111486`.
- `openlane-vdp-noisy-qa-sidebar-market-guide.html` classified as `active_listing` and reproduced canonical pollution: `lane: Montreal`, `engine: and transmission are good? Thanks`, and `transmission: are good? Thanks`.
- `openlane-vdp-carfax-text-only-control.html` classified as `active_listing` with `carfaxUrlStatus: text_only`.

This means the copied live misclassification is not reproduced by the simplest static purchased fixture, but the fixture probe does prove two remaining defects: purchase detail semantics are inconsistent (`Sold price` becomes `post_sale`, not `purchase_detail`) and canonical field extraction remains polluted by noncanonical zones.

## Misclassified Purchased VDP Evidence

Code inspection confirms the current classifier has separate evidence markers for purchase and post-sale contexts in [openlane-page-classifier.js](../browser-extension/src/openlane-page-classifier.js):

- `purchase_context` matches `purchases`, `open order`, `order history`, `purchase info`, or `documents`.
- `vdp_selling_price` only matches VDP text containing `Order history` followed by `Selling price`.
- `post_sale` matches `post sale`, `sold price`, negotiation, accepted, or rejected text.

The purchase-detail branch is currently tied to `vdp_selling_price`, so a purchased VDP that says `Sold price` instead of `Selling price` is not classified as `purchase_detail` through that branch. In the new static fixture, the `post_sale` branch catches it. If `Sold price` is missing from the current main text because of SPA timing, stale section-map cache, or zone exclusion, the VDP active-listing branch can classify the page as `active_listing` from the URL plus vehicle identity/header/current-bid evidence. That timing/region-loss path remains a hypothesis for the copied live payload and must be tested in later phases.

## Active VDP Control Evidence

An active VDP with only current bid, vehicle identity, mileage, and gallery evidence should remain an `active_listing` observation. It must not be promoted to a purchase outcome without purchase/order/post-sale markers.

The new sanitized fixture `tests/fixtures/openlane/openlane-vdp-active-current-bid-control.html` captures this control case.

## Polluted Fields

Code inspection confirms canonical fields are still populated through the broad label map in [openlane-extractor.js](../browser-extension/src/openlane-extractor.js):

- `sellerName` comes from `Seller`/`Consignor`.
- `auctionStatus` can fall back to `Auction Status`, `Sale Status`, or `Status`.
- `lane`, `engine`, and `transmission` are direct label lookups.

Those labels are extracted from `mainVisibleText`; if Q&A, sidebar, market-guide, or footer text is present in that text, generic words can be mistaken for canonical field values. This matches the copied bad values: `sellerName=Q&A`, `auctionStatus=Ownership`, `lane=UNLESS STATED OTHERWISE`, and engine/transmission question text.

## Reliable Zones

Reliable canonical identity and economics should come from:

- `vehicleHero`
- `vehicleSpecs`
- `gallery`
- `bidPanel` for active observations only
- `purchasePanel`
- `feeDetailsPanel`
- `postSalePanel`
- consent-gated allowed vehicle/listing network JSON after redaction

## Forbidden Zones For Canonical Fields

The following zones may be useful as context or debug evidence but should not overwrite canonical vehicle/business fields:

- `qaSection`
- `marketGuide`
- `sidebar`
- `footer`
- transport estimate text when resolving vehicle mileage or list/outcome price

The new sanitized fixture `tests/fixtures/openlane/openlane-vdp-noisy-qa-sidebar-market-guide.html` captures these pollution risks.

## Carfax Current State

Existing extraction supports direct CARFAX URLs from links and metadata attributes, and it supports a `text_only` status when CARFAX text is visible without a URL. The reported live state is `text_only` with no network evidence, so the current evidence is insufficient to prove whether OpenLane exposes a CARFAX URL in DOM attributes, safe embedded JSON, or allowed network JSON for that page.

The new sanitized fixture `tests/fixtures/openlane/openlane-vdp-carfax-text-only-control.html` captures the expected truthful fallback: visible CARFAX text without inventing or fetching a report URL.

## Network Observer Current State

Code inspection confirms [openlane-network-page-hook.js](../browser-extension/src/openlane-network-page-hook.js) observes `fetch` and `XMLHttpRequest` JSON responses after injection, filters to OpenLane/KAR hosts, denies sensitive auth/session/profile/account/payment/user/token/cookie/password endpoints, and posts only response body snippets without request headers, cookies, credentials, or auth tokens.

Code inspection also confirms [openlane-network-observer.js](../browser-extension/src/openlane-network-observer.js) re-applies endpoint allow/deny checks, sanitizes sensitive keys/strings, caps payload traversal, and stores normalized candidates rather than raw full payloads. The copied payload's zero network evidence can therefore be caused by any of these still-open possibilities:

- The page hook injected after the VDP's useful network calls already completed.
- Deep Capture was not truly active at runtime.
- The useful endpoint did not match the current allowlist.
- The response did not include relevant JSON candidates.
- The browser page used cached/preloaded data before the hook attached.

## Root Cause Hypotheses

1. Purchased VDP classification is too narrow because `purchase_detail` requires `Selling price` and does not treat `Sold price` with `Order history`/`Mark as picked up` as purchase-detail evidence.
2. SPA timing or stale cached section maps can let active VDP evidence win before purchased/order outcome markers arrive.
3. Outcome price extraction misses `$4,000` because `extractPurchaseEconomics()` reads `Selling price` but not `Sold price`, while `extractPostSaleOutcome()` only runs when `pageType === "post_sale"`.
4. Transport estimate money can leak into listing price when the page is misclassified as active and `listedPrice` falls back to the first money in `mainVisibleText`.
5. Canonical field extraction is not strictly zone-scoped enough; Q&A, market-guide, sidebar, footer, and transport text must be excluded from canonical labels.
6. CARFAX text-only output is truthful when no URL exists, but current diagnostics do not explain whether the URL was absent from DOM, attributes, safe JSON, or consent-gated network evidence.
7. Zero network evidence may be an early-hook/runtime activation problem rather than an extraction resolver problem.

## Phase Plan

1. Phase 1 will add failing tests for purchased VDP classification using `Sold price`, `Order history`, and `Mark as picked up`, then update classifier evidence without broadening capture to unsupported pages.
2. Phase 2 will add failing tests for purchased/outcome price extraction so `$4,000` is captured as a candidate/verified wholesale label only in purchase/outcome context and never confused with transport estimates.
3. Phase 3 will enforce zone-scoped canonical field extraction so noisy Q&A/sidebar/market-guide/footer text cannot populate seller, lane, engine, transmission, auction status, mileage, or price.
4. Phase 4 will clean condition/disclosure zones while preserving real condition and Q&A diagnostics.
5. Phase 5 will improve CARFAX diagnostics so `url_found`, `text_only`, and `not_present` states explain their evidence sources.
6. Phase 6 will investigate early page-hook attachment and Deep Capture runtime truth for network evidence.
7. Phase 7 will align backend validation and training gates with the new purchased/outcome semantics.
8. Phase 8 will consolidate fixture regression tests.
9. Phase 9 will improve widget debug/user feedback for these states.
10. Phase 10 will run final validation and manual Chrome checklist.
