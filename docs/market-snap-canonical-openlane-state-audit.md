# Market Snap Canonical OpenLane State Audit

## Problem Restatement

The OpenLane extraction pipeline has accumulated several one-off fixes around live bids, purchase outcomes, CARFAX, condition disclosures, network evidence, readiness, and vehicle identity. The canonical-state work should make those domains explicit so the widget, Copy JSON, backend save path, and ML eligibility gates consume the same truthful state instead of letting legacy flat fields override better evidence.

## Confirmed Facts From Payloads

The repository already contains sanitized fixtures and executable tests for the latest live failure shapes:

- final-minute Nissan bid evidence where fresh `Current bid $14,200` must beat stale sticky `$13,800` and `71 Bids`
- Kia purchase detail evidence with `Sold price $4,000` and `Mark as picked up`
- CARFAX visible text with no URL, direct/router URL metadata, and safe network URL metadata
- condition/disclosure pollution from headers, bid rows, footer/legal text, transport, sidebar, Q&A, and market guide text
- network observer diagnostics for zero evidence, allowed safe endpoints, denied sensitive endpoints, irrelevant JSON, parse errors, and token redaction
- multi-word model examples for Hyundai Santa Fe Sport, Mazda Mazda3, Toyota Camry Hybrid, Nissan Frontier Crew Cab, Kia Stinger, and Kia Forte

## Live Bid Evidence

Primary fixture:

- `tests/fixtures/openlane/openlane-vdp-nissan-final-minute-bid-refresh.html`

Confirmed shape:

- `vehicle-hero` has VIN `1N6ED1EK0PN123456`
- bid panel has `Current bid`, `$14,200`, `Under 1 min`, and `71 Bids`
- sticky footer active bid bar has stale `$13,800`

Current executable coverage:

- `tests/openlane-extractor.test.ts` selects `currentBid = 14200`
- `tests/openlane-bid-live-monitor.test.ts` updates from `13800` to `14200`
- `tests/openlane-phase12-fixtures.test.ts` rejects `13800` and `71`

Canonical state implication:

- active bid state must keep accepted fresh bid, stale bid candidates, bid-count rejections, source text, freshness/recency, and bid monitor status separately.

## Purchase Detail Evidence

Primary fixture:

- `tests/fixtures/openlane/openlane-vdp-kia-purchase-sold-price-picked-up-live.html`

Confirmed shape:

- `pageType = purchase_detail`
- `captureKind = verified_outcome`
- VIN `3KPFL4A72HE119966`
- `Order history`
- `Sold price`
- `$4,000`
- `Mark as picked up`
- nearby transport estimate `CAD $378 / 211km` must not become price

Current executable coverage:

- `tests/openlane-extractor.test.ts`
- `tests/openlane-phase10-fixtures.test.ts`
- `tests/openlane-phase12-fixtures.test.ts`
- `tests/market-snap-validation.test.ts`

Canonical state implication:

- purchase/outcome price state must expose sold/acquisition candidates and trusted purchase evidence separately from active bid observations.

## Purchase List Evidence

Primary fixture:

- `tests/fixtures/openlane/openlane-purchase-list.html`

Added Phase 0 fixture:

- `tests/fixtures/openlane/openlane-purchase-list-sold-price-card-live.html`

Confirmed shape:

- purchase-list context
- card-level vehicle identity
- visible `Sold price $4,000`
- status is pending/candidate, not verified pickup detail

Canonical state implication:

- purchase-list cards should be candidate outcome context, not active listing context, and should require stronger detail/evidence before verified outcome labels or ML eligibility.

## Carfax Evidence

Primary fixtures:

- `tests/fixtures/openlane/openlane-vdp-carfax-text-only-live.html`
- `tests/fixtures/openlane/openlane-carfax-url.html`
- `tests/fixtures/openlane/openlane-carfax-data-href.html`
- `tests/fixtures/openlane/openlane-carfax-data-url.html`
- `tests/fixtures/openlane/openlane-router-carfax-url.html`
- `tests/fixtures/openlane/openlane-network-carfax-url-live.json`

Confirmed behavior:

- text-only CARFAX evidence stays `carfaxUrlStatus = text_only`
- safe DOM/router/network metadata produces `url_found`
- token-like query parameters are stripped
- no paid CARFAX report content is fetched or bypassed

Canonical state implication:

- CARFAX state must distinguish `missing`, `text_only`, and `url_found`, with source counts and rejection reasons.

## Condition Pollution Evidence

Primary fixtures:

- `tests/fixtures/openlane/openlane-vdp-condition-pollution-live.html`
- `tests/fixtures/openlane/openlane-vdp-condition-section-boundary-noise.html`
- `tests/fixtures/openlane/openlane-vdp-hyundai-qa-condition-pollution.html`
- `tests/fixtures/openlane/openlane-vdp-noisy-qa-sidebar-market-guide.html`

