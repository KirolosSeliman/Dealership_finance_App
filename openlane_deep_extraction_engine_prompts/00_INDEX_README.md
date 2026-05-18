# OpenLane Deep Extraction Engine Prompt Pack

This pack rebuilds OpenLane extraction from a superficial text/regex scraper into a robust, evidence-based extraction engine.

Current proven live issues:
- VIN can be visible but missing from JSON.
- Title can be wrong, for example auction datetime instead of vehicle title.
- Condition/disclosures/dealer notes can appear in `rawVisibleText` but not as structured fields.
- Carfax can be text-only with no extracted URL, yet the widget says "visible."
- Media extraction can miss gallery counts or include junk assets.
- OpenLane pages mix main vehicle content, sidebar, footer, market guide, bid history, and tabs.

Goal:
Extract correct, ML-ready OpenLane data:
- Carfax URL/status
- Images/videos
- VIN
- title/year/make/model/trim
- mileage and specs
- current bid/offer as observation only
- purchase/fee/post-sale outcomes only when valid
- disclosures, condition, known history, dealer notes, Q&A, OBD2 status
- evidence and confidence for every important field

Execution order:
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

Use `99_RUN_ALL_SEQUENCE_MASTER_PROMPT.md` to make Codex execute every phase sequentially.

Absolute rule:
Codex must not move to the next phase until the current one is 100% working. If it is not 100%, Codex must find the loopholes, fix them, and rerun verification.

Final self-check required in every phase:
Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
