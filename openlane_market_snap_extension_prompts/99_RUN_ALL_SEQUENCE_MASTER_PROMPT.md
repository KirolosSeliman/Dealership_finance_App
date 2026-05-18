# Master Prompt — Execute All OpenLane Market Snap Extension Prompts Sequentially

/goal
You are working on the Dealer Flow repository:

`KirolosSeliman/Dealership_finance_App`

I uploaded a ZIP containing multiple Markdown prompt files for the OpenLane Market Snap extension.

Your mission is to complete every prompt file sequentially, one problem at a time, until the OpenLane extension is deployable.

Do not solve everything at once.
Do not merge all prompts into one uncontrolled refactor.
Do not skip files.
Do not move to the next prompt until the current prompt is fully fixed, verified, and summarized.

## Required Order

1. `00_INDEX_README.md`
2. `01_manifest_openlane_extension_foundation.md`
3. `02_openlane_specific_extractor.md`
4. `03_automatic_content_runtime.md`
5. `04_in_page_market_snap_widget.md`
6. `05_extension_api_client_and_settings.md`
7. `06_backend_openlane_payload_support.md`
8. `07_deal_radar_media_carfax_persistence.md`
9. `08_openlane_extension_test_suite.md`
10. `09_release_packaging_and_manual_verification.md`

## Execution Rules

For each prompt file:

1. Read the full prompt.
2. Identify the root cause.
3. Identify second-, third-, and fourth-order consequences.
4. Inspect the real repository files before editing.
5. Implement the smallest safe deployable fix that actually solves the root problem.
6. Do not break the rest of Dealer Flow.
7. Do not weaken Market Snap valuation guardrails.
8. Do not weaken security or permissions.
9. Do not implement bypassing, evasion, hidden scraping, CAPTCHA bypass, login bypass, or unauthorized Carfax access.
10. Add tests or update tests.
11. Run verification.
12. Summarize the result.
13. Only then move automatically to the next prompt file.

## Global Target

The final extension must:

- support OpenLane `.ca` and `.com`
- automatically detect OpenLane vehicle pages
- automatically extract visible vehicle data
- extract VIN, mileage, year/make/model/trim
- extract bid/buy-now/listed price when visible
- extract Carfax link when visible
- extract photos and videos metadata when visible
- extract condition/declaration/announcement text
- call Dealer Flow Market Snap backend
- show a compact in-page widget with retail and wholesale values
- show max bid, confidence, comparable count, recommendation, warnings, missing data
- save to Deal Radar
- keep popup only as settings/status/manual fallback
- pass lint, tests, build, and release verification
- be loadable as unpacked extension in Chrome and Brave

## Required Verification After Each Prompt

Run:

```bash
npm run lint
npm test
npm run build
```

If the prompt affects release-level behavior, also run:

```bash
npm run verify:release
```

## Required Final Verification

After all prompt files are complete, run:

```bash
npm run lint
npm test
npm run build
npm run verify:release
```

Then perform or document manual verification:

1. Load extension unpacked in Chrome.
2. Load extension unpacked in Brave.
3. Configure Dealer Flow base URL and organization ID.
4. Log into Dealer Flow.
5. Log into OpenLane.
6. Open OpenLane vehicle page.
7. Confirm widget appears automatically.
8. Confirm extraction works.
9. Confirm retail and wholesale values appear.
10. Confirm Carfax/photos/videos are extracted when visible.
11. Confirm Save to Deal Radar works.
12. Confirm unsupported pages do not get intrusive widget.

## Required Checkpoint Report After Each File

After each prompt file, report:

- prompt file completed
- root cause fixed
- files changed
- tests added/updated
- commands run
- lint result
- test result
- build result
- manual verification result if applicable
- remaining risks
- whether it is safe to move to the next file

## Final Report

After all files are complete, produce:

1. Final extension architecture
2. Files changed
3. Backend changes
4. Database migrations
5. Tests added
6. Install instructions
7. Chrome verification
8. Brave verification
9. OpenLane verification
10. Remaining risks
11. Final launch judgment: deployable or not deployable

## Mandatory Safety Boundaries

Do not implement:

- CAPTCHA bypass
- login bypass
- anti-bot evasion
- proxy rotation
- fake user-agent rotation
- hidden background scraping
- bulk crawling
- unauthorized API calls
- Carfax paywall bypass
- storage of private credentials

Allowed:

- extracting visible DOM content from the current active OpenLane page
- extracting visible links and media URLs
- sending the user-authorized visible listing data to the configured Dealer Flow backend
- saving the result to the user’s Dealer Flow Deal Radar

## Start

Start now by reading `00_INDEX_README.md`, then proceed to `01_manifest_openlane_extension_foundation.md`.

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
