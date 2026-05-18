# Dealer Flow — Ordered Codex Prompt Pack

Use these files one by one. Give them to Codex back to back, but do not merge multiple prompts into one task. The goal is to force Codex to stay focused and fix one root problem at a time.

## Recommended Order

1. `01_vehicle_deletion_safe_archive.md`  
   Fix the most dangerous data-loss issue first.

2. `02_tax_report_period_accuracy.md`  
   Fix tax/reporting correctness.

3. `03_purchase_tax_consistency.md`  
   Fix inconsistent 5% OpenLane tax behavior between SQL and TypeScript.

4. `04_atomic_expense_cash_impact.md`  
   Fix non-atomic expense + cash ledger writes.

5. `05_cash_ledger_reversal_integrity.md`  
   Replace unsafe cash deletion behavior with reversal/void logic.

6. `06_vehicle_edit_financial_corrections.md`  
   Add safe vehicle correction workflows for price/source/status/listed price.

7. `07_sale_void_correction_workflow.md`  
   Add safe sale correction/void workflow without destroying history.

8. `08_validation_domain_integrity.md`  
   Tighten Zod/domain validation and VIN rules.

9. `09_rate_limiting_production_security.md`  
   Replace weak in-memory rate limiting.

10. `10_mutation_api_domain_split.md`  
   Gradually split the giant mutation endpoint into domain routes.

11. `11_dealer_flow_app_feature_split.md`  
   Gradually split the giant client component into feature modules.

12. `12_market_snap_production_guardrails.md`  
   Make Market Snap honest, calibrated, and safe for MVP use.

13. `13_release_verification_suite.md`  
   Add final regression, financial, role, and launch verification suite.

## Rule for Codex

For each prompt:
- Inspect first.
- Fix only that problem and directly tied problems.
- Add tests.
- Run `npm test`, `npm run lint`, and `npm run build`.
- Do not claim success unless verified.
- If verification cannot fully run, explain exactly why.

## Release Standard

The app is not approved for real launch until:
- financial records are not destructively deleted,
- all ledger-changing writes are atomic or reversible,
- tax reports are correct by date period,
- sale/cash/vehicle correction workflows preserve audit history,
- permissions are verified,
- build/lint/tests pass,
- production environment variables and migrations are documented,
- manual browser verification is completed.
