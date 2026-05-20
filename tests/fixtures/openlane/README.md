# OpenLane Fixture Notes

Fixtures in this folder must be sanitized snapshots of visible page structure only.

- Do not include real customer names, credentials, cookies, tokens, or private report content.
- Keep known traps explicit in test names, such as mileage near trim digits, lazy media counts, fee totals, disclosures, and post-sale candidate prices.
- Current bids stay observation fixtures. Purchase invoices and accepted negotiations must use separate outcome fixtures.
- If a live OpenLane layout breaks extraction, add the smallest sanitized fixture that reproduces that layout before changing extractor code.

## Phase 8 Regression Coverage

- `openlane-spa-loading-shell.html` — synthetic SPA loading shell, not a capture-ready vehicle page.
- `openlane-basic.html`, `openlane-vdp-active-en.html`, `openlane-vdp-active-fr-touareg.html` — sanitized realistic visible-VIN VDP fixtures.
- `openlane-vdp-vin-in-url-only.html` — synthetic VDP where VIN recovery depends on the URL.
- `openlane-vdp-vin-data-attribute-only.html` — synthetic VDP where VIN recovery depends on safe DOM attributes.
- `openlane-invalid-vin.html` — synthetic invalid VIN fixture for rejection coverage.
- `openlane-carfax-url.html`, `openlane-with-carfax.html` — sanitized realistic direct CARFAX URL fixtures.
- `openlane-carfax-data-href.html`, `openlane-carfax-data-url.html` — synthetic CARFAX metadata URL fixtures.
- `openlane-carfax-text-only.html`, `openlane-active-kia-forte.html` — CARFAX visible text without a usable URL.
- `openlane-no-carfax.html` — synthetic VDP with no CARFAX evidence.
- `openlane-network-vdp-response.json`, `openlane-network-carfax-response.json` — synthetic allowed vehicle JSON fixtures with secrets included only to verify redaction.
- `openlane-route-change-a.html`, `openlane-route-change-b.html` — synthetic VDP route-change pair.
- `openlane-post-sale-accepted.html`, `openlane-post-sale-pending.html`, `openlane-post-sale-rejected.html` — sanitized outcome fixtures for verified, pending, and rejected post-sale states.
- `openlane-vdp-purchased-sold-price-picked-up.html` — sanitized purchased VDP variant with `Sold price`, `Order history`, and `Mark as picked up` text.
- `openlane-vdp-active-current-bid-control.html` — active VDP control with current bid and transport estimate noise.
- `openlane-vdp-noisy-qa-sidebar-market-guide.html` — Q&A/sidebar/market-guide pollution fixture for canonical-field zone tests.
- `openlane-vdp-carfax-text-only-control.html` — CARFAX visible text without an exposed URL.
- `openlane-vdp-active-current-bid.html`, `openlane-vdp-transport-estimate-no-listed-price.html` - exact Phase 8 active/transport controls.
- `openlane-vdp-noisy-qa-engine-transmission.html` - exact Phase 8 Q&A engine/transmission pollution fixture.
- `openlane-vdp-carfax-text-only.html`, `openlane-network-carfax-url.json` - exact Phase 8 CARFAX text-only and network URL fixtures.
- `openlane-vdp-active-current-bid-before-label-4-bids.html` - active VDP fixture reproducing the live `$13,700` before `Current bid` plus `4 Bids` bid-count trap.
- `openlane-vdp-active-current-bid-proxy-history.html` - active VDP fixture reproducing `Highest proxy applied $21,000` plus lower bid-history `$11,100` and `2 Bids`.
- `openlane-vdp-active-current-bid-with-lower-history-row.html` - Phase 10 required lower bid-history row fixture using the same `$21,000` versus `$11,100` trap.
- `openlane-vdp-active-current-bid-29-bids.html` - active VDP fixture reproducing `Current bid $5,100` plus `29 Bids` and transport estimate noise.
- `openlane-vdp-active-mazda-stale-active-bidbar.html` - active Mazda VDP fixture reproducing a stale sticky `$8,500` active bid bar with fresher bid-panel `Current bid $10,300` and `59 Bids`.
- `openlane-vdp-active-pickup-instructions-not-purchase.html` - active VDP fixture with pickup instruction text that must not be classified as purchase/outcome evidence.
- `openlane-vdp-kia-purchase-sold-price-picked-up.html` - Phase 10 purchased Kia VDP fixture with `Sold price $4,000` and true order-history `Mark as picked up` evidence.
- `openlane-vdp-mazda-stale-bidbar-fresh-bidpanel.html` - Phase 10 alias for the Mazda stale sticky bid bar vs fresh bid-panel current bid failure shape.
- `openlane-vdp-camry-highest-proxy-lower-row.html` - Phase 10 fixture for highest-proxy `$21,000` beating lower full bid-history rows and bid counts.
- `openlane-vdp-stinger-bid-count-vs-current-bid.html` - Phase 10 fixture for `$13,700` current bid beside `4 Bids` counter noise.
- `openlane-vdp-hyundai-qa-condition-pollution.html` - Phase 10 fixture combining Hyundai `$5,100`/`29 Bids` current-bid noise with Q&A engine/transmission text that must not populate canonical specs.
- `openlane-vdp-carfax-router-metadata.html`, `openlane-network-current-bid-carfax-diagnostics.json` - CARFAX router/network metadata fixtures for URL recovery diagnostics.
- `openlane-vdp-active-current-bid-with-bid-count.html`, `openlane-vdp-active-current-bid-footer-fallback.html`, `openlane-vdp-active-current-bid-no-money.html` - Phase 7 exact current-bid fixtures for bid-count rejection, sticky footer fallback, and no-money protection.
- `openlane-router-carfax-url.html`, `openlane-backend-bad-price-evidence.json` - Phase 7 exact CARFAX router and backend bad-price evidence fixtures.
