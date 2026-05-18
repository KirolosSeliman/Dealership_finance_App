# Dealer Flow / Market Snap OpenLane Extension Prompt

Repository: `KirolosSeliman/Dealership_finance_App`

Scope: `browser-extension/`, Market Snap API routes, Market Snap types/validation, Deal Radar save flow, Market Snap tests, and only the adjacent backend/storage code required for this specific issue.

You are acting as a senior extension engineer, product engineer, security reviewer, QA lead, and launch-readiness judge for Dealer Flow.

Non-negotiable safety rule: this is an authorized visible-page capture extension. Do not implement CAPTCHA bypass, login bypass, anti-bot bypass, proxy evasion, stealth scraping, hidden page crawling, or unauthorized Carfax/paywall extraction. Extract only what the logged-in user can already see on the current OpenLane page.


# 08 — OpenLane Extension Test Suite

## Root Problem

The extension currently lacks strong fixture-based tests proving OpenLane extraction, media detection, Carfax detection, widget rendering, and backend payload compatibility.

## Second-Order Consequences

- OpenLane layout changes can silently break extraction.
- Codex can claim success without proof.
- Extension deployability cannot be judged.
- Bugs appear only during manual use.

## Third-Order Consequences

- Retail/wholesale values may be based on broken extraction.
- Deal Radar may save incomplete data.
- User loses trust when extension works on one page but not another.
- Future refactors can break extension behavior undetected.

## Fourth-Order Consequences

- Not ready for deployment.
- Impossible to maintain confidently.
- Future Market Snap ML/calibration receives corrupted data.

## Required Solution

Add a dedicated OpenLane extension test suite using fixture HTML and static extension checks.

## Required Fixture Directory

Create:

`tests/fixtures/openlane/`

Add fixtures:

1. `openlane-basic.html`
   - year/make/model/trim
   - VIN
   - mileage
   - current bid
   - buy now price
   - location

2. `openlane-with-carfax.html`
   - visible Carfax link
   - history report label

3. `openlane-with-photos-videos.html`
   - img tags
   - srcset
   - background image
   - video tag
   - source tag
   - iframe/link video

4. `openlane-condition-report.html`
   - declarations
   - damage
   - mechanical
   - structural
   - odometer announcement
   - keys/tire condition if possible

5. `openlane-missing-data.html`
   - intentionally missing price or VIN
   - verifies missingData and warnings

## Required Tests

Create or update:

- `tests/openlane-extractor.test.ts`
- `tests/browser-extension.test.ts`
- `tests/market-snap.test.ts`

Test the extractor:

- identifies OpenLane vehicle page
- extracts VIN
- extracts year/make/model/trim
- extracts mileageKm
- extracts currentBid
- extracts buyNowPrice
- extracts location/province
- extracts Carfax URL
- extracts photos array
- extracts videos array
- extracts conditionReportText
- extracts declarations/announcements
- builds missingData
- computes extractionConfidenceScore
- dedupes media URLs
- normalizes relative URLs

Test manifest:

- includes `.openlane.ca`
- includes `.openlane.com`
- includes required scripts
- does not include `<all_urls>`
- does not include unnecessary broad permissions

Test widget:

- widget file exists
- duplicate prevention exists
- retail/wholesale/max bid/confidence labels exist
- refresh/save/copy/open/collapse actions exist

Test backend compatibility:

- rich OpenLane payload passes validation
- unsafe payload fails validation
- existing generic payload still passes validation

## Testing Approach

If current extension scripts are plain browser JS, make extractor functions testable by:

- exporting with CommonJS-compatible fallback if test environment supports it
- or adding a thin test wrapper
- or making functions attach to `window.DealerFlowOpenLaneExtractor` and testing in a JSDOM-like or minimal DOM environment

Do not introduce heavy dependencies unless necessary.

If no DOM test dependency exists, use simple Node test with a minimal DOM parser only if already available. If adding a dependency is necessary, justify it and keep it minimal.

## Acceptance Criteria

- Test fixtures exist.
- Tests prove extraction quality.
- Tests prove manifest is correctly scoped.
- Tests prove widget code exists and includes required states/actions.
- Tests prove backend validation accepts rich payload.
- `npm test` passes.
- `npm run verify:release` passes.

## Verification

Run:

```bash
npm run lint
npm test
npm run build
npm run verify:release
```

Manual verification remains required after tests.

## Required Report From Codex

Report:

- fixtures created
- extraction cases covered
- manifest cases covered
- widget cases covered
- backend cases covered
- limitations of tests
- commands run and results

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
