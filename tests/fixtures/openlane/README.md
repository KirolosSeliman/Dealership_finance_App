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
