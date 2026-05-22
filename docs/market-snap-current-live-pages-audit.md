# Market Snap Current Live Pages Audit

## Toyota Corolla Active Listing Evidence

The sanitized Toyota active listing fixture is `tests/fixtures/openlane/openlane-vdp-corolla-carfax-visible-link-condition-pollution.html`.

Observed live-shape facts represented in the fixture:

- `pageType = active_listing`
- `captureKind = observation`
- VIN `5YFB4RBE9LP030604`
- current bid `$5,600`
- visible Known history panel with a blue-style `Always view the CARFAX report` anchor
- condition text pollution from legal/disclaimer text, navigation-adjacent text, transport estimate text, location text, and single-token garbage
- active current-bid UI in both bid panel and sticky footer

The separate payload fixture `tests/fixtures/openlane/openlane-vdp-corolla-active-listing-no-purchase-outcome-evidence.json` preserves the specific copied-JSON failure mode: an active listing had non-empty `purchaseOutcome.evidence` and weak `auctionObservation.evidence` provenance of `legacy_flat_field`.

## Kia Forte Purchase Detail Evidence

The sanitized Kia purchase fixture is `tests/fixtures/openlane/openlane-vdp-kia-purchase-carfax-visible-link-sold-price.html`.

Observed live-shape facts represented in the fixture:

- `pageType = purchase_detail`
- `captureKind = verified_outcome`
- VIN `3KPFL4A72HE119966`
- visible `Sold price $4,000`
- visible `Mark as picked up`
- visible Known history CARFAX anchor
- rejected noise sources still present in raw DOM: `Current bid $31,500`, `CAD $378 / 211km`, and `15 Bids`

## Carfax Link Evidence

The current live-page evidence must distinguish a real URL from text-only CARFAX text.

The new fixtures model the visible CARFAX control as an anchor:

```html
<a href="/vehicle-history/carfax/5YFB4RBE9LP030604" aria-label="Always view the CARFAX report">
  Always view the CARFAX report
</a>
```

This means the expected resolver path is `a[href]` / `link_href`, not a paid-report fetch and not a click action. The extractor already has code paths for `a[href]`, `data-href`, `data-url`, `data-report-url`, safe attributes, hydration JSON, and allowed network JSON. If the real live page still returns `text_only`, the likely root cause is one of:

- the Known history panel was not in the scanned DOM at extraction time,
- the safe expander did not expose the Known history tab before extraction,
- the visible control is implemented as router metadata or click-state rather than an ordinary anchor,
- URL sanitization rejected the URL because it was not a trusted CARFAX/OpenLane report URL,
- or Copy JSON/widget/backend consumed a stale pre-expansion payload.

No phase should invent a CARFAX URL. If no safe URL is present in DOM/router/network evidence, `carfaxUrlStatus` must remain `text_only`.

## Condition Pollution Evidence

The Corolla fixture preserves these pollution classes:

- legal/disclaimer fragments: `condition, or safety of any vehicle`, `OPENLANE does not guarantee`
- transport/location blocks: `Transport estimate CAD $428 / 185km`, `Vehicle location: Montreal, QC`
- navigation/context text from the active page
- single-token garbage such as `g`
- section misassignment examples where exterior/interior labels bleed into each other

The current contract code still has a risk point: canonical condition state may fall back to legacy flat `conditionReportText` and broad text-derived condition arrays. Later phases must prefer precise DOM section AST data and quarantine broad text into diagnostics rather than canonical ML fields.

## Active Listing PurchaseOutcome Evidence Bug

The code path to inspect is `browser-extension/src/openlane-extraction-contract.js`.

Current risk observed from code:

- `normalizeOpenLaneCanonicalState()` builds `purchaseOutcome.evidence` from `purchaseOutcomeSource.evidence`, `listing.outcomeEvidence`, or `listing.fieldEvidence?.soldPriceCandidate`.
- `pageContext.evidence` also receives `listing.outcomeEvidence`.
- On an active listing, global page evidence such as Known history or CARFAX text can therefore appear under purchase outcome evidence if not gated by page type/capture kind.

The desired behavior is strict: active listings may keep rejected/diagnostic evidence, but canonical `purchaseOutcome` must be empty unless the page is a trusted purchase/outcome context with sold/acquisition evidence.

## CurrentBid Evidence Provenance Bug

The Corolla current-bid fixture is `tests/fixtures/openlane/openlane-vdp-corolla-currentbid-evidence-source.html`.

The observed bug is not the numeric bid value. The bid value can be correct (`5600`) while evidence provenance remains weak, for example:

```json
{
  "sourceType": "legacy_flat_field",
  "sourceText": "currentBid: 5600"
}
```

Canonical `activeAuction.evidence` should point to the visible bid panel or sticky current-bid source, including source text such as `Current bid $5,600 Under 1 min` when available.

## Root Cause Summary

Confirmed from code and represented fixtures:

- CARFAX URL extraction is candidate-based and supports anchor/attribute/router/network evidence, but live output can still be `text_only` if the Known history link is not present when extraction runs or if the URL is represented outside the scanned evidence.
- Canonical purchase outcome evidence is not fully page-context-gated and can inherit global `outcomeEvidence`.
- Condition canonicalization still needs a stricter DOM section AST source of truth for live pages with tab/panel bleed.
- Current bid value and current bid evidence provenance are separate; legacy flat field evidence is insufficient for canonical/debug trust.

Assumptions still requiring live Chrome confirmation:

- The real Toyota and Kia controls expose a safe href equivalent to the sanitized fixtures. If the real control uses router state or a click handler, Phase 1 must target that source instead.
- The live Known history panel may require read-only expansion before extraction.

## Fixture Plan

Added fixtures:

- `openlane-vdp-corolla-carfax-visible-link-condition-pollution.html`
- `openlane-vdp-kia-purchase-carfax-visible-link-sold-price.html`
- `openlane-vdp-corolla-active-listing-no-purchase-outcome-evidence.json`
- `openlane-vdp-corolla-currentbid-evidence-source.html`

Added test:

- `tests/openlane-current-live-pages-fixtures.test.ts`

The test only verifies fixture/audit coverage. It does not change production behavior.

## Phase Plan

1. Phase 1: make visible CARFAX link resolution durable across anchor, data attributes, router metadata, safe click metadata, and known-history expansion timing.
2. Phase 2: replace broad condition text fallback with a precise DOM section AST and canonical quarantine for noisy lines.
3. Phase 3: gate purchase outcome evidence so active listings cannot carry canonical purchase outcome evidence.
4. Phase 4: require canonical current-bid provenance from visible bid panel/sticky bid evidence, not `legacy_flat_field`.
5. Phase 5: verify purchase outcome UI/save behavior stays correct for Kia.
6. Phase 6: keep network observer truthfully diagnostic and consent-gated while allowing safe CARFAX URL fallback from authorized JSON.
7. Phase 7: keep backend and ML guards strict for canonical data.
8. Phase 8: ensure widget and Copy JSON consume canonical debug state.
9. Phase 9: run full regression and live validation checklist.