Confirmed bad shapes:

- `Mechanical` section can contain `Exterior`
- `Exterior` section can contain `Interior`
- tire/wheel section can contain `& wheels` or `Tire & wheels`
- condition areas can contain bid history, current bid, legal/footer text, transport text, Q&A, sidebar, and market guide text

Current executable coverage:

- `tests/openlane-extractor.test.ts`
- `tests/openlane-phase10-fixtures.test.ts`
- `tests/openlane-phase12-fixtures.test.ts`

Canonical state implication:

- condition/disclosure state needs section boundaries, accepted condition lines, rejected noisy lines, and rejection reasons; canonical condition arrays must not include UI/navigation/bid/legal noise.

## Context-Aware Missing Data Evidence

Primary fixtures:

- `tests/fixtures/openlane/openlane-vdp-kia-purchase-sold-price-picked-up-live.html`
- `tests/fixtures/openlane/openlane-vdp-purchased-sold-price-picked-up.html`
- `tests/fixtures/openlane/openlane-vdp-transport-estimate-no-listed-price.html`

Confirmed behavior:

- purchase/outcome pages should require sold/acquisition price evidence, not `listedPrice`
- active listing pages can be ready without listedPrice because current bid is observation-only
- missing VIN still keeps OpenLane capture preview-only

Canonical state implication:

- readiness state must derive required fields from page context and capture kind, not from a flat universal missing-data list.

## Network Observer Evidence

Primary fixtures:

- `tests/fixtures/openlane/openlane-network-observer-zero-evidence-live.json`
- `tests/fixtures/openlane/openlane-network-carfax-url-live.json`
- `tests/fixtures/openlane/openlane-network-current-bid-carfax-diagnostics.json`
- `tests/fixtures/openlane/openlane-network-vdp-response.json`

Confirmed behavior:

- zero-evidence diagnostics explain that no useful OpenLane vehicle JSON has been observed yet
- safe vehicle/CARFAX endpoints are allowed
- profile/session/user/payment/token endpoints are denied
- response bodies are never captured for denied diagnostics
- sensitive keys and token-like URL parameters are redacted

Canonical state implication:

- network evidence state must separate observer installation, event counts, allowed/denied/irrelevant/parse-error counts, endpoint patterns, source candidates, and sanitized evidence.

## Multi-Word Model Evidence

Primary fixtures and tests:

- `tests/fixtures/openlane/openlane-vdp-hyundai-santa-fe-sport-title.html`
- `tests/fixtures/openlane/openlane-vdp-nissan-final-minute-bid-refresh.html`
- `tests/openlane-extractor.test.ts` table for Hyundai Santa Fe Sport, Mazda Mazda3, Toyota Camry Hybrid, Nissan Frontier Crew Cab, Kia Stinger, Kia Forte

Confirmed behavior:

- `2014 Hyundai Santa Fe Sport SE` parses as make `Hyundai`, model `Santa Fe Sport`, trim `SE`
- `2020 Toyota Camry Hybrid XLE` parses as model `Camry Hybrid`
- `2023 Nissan Frontier Crew Cab SV` keeps `Frontier` as model and `Crew Cab SV` as trim

Canonical state implication:

- vehicle identity state must preserve make-scoped multi-word model normalization and expose rejected/alternate title candidates.

## Fixture Plan

Existing fixtures cover most required live shapes. Phase 0 added:

- `tests/fixtures/openlane/openlane-purchase-list-sold-price-card-live.html`

Future fixture additions should remain sanitized and minimal:

- no real user/customer data
- no credentials, cookies, tokens, auth headers, session data, account/profile/payment/billing data
- no paid CARFAX report content
- only visible/user-authorized vehicle/listing/business evidence

## Phase Plan

1. Canonical state contract: define a durable state object for identity, page context, bid, purchase outcome, CARFAX, condition, media, network, readiness, widget/debug, backend/save/ML gates.
2. Live bid state controller: make fresh bid panel/current bid evidence authoritative over stale sticky bars and count text.
3. Purchase outcome resolver: map purchase detail/list price evidence into canonical candidate/verified outcome state.
4. CARFAX resolver: consolidate DOM/router/network URL truth and text-only diagnostics.
5. DOM section AST condition extractor: preserve section boundaries and rejected noisy lines.
6. Context-aware readiness: derive missing data from page type and capture kind.
7. Widget/Copy JSON/backend alignment: consume canonical state instead of contradictory legacy fields.
8. Network observer truth layer: make zero/allowed/denied/irrelevant/parse-error states actionable.
9. Multi-word identity normalization: keep make-scoped model dictionaries and evidence.
10. Backend guards and ML safety: preserve strict validation and training-label separation.
11. Contradiction debug: expose stale/fresh/rejected/accepted candidates without secrets.
12. Fixture regression suite: keep live regressions executable.
13. Live browser validation: final release gate in authenticated Chrome/OpenLane.
