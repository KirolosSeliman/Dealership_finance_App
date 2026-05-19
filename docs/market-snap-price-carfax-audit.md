# Market Snap Price And Carfax Audit

## Problem Restatement

The live OpenLane active listing copy payload showed an active observation for VIN `KNAE55LC7J6040713`, title `2018 Kia Stinger`, with:

- `currentBid: 4`
- `listedPrice: 4`
- visible page evidence containing `$13,700` and `4 Bids`
- `carfaxMentioned: true`
- `carfaxAvailable: true`
- `carfaxUrlStatus: text_only`
- no CARFAX URL candidates in DOM or network diagnostics

The correct active-listing observation should use `$13,700` as `currentBid`, keep it observation-only, and never treat the bid count as a price. CARFAX should remain `text_only` unless a real URL is present in safe DOM/router metadata or consent-gated allowed network JSON.

## Confirmed Facts From Payload

- The page was classified as `active_listing` with `captureKind: observation`.
- The page visually exposed a money amount and a bid count in the bid area.
- The extension accepted the count-like text `4 Bids` as money and propagated it to both `currentBid` and `listedPrice`.
- The copied CARFAX state was truthful but incomplete for diagnostics: CARFAX was visible, but no URL source was proven.

## Wrong Current Bid Evidence

Phase 0 reproduced the wrong-price failure against the current code without changing production logic:

```txt
<section class="bid-panel">
  <p>$13,700</p>
  <h2>Current bid</h2>
  <p>4 Bids</p>
</section>
```

Current extraction result:

```txt
currentBid: 4
listedPrice: 4
```

Root path:

```txt
extractOpenLaneListing()
-> buildScopedLabelValues()
-> extractLabelValuesFromText(bidPanel text)
-> valueNearTextLabel(text, "Current Bid")
-> "4 Bids"
-> moneyFrom("4 Bids")
-> 4
-> listedPrice = currentBid
```

The same probe also exposed a fallback risk: if the section text is joined without clear separators, `firstNonTransportMoney()` can see `$13,700 4` as one money-like token and normalize it to `137004`. That is a separate guardrail target for later phases.

## Correct Current Bid Evidence

The correct value is the trusted money token in the bid panel near the current-bid UI:

```txt
$13,700
```

The bid count is not price evidence:

```txt
4 Bids
```

The source priority should be:

1. trusted current-bid/bid-panel money amount,
2. allowed network JSON `currentBid` or `currentBidAmount`,
3. explicit top-bid/current-bid row with a currency marker,
4. never bid count/watchlist/photo/disclosure/video/count text.

## Price Field Data Flow

Current active-listing price flow:

```txt
currentBid = extractMoneyByLabels(scopedLabelValues.price, ["Current Bid", "Top Bid", "Mise actuelle", "Bid"])
currentOffer = extractMoneyByLabels(...)
bestOffer = extractMoneyByLabels(...)
buyNowPrice = extractMoneyByLabels(...)
listedPrice = buyNowPrice || currentBid || currentOffer || bestOffer || firstNonTransportMoney(mainVisibleText)
priceSemantics.currentBid = "observation"
priceSemantics.listedPrice = "observation"
```

This explains why one bad `currentBid` value contaminates `listedPrice`.

## Carfax Current State

The current CARFAX resolver checks:

- `a[href]`
- `data-href`
- `data-url`
- safe DOM attributes
- HTML CARFAX zones
- HTML nodes with CARFAX/link metadata
- visible text fallback
- allowed network JSON after Deep Capture evidence is merged

If only CARFAX text is visible, the correct canonical result is:

```txt
carfaxMentioned: true
carfaxAvailable: true
carfaxUrlStatus: text_only
carfaxUrl: undefined
```

## Network Observer Current State

The network observer is passive and consent-gated. It:

- observes page-generated fetch/XHR JSON only,
- denies auth/session/profile/account/payment/billing/user/token/cookie/password endpoints,
- does not capture headers/cookies/authorization credentials,
- sanitizes/caps payload snippets,
- extracts normalized field candidates including `currentBid` and `carfaxUrl`,
- merges candidates into listing evidence when active/default Deep Capture allows it.

If network evidence count is zero on a live page, the likely causes are:

- the early hook did not observe an allowed vehicle/listing JSON response,
- the endpoint path did not match the allowlist,
- the response was not JSON-like,
- the observer was disabled/off for the runtime settings,
- the page did not load a CARFAX URL in JSON.

## Root Cause Hypotheses

High confidence:

- `valueNearTextLabel()` accepts non-money count text after the `Current bid` label, and `moneyFrom()` is too permissive for a price field because it can parse `4 Bids` as `4`.
- `listedPrice` inherits `currentBid`, so any current-bid parsing error becomes a listed-price error.

Medium confidence:

- Bid-panel text ordering on the live OpenLane SPA places the amount before the label and the bid count after the label.
- `firstNonTransportMoney()` can over-join adjacent count text if fallback parsing is reached.

CARFAX:

- `text_only` is correct when no safe URL source exists.
- If a real URL exists only in router metadata or network JSON, diagnostics must prove which source was present and why it did or did not produce a candidate.

## Fixture Plan

Added fixtures:

- `tests/fixtures/openlane/openlane-vdp-active-current-bid-before-label-4-bids.html`
  - Reproduces visible `$13,700`, `Current bid`, and `4 Bids` ordering for the live Kia Stinger case.
- `tests/fixtures/openlane/openlane-vdp-carfax-router-metadata.html`
  - Provides a safe router metadata CARFAX URL for recovery tests.
- `tests/fixtures/openlane/openlane-network-current-bid-carfax-diagnostics.json`
  - Provides allowed vehicle JSON with `currentBidAmount: 13700`, `bidCount: 4`, and a CARFAX URL.

## Phase Plan

1. Phase 1: implement zone-specific current-bid extraction that finds real currency amounts in trusted bid zones and rejects count text.
2. Phase 2: harden listed-price semantics so count-like values cannot propagate from current bid or fallback money parsing.
3. Phase 3: expose current-bid parsing decisions in widget and Copy JSON.
4. Phase 4: strengthen live network observer diagnostics for zero evidence.
5. Phase 5: recover CARFAX URLs from real safe sources only; keep `text_only` when no URL exists.
6. Phase 6: add backend guards for suspicious active-listing price data.
7. Phase 7: add full regression tests around the new fixtures.
8. Phase 8: document final automated and manual live-browser validation.
