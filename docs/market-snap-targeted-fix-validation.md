# Market Snap Targeted Fix Validation

## Summary

This targeted pass fixed the OpenLane extraction safety issues covered by `dealer_flow_targeted_fix_prompts.zip`: local safe DOM attribute coverage, stable-capture routing for manual extraction, no-VIN preview-only handling, the failing Vercel cron deployment status, and stronger executable regression tests.

## Problems Fixed

- Safe DOM attribute extraction is local to `openlane-extractor.js` and redacts standalone `session` / `token` evidence.
- `MARKET_SNAP_EXTRACT` now uses the stable capture orchestrator and returns readiness/debug metadata.
- OpenLane listings without a valid VIN are preview-only: widget/copy can show them, but capture/save/training are blocked.
- Vercel failed because source-sync cron schedules exceeded Hobby-compatible frequency; schedules are now once daily.
- Critical OpenLane behavior tests now assert actual extracted output, field evidence, readiness metadata, network merge output, and redaction.

## Problem 1 Validation

- `browser-extension/src/openlane-extractor.js` contains a local `extractSafeDomAttributeText()` helper.
- `tests/openlane-extractor.test.ts` verifies VIN and CARFAX extraction from safe DOM attributes without requiring stable capture.
- The same test verifies `data-token`, `data-session`, token values, and session values do not appear in field evidence/debug output.
- `browser-extension/src/openlane-extraction-contract.js` redacts standalone `session` and `token` terms as a final safety gate.

## Problem 3 Validation

- `browser-extension/src/content-script.js` routes `MARKET_SNAP_EXTRACT` through `extractStableListing({ force: true })`.
- The response includes `listing`, `readiness`, and `debug`.
- The old direct manual bypass was removed from user-facing extract/copy paths.
- Stable extraction still clears caches, waits for SPA readiness, and applies Deep Capture consent gating before runtime use.

## Problem 4 Validation

- `browser-extension/src/openlane-stable-capture.js` returns `readyToCapture: false`, `state: "incomplete_identity"`, and `blockedReason: "missing_vin_openlane_preview_only"` for OpenLane missing-VIN listings.
- `browser-extension/src/content-script.js` blocks capture/save before `queueCapture()` when readiness is false.
- `browser-extension/src/market-snap-widget.js` disables Save when listing readiness is not ready.
- `src/lib/market-snap/repository.ts` requires VIN for OpenLane outcome training eligibility.
- Tests verify preview-only readiness, Save blocking signal, missing-VIN quality penalty, and training eligibility false.

## Problem 5 Validation

- GitHub reported Vercel failure on commit `1d51ccb3aceb572267c08ea18eae0511b818f099`; the status URL was `https://vercel.link/3Fpeeb1`.
- That status URL points to Vercel Cron usage/pricing. The repo had `0 9-18 * * *` and `0 12,18 * * *`, which run more than once daily and can fail Hobby deployments.
- `vercel.json` now uses `0 9 * * *` and `0 12 * * *`.
- `README.md` documents that the schedules are once daily for Vercel Hobby and should only be increased on Pro or with an external scheduler.
- GitHub Vercel status is passing on commit `d38a5c01837dd6dc88ed61274b6f69f9b58b688c`.

## Problem 6 Validation

- `tests/openlane-phase8-fixtures.test.ts` now asserts actual `fieldEvidence`, VIN debug candidates, missing VIN data, network JSON field evidence, and stable readiness metadata attached to listings.
- Existing executable tests cover VIN URL recovery, safe DOM attributes, CARFAX `data-href`, CARFAX `data-url`, text-only/missing CARFAX, network merge, redaction, active observation semantics, and route-change cache clearing.
- Marker tests remain only for file inclusion, manifest/script order, and basic security smoke checks.

## Commands Run

- `npm.cmd run verify:extension`
- `npm.cmd test`
- `npm.cmd run lint`
- `npm.cmd run build`

## Test Results

- Extension verification: 64 tests passed.
- Full test suite: 245 tests passed.
- Lint: passed with no errors.
- Build: passed with Next.js production build.
- ML service tests were not run because the ML service was not touched in this targeted pass.
- `vercel build` was not run locally because this workspace has no `.vercel/project.json`; live GitHub/Vercel status was used instead.

## Live Browser Test Checklist

1. Load the unpacked extension from `chrome://extensions`.
2. Set Dealer Flow URL.
3. Set Organization ID.
4. Enable debug mode.
5. Accept Deep Capture if testing network evidence.
6. Open a real logged-in `https://app.openlane.ca/vdp/...` page.
7. Confirm widget shows VIN found, CARFAX status, `ready_to_capture`, no blocked reason, and network observer status if Deep Capture is active.
8. Open a loading/search/home page and confirm no capture.
9. Open a no-VIN page/fixture if possible and confirm preview-only with Save disabled.
10. Click Copy JSON and confirm readiness/debug exists.
11. Click Save only on a valid VIN page and confirm a Deal Radar entry.

## Vercel Status

- Latest checked commit: `d38a5c01837dd6dc88ed61274b6f69f9b58b688c`.
- Vercel context: `success`.
- Status URL: `https://vercel.com/kirolosselimans-projects/dealership-finance-app/BBiqTGjEF6M5s8AcNCxWbnTarZtk`.

## Remaining Risks

- Real OpenLane logged-in SPA behavior still needs manual Chrome validation because local tests use fixtures and fake DOM objects.
- Vercel connector access to detailed deployment logs was not authorized for the `kirolosselimans-projects` scope; GitHub commit status was used for pass/fail.
- Source sync now runs once daily on Vercel Hobby. Increase frequency only after moving to a plan/scheduler that supports it.

## Final Go/No-Go

Go for targeted branch review and manual browser validation. Do not call the extension production-complete until the live OpenLane VDP checklist and Deal Radar save path are confirmed in the authenticated Chrome profile.
