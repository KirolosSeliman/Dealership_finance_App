# OpenLane Market Snap Extension Prompt Pack

## Goal

Build a deployable Chrome/Brave Market Snap extension for OpenLane vehicle detail pages.

The final UX must be:

1. The user opens an OpenLane vehicle page.
2. Market Snap detects the vehicle page automatically.
3. It extracts visible OpenLane data safely.
4. It calls Dealer Flow valuation API.
5. A small in-page widget shows retail value, wholesale value, max bid, confidence, warnings, and save action.
6. The popup becomes secondary: settings/status only.
7. The extension can save the listing and valuation to Deal Radar.

## Current Root Problem

The current extension is popup-triggered and generic. The manifest loads only `src/connectors.js` and `src/content-script.js`; the content script waits for a popup message; OpenLane uses generic text extraction; valuation results are rendered in popup, not inside OpenLane.

## Prompt Execution Order

Give Codex the files in this exact order:

1. `01_manifest_openlane_extension_foundation.md`
2. `02_openlane_specific_extractor.md`
3. `03_automatic_content_runtime.md`
4. `04_in_page_market_snap_widget.md`
5. `05_extension_api_client_and_settings.md`
6. `06_backend_openlane_payload_support.md`
7. `07_deal_radar_media_carfax_persistence.md`
8. `08_openlane_extension_test_suite.md`
9. `09_release_packaging_and_manual_verification.md`

Then use:

10. `99_RUN_ALL_SEQUENCE_MASTER_PROMPT.md`

## Strict Execution Rule

Codex must not fix everything in one uncontrolled pass. Each file is one root problem. Codex must finish, verify, and summarize the current prompt before moving to the next.

## Definition of Done

A prompt is done only when:

- the root cause is fixed
- second-, third-, and fourth-order consequences are addressed
- no unrelated app flows are broken
- lint passes
- tests pass
- build passes
- the extension behavior is manually verifiable
- any remaining risk is explicitly documented

## Global Constraints

- Do not weaken existing Market Snap guardrails.
- Do not remove the existing dashboard Market Snap flow unless replaced safely.
- Do not store service-role keys or Supabase secrets in extension code.
- Do not store huge base64 media blobs in Chrome storage.
- Do not bulk download OpenLane media by default.
- Do not over-normalize OpenLane-specific fields prematurely.
- Prefer plain JavaScript extension files unless a build pipeline already exists.
- Keep the extension small, fast, and deployable as an unpacked extension.

## Required Final Result

A deployable OpenLane extension with:

- `*.openlane.ca/*` and `*.openlane.com/*` support
- OpenLane-specific extraction
- automatic page analysis
- in-page widget
- retail/wholesale/max bid values
- Carfax URL detection
- photo/video URL extraction
- Deal Radar save
- fixture-based tests
- release packaging instructions

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
