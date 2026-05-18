# OpenLane Data Extraction Phase Prompts — Index

## Purpose

This prompt pack focuses on implementing a reliable, safe, deployable OpenLane data extraction system for Dealer Flow / Market Snap.

The system must classify OpenLane pages, extract visible user-authorized data, separate active observations from verified outcomes, preserve purchase economics, and protect future ML models from bad labels.

## Core Principle

Active/current OpenLane bids are observations/features only. They are not final prices and must never be used as final ML labels.

Verified labels come from purchase pages, fee details, invoices, accepted negotiations, or explicit user confirmation.

## Execute in This Order

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
11. `99_RUN_ALL_SEQUENCE_MASTER_PROMPT.md`

## Required Verification

Every phase must run:

```powershell
npm run verify:extension
npm test
npm run lint
npm run build
```

Use `npm run verify:release` for broad/release-level changes.

## Final Self-Check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
