# Market Snap Current Bid And Carfax Audit

## Problem Restatement

OpenLane active VDP extraction must select the active auction amount as `currentBid`, keep that value observation-only, and never treat bid counts or bid-history rows as canonical price data. CARFAX must only be `url_found` when a real safe URL is present in DOM attributes, router metadata, or consent-gated allowed network JSON.

Known live failure shapes:

- `Current bid / 4 / Bids / $13,700` produced `currentBid = 4` and `listedPrice = 4`.
- `Highest proxy applied / $21,000 / $11,100 / Current bid / 2 Bids` produced `currentBid = 11100` instead of `21000`.
- Visible `Always view the CARFAX report` produced `carfaxUrlStatus = text_only` with no URL.

## Confirmed Facts From Payload

- The impacted OpenLane pages are active listings, not purchased outcome pages.
- Active current bid is observational market evidence, not a verified sale/acquisition label.
- Bid counts such as `4 Bids`, `2 Bids`, and `29 Bids` are counters, not money evidence.
- Bid history can contain lower historical money rows that must not outrank the active current bid bar.
- CARFAX text alone proves visibility/availability, but not a recoverable URL.

## Wrong Current Bid Evidence

Wrong evidence examples now represented as fixtures:

- `tests/fixtures/openlane/openlane-vdp-active-current-bid-before-label-4-bids.html`
- `tests/fixtures/openlane/openlane-vdp-active-current-bid-proxy-history.html`
- `tests/fixtures/openlane/openlane-vdp-active-current-bid-29-bids.html`

The risky path is `extractOpenLaneListing()` -> `extractCurrentBidFromBidPanel()` -> text/DOM candidate scans. Any candidate with a money-looking number can win by confidence unless the resolver understands active bid bar context and rejects count/history noise.

## Correct Current Bid Evidence

The winning source order should be:

1. Allowed network JSON explicitly mapped to `currentBid`.
2. Trusted active bid bar or sticky current bid zone, including `Highest proxy applied` when it is the active bid state.
3. Direct current-bid money adjacent to a `Current bid` or `Top bid` label.
4. Bid history money only as a weak fallback when no active current-bid source exists.
5. Never bid counts, transport distance, watchlist counts, photo counts, disclosure counts, or generic page counters.

## Price Field Data Flow

Current active listing flow:

- `currentBid` is resolved in `browser-extension/src/openlane-extractor.js`.
- `listedPrice` can be aliased from `currentBid` by `resolveActiveListedPrice()`.
- `priceSemantics.listedPrice` must be `observation_alias_current_bid` when the alias is used.
- Backend validation in `src/lib/market-snap/validation.ts` must reject count-like or transport-like price evidence before saving.

## Carfax Current State

CARFAX candidate sources are:

- direct `a[href]`
- `data-href`
- `data-url`
- safe DOM attributes
- HTML CARFAX zones
- router/link metadata
- consent-gated allowed network JSON

`carfaxUrlStatus = text_only` is correct when the page only exposes visible CARFAX text. The extension must not click, fetch paid report content, or invent a URL.

## Network Observer Current State

The network observer is consent-gated and passive. It observes page-generated fetch/XHR JSON from allowed OpenLane/KAR vehicle/listing endpoints, denies auth/session/profile/account/payment/billing/user/token/cookie/password endpoints, never captures headers/cookies/authorization credentials, and emits capped sanitized field candidates.

If no CARFAX URL appears in network evidence, the truthful states are `text_only` or `missing`, not fabricated `url_found`.

## Root Cause Hypotheses

- The section map does not expose a narrow trusted `activeBidBar` zone, so sticky/footer active-bid text competes with ignored footer behavior and generic text fallback.
- The current bid resolver needs stricter money context and source priority so `Highest proxy applied $21,000` wins over bid-history `$11,100`.
- Count-like text after `Current bid` can still appear as a candidate and must remain rejected with explicit reasons.
- CARFAX `text_only` is not a failure unless a safe URL source is actually present but missed.

## Fixture Plan

Existing fixtures cover:

- `$13,700` before `Current bid` plus `4 Bids`.
- CARFAX text-only.
- CARFAX direct `href`, `data-href`, `data-url`, router metadata, and allowed network JSON.
- Backend bad-price evidence.

Added in this phase:

- `openlane-vdp-active-current-bid-proxy-history.html`: active `Highest proxy applied $21,000` plus lower bid-history `$11,100` and `2 Bids`.
- `openlane-vdp-active-current-bid-29-bids.html`: active `Current bid $5,100` plus `29 Bids` and transport estimate noise.

## Phase Plan

1. Add `activeBidBar` section-map support without trusting the whole footer.
2. Add strict money-context rejection for bid counts, transport, and bid-history noise.
3. Add a dedicated active current bid resolver with explicit source priority.
4. Preserve observation-only `listedPrice` semantics and backend price guards.
5. Expose current-bid/CARFAX diagnostics in widget and Copy JSON.
6. Keep CARFAX recovery limited to safe DOM/router/network URL sources.
7. Run fixture regression, extension verification, lint, build, and manual browser checks.
