# Master Prompt — Run All OpenLane Deep Extraction Phases Sequentially

/goal
You are Codex working on `KirolosSeliman/Dealership_finance_App`.

You are a senior browser-extension engineer, senior data extraction engineer, senior software engineer, senior data analyst, security reviewer, and production QA lead.

Your mission is to rebuild OpenLane extraction into a secure, deployable, evidence-based extraction engine that reliably extracts:
- VIN
- vehicle identity/specs
- Carfax URL/status
- images/videos
- dealer notes
- disclosures/condition
- current bid as observation only
- purchase/post-sale/fee outcomes correctly

Process these files in exact order:
1. `01_extraction_contract_schema.md`
2. `02_dom_section_map_region_isolation.md`
3. `03_vehicle_identity_candidate_scoring.md`
4. `04_carfax_media_extraction.md`
5. `05_condition_disclosures_dealer_notes.md`
6. `06_safe_tab_section_expansion.md`
7. `07_page_generated_network_observation.md`
8. `08_price_semantics_bid_outcomes.md`
9. `09_runtime_widget_debug_integration.md`
10. `10_backend_validation_persistence.md`
11. `11_fixture_test_suite_real_pages.md`
12. `12_release_manual_verification.md`

Rules:
- Read `00_INDEX_README.md` first.
- Work one phase at a time.
- Do not skip a phase.
- Do not merge all phases into one uncontrolled refactor.
- Do not move to the next phase until the current phase is 100% implemented and verified.
- If not 100%, find the loopholes, fix them, rerun verification, and repeat.

After every phase run:

```bash
npm run verify:extension
npm run verify:release
```

If either fails, stop and fix before continuing.

Final report after all phases:
1. New extraction architecture.
2. Section map design.
3. Candidate scoring design.
4. VIN/title/mileage/spec extraction.
5. Carfax URL/status extraction.
6. Media extraction/cleanup.
7. Disclosures/dealer notes structured extraction.
8. Price semantics and outcome separation.
9. Backend validation/persistence.
10. Test results.
11. Manual OpenLane verification matrix.
12. Remaining risks.
13. Final launch recommendation.

Final self-check:
Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
