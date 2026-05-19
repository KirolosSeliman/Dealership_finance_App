# Market Snap Kia / Mazda / Incoherence Audit

## Problem Restatement

Recent live OpenLane payloads show three remaining data-quality risks after the current-bid and CARFAX hardening work:

- Kia Forte purchase pages can be correctly classified as purchase details while structured sold-price fields are still missing.
- Mazda active listings can expose a fresher `Current bid $10,300` while a stale sticky active bid bar still contains `$8,500`.
- Active pages can contain pickup instructions, Q&A text, transport estimates, market guide text, and disclosure counts that must not become purchase/outcome, condition, or canonical price evidence.

CARFAX remains truthful only if `url_found` comes from a real safe URL source. Visible CARFAX text without a URL must remain `text_only`.

## Confirmed Facts From Payloads

The ZIP describes the following live evidence:

- Kia purchase evidence: `Order history`, `Sold price`, `$4,000`, and `Mark as picked up`.
- Mazda active evidence: visible/latest `Current bid: $10,300`, `59 Bids`, and stale selected `currentBid: 8500` from `active_bid_bar`.
- False purchase marker evidence: pickup instruction text such as `picked up Monday - Friday`.
- Condition pollution evidence: Q&A, sidebar, footer, bid history, transport, market guide, and legal/footer text leaking into condition/disclosure fields.
- CARFAX evidence: visible CARFAX text without a proven URL in some payloads.

## Kia Purchase Outcome Evidence

Existing fixture coverage:

- `tests/fixtures/openlane/openlane-vdp-purchased-sold-price-picked-up.html`
- `tests/fixtures/openlane/openlane-purchase-detail-kia-realistic.html`

Relevant code paths:

- `browser-extension/src/openlane-page-classifier.js` identifies `purchase_detail` from VDP URL, order history, sold/selling price, purchase actions, and vehicle identity.
- `browser-extension/src/openlane-extractor.js` maps purchase/post-sale economic fields into `soldPriceCandidate`, `buyPriceAuction`, `finalBidAmount`, and `priceSemantics`.
- `src/lib/market-snap/validation.ts` requires outcome evidence and blocks active observations from claiming verified outcome prices.

The Kia failure hypothesis is that the page classification evidence can be present before the purchase price resolver receives a clean purchase panel/value pair, or that sold price appears in a shape not covered by the resolver.

## Mazda Stale Current Bid Evidence

Added fixture:

- `tests/fixtures/openlane/openlane-vdp-active-mazda-stale-active-bidbar.html`

Fixture evidence:

- Active bid panel: `Current bid $10,300` and `59 Bids`.
- Sticky active bid bar: `Current bid $8,500`.
- Expected future behavior: current bid resolver should prefer the freshest authoritative bid panel/top row or explicit network current bid over stale sticky active-bid-bar evidence.

Relevant current code paths:

- `openlane-section-map.js` builds `activeBidBar` and `bidPanel` zones.
- `openlane-extractor.js` currently scores `network_json`, `activeBidBar`, `bidPanel`, DOM text, label values, and visible text candidates.
- Prior fixes reject bid counts and lower history rows, but freshness arbitration between active bid bar and bid panel needs a dedicated phase.

## False Purchase Marker Evidence

Added fixture:

- `tests/fixtures/openlane/openlane-vdp-active-pickup-instructions-not-purchase.html`

The active listing contains dealer pickup instructions but no `Order history`, no `Sold price`, no invoice, no completed purchase panel, and no `Mark as picked up` action. Future classifier logic must keep it as `active_listing`.

Risky current path:

- `openlane-page-classifier.js` treats `picked up` as a purchase/action marker in scoped purchase text.
- Safe classification depends on the section map keeping generic dealer notes/transport/sidebar/footer out of purchase-scoped text.

## Condition Pollution Evidence

Existing fixtures:

- `openlane-vdp-noisy-qa-engine-transmission.html`
- `openlane-vdp-noisy-qa-sidebar-market-guide.html`
- `openlane-condition-disclosures-french.html`
- `openlane-hidden-tabs-disclosures.html`

Relevant code paths:

- `openlane-section-map.js` isolates `disclosuresCondition`, `dealerNotes`, `qaSection`, `transportBlock`, `marketGuide`, `sidebar`, and `footer`.
- `openlane-extractor.js` structures condition details and should not merge transport, market guide, legal, Q&A, or bid history text into canonical mechanical/exterior/interior disclosures.

## Carfax Current State

Existing fixtures cover:

- Text-only: `openlane-vdp-carfax-text-only.html`
- Network URL: `openlane-network-carfax-url.json`
- DOM href/data URL: `openlane-carfax-url.html`, `openlane-carfax-data-href.html`, `openlane-carfax-data-url.html`
- Router metadata: `openlane-vdp-carfax-router-metadata.html`, `openlane-router-carfax-url.html`

Truth rule remains: keep `carfaxUrlStatus = text_only` unless a safe real URL is visible in authorized page evidence.

## Network Observer Current State

The network observer is consent-gated and candidate-based. It exposes diagnostics for hook installation, queue flushing, allowed/denied/irrelevant/duplicate/parse-error events, and CARFAX candidate counts. It redacts sensitive keys and denies auth/session/profile/account/payment/billing/user/token/cookie/password endpoints.

## Root Cause Hypotheses

1. Kia structured outcome gaps likely come from purchase price resolver coverage, not classification alone.
2. Mazda stale bid selection likely comes from source-priority scoring that trusts `activeBidBar` over fresher bid-panel/top-row evidence without freshness semantics.
3. Pickup instruction false positives can occur if generic dealer/transport/pickup text is included in purchase-scoped classification text.
4. Condition pollution can occur when section boundaries over-include Q&A, bid history, transport, market guide, or footer text.
5. CARFAX `text_only` is correct unless a safe URL source is proven.

## Fixture Plan

Existing fixtures satisfy the Kia, Camry, Stinger, Hyundai condition, CARFAX text-only, CARFAX network, and CARFAX router requirements.

Added in Phase 0:

- `openlane-vdp-active-mazda-stale-active-bidbar.html`
- `openlane-vdp-active-pickup-instructions-not-purchase.html`

## Phase Plan

1. Phase 1: add a purchase outcome price resolver for Kia sold-price shapes and preserve transport/current-bid separation.
2. Phase 2: integrate purchase outcome fields into backend/widget/Copy JSON diagnostics.
3. Phase 3: make current bid freshness-aware so fresher bid-panel/top-row/network evidence can beat stale sticky active-bid-bar evidence.
4. Phase 4: add controlled re-extraction/stabilization for active bid updates.
5. Phase 5: disambiguate false purchase markers such as pickup instructions.
6. Phase 6: tighten condition/disclosure section boundaries.
7. Phase 7: keep CARFAX diagnostics truthful and recover URLs only from real safe sources.
8. Phase 8: add contradiction warnings to widget and Copy JSON.
9. Phase 9: keep backend and ML safety guards strict.
10. Phase 10: lock all new fixtures with regression tests.
11. Phase 11: document final automated and manual live-browser validation.
