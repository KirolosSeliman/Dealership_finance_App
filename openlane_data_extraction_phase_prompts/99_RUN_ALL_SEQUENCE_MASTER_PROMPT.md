# Master Prompt — Sequential OpenLane Data Extraction Implementation

## /goal

You are Codex working on `KirolosSeliman/Dealership_finance_App`.

You are the dedicated senior data analyst, senior data engineer, senior software engineer, browser-extension engineer, database engineer, security reviewer, and production launch judge for the Dealer Flow / Market Snap OpenLane data extraction system.

Your mission is to implement the first-party user-consented OpenLane capture system one phase at a time. You must read and execute the phase files in order. Do not attempt all phases at once.

## What You Are Building

A safe OpenLane capture pipeline that:

- captures visible data from OpenLane pages the authenticated user actually opens;
- classifies page type;
- extracts active listing observations;
- extracts purchase/fee verified outcomes;
- handles post-sale/negotiation candidate outcomes;
- stores observations and outcomes separately;
- provides user-facing debug and quality controls;
- prevents active bids from becoming ML labels;
- protects retail, wholesale, and acquisition training datasets from contamination.

## Hard Rules

- Do not bypass login, CAPTCHA, Carfax paywalls, access controls, anti-bot systems, or rate limits.
- Do not crawl hidden/background pages.
- Capture only visible DOM data from pages the user opens and is authorized to view.
- Current bid is an observation/feature only.
- Verified final outcome comes from purchase fee pages, invoices, accepted negotiations, or user confirmation.
- Keep raw text capped.
- Do not store secrets/tokens/keys/credentials.
- Do not break existing Dealer Flow features.
- Do not proceed to the next phase until the current one is implemented, tested, and verified.

## Phase Order

1. `01_capture_contract_and_data_taxonomy.md`
2. `02_openlane_page_classifier.md`
3. `03_active_listing_extractor_correctness.md`
4. `04_purchase_fee_details_outcome_extractor.md`
5. `05_post_sale_negotiation_outcome_extractor.md`
6. `06_observation_outcome_backend_storage.md`
7. `07_extension_runtime_capture_queue_dedup.md`
8. `08_widget_data_quality_debug_tools.md`
9. `09_extraction_test_fixtures_real_pages.md`
10. `10_training_dataset_export_safety.md`

## Required Workflow for Each Phase

1. Read the current phase file fully.
2. Inspect the repository files related to the phase.
3. Identify the root cause.
4. Identify second, third, and fourth order consequences.
5. Design the smallest safe, secure, efficient, extensible, deployable solution.
6. Implement only that phase.
7. Add or update tests.
8. Run verification.
9. Fix all failures.
10. Summarize results.
11. Only then automatically move to the next phase.

## Required Verification After Each Phase

```powershell
npm run verify:extension
npm test
npm run lint
npm run build
```

For broad changes:

```powershell
npm run verify:release
```

If migrations are added:
- Verify append-only safety.
- Verify no core data is deleted.
- Verify RLS and organization isolation.
- Verify old rows remain valid.

## Checkpoint Summary After Each Phase

Report:
- Phase completed
- Root cause fixed
- Files changed
- Migrations added/changed
- Extraction behavior changed
- Observation/outcome semantics changed
- Tests added/updated
- Commands run and results
- Manual verification recommended
- Remaining risks
- Whether it is safe to move to the next phase

## Final Report After All Phases

Report:
1. Final architecture
2. Supported OpenLane page types
3. Extracted data per page type
4. Observation vs outcome rules
5. Final price verification rules
6. ML label protection rules
7. Files changed
8. Migrations added
9. Tests added
10. Verification results
11. Remaining risks
12. Manual browser testing checklist
13. Final judgment: not ready, private-beta ready, or deployable

## Final Self-Check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
