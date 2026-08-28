# Dealer Flow Accounting Model V2

## Scope

Implement Accounting Model V2 end to end without rewriting or deleting legacy financial history. The implementation will add a new forward-only Supabase migration after `20260832`, version new sales explicitly, keep legacy sales readable under legacy semantics, and move all new sale and purchase-correction writes through server-side atomic RPCs.

## Verified root causes

- `src/lib/domain/calculations.ts` uses `calculateVehicleTotalCost` for sale math and mixes vehicle purchase price, purchase tax, and expense gross amounts. This makes cost basis and cash invested indistinguishable.
- `calculateSaleBreakdown` derives a paper sale price, taxable profit, and external commission from client-entered values instead of actual sale price, sales tax, and exact payment routing.
- `20260514_purchase_tax_consistency.sql` and the current vehicle RPC derive purchase tax from purchase source, so the client cannot record the actual tax rate on a purchase.
- `20260830_vehicle_correction_integrity.sql` updates purchase cash in place and does not accept or audit the actual purchase tax rate.
- `20260518`/`20260831` sale RPCs generate legacy `paper_sale_received` and `external_commission_earned` rows and the void path only knows those legacy effects.
- The current sale schema, mappers, validation, repository, dashboard, tax report, backup export, and UI expose legacy fields as if they were canonical V2 accounting values.

## Architecture and compatibility decisions

1. Add nullable V2 sale columns and `accounting_model_version` to `sales`; leave legacy columns and existing rows untouched. V2 rows use version `2`; legacy rows remain version `1`/null and are never given fabricated V2 values.
2. Add explicit `purchase_tax_rate`/`purchase_tax_amount`/`purchase_gross_amount` vehicle fields where needed for vehicle-entry snapshots, while treating the persisted purchase expense as the cash and tax source of truth. The V2 calculation helpers will avoid double counting purchase price when a live purchase expense exists and will provide a safe legacy fallback when it does not.
3. Add `record_vehicle_sale_accounting_v2`, `void_vehicle_sale_accounting_v2`, and `correct_vehicle_sale_accounting_v2` RPCs. They lock the organization and vehicle, authenticate and authorize, calculate every V2 amount on the server, create linked cash rows and audit logs in one transaction, and fail closed on missing/duplicate source rows.
4. Add `correct_vehicle_purchase_accounting_v2` with an explicit tax-rate input. It updates the vehicle purchase snapshot, purchase expense, linked cash impact, correction audit record, and activity log atomically, without creating duplicate cash effects.
5. Add V2 cash types: company `sale_payment_received`, `vehicle_tax_refund_received`, `vehicle_tax_payment_made`, `profit_tax_paid`; external `external_sale_payment_received`. Keep all legacy types and use source IDs plus correction links for every generated row.
6. Reversal logic is source-ID based. V2 sale void/correction reverses every generated V2 row exactly once, preserving originals, reversal links, and sale correction links. No fuzzy vehicle/date/amount matching is allowed for V2 rows.
7. Keep `calculateVehicleTotalCost` as deprecated compatibility logic only. Add explicit cent-normalized helpers for company cost basis, company gross cash invested, pending recoverable tax, external vehicle cost, sale tax, V2 sale breakdown, and both cash balances. Dashboard, tax reporting, Market Snap outcome calibration, and V2 UI use the explicit helpers/version-aware selectors.
8. Client validation accepts only nonnegative finite money/rates and exact-cent payment routing. Client-derived profit, tax, settlement, and cost fields are not accepted by the database RPCs.

## Implementation sequence

### 1. Red tests first

Add `tests/accounting-model-v2.test.ts` before production implementation. Cover:

- the canonical 13% purchase/expense/sale example and the 5% purchase variant;
- company cost basis versus gross company cash invested;
- exclusion of external-funded tax from recoverable company tax;
- external vehicle cost;
- sale tax, customer total, exact all-company and split routing;
- routing invariance for gross profit, profit tax, settlement, and tracked net profit;
- positive/negative settlement signs and cent rounding;
- invalid negative/non-finite/rate/payment mismatch input;
- legacy sale mapping remains readable without fabricated V2 values;
- V2 cash effect sign rules and source-linked reversal requirements;
- migration and manual bundle contain the new additive schema/RPC/security gates and do not modify old migration files.

Run the focused test file and record the expected red failure before adding implementation.

### 2. Domain model and validation

- Extend `src/types/domain.ts` with purchase-tax snapshot fields, nullable V2 sale fields, `accountingModelVersion`, and new cash transaction types.
- Add the V2 calculation module/helpers in `src/lib/domain/calculations.ts` with integer-cent normalization and explicit legacy/V2 boundaries.
- Extend constants for the 5% sales tax, 22% profit tax, purchase-tax options, and V2 cash types.
- Extend `src/lib/validation.ts` for purchase tax selection/correction and V2 sale form inputs; reject client authority fields.
- Update mappers with nullable V2 mapping so legacy rows preserve `undefined` rather than zero-filled V2 facts.

### 3. Forward-only database migration

Create only `supabase/migrations/20260833_accounting_model_v2.sql`:

- additive nullable columns and indexes;
- safe constraints for versions, rates, nonnegative money, and exact payment totals;
- additive transaction-type constraints;
- server-side calculation and atomic V2 record/correction/void functions;
- linked tax settlement and profit-tax cash rows;
- RLS/policy preservation and explicit `revoke all` from public/anon plus authenticated grants;
- safe search paths and role checks;
- no deletes/truncates/drops of financial history and no edits to old migration files.

Apply the migration to the authenticated project only after local review and structural tests. Verify it with Supabase SQL: columns, function signatures, ACLs, and live row counts.

### 4. Repository/API/UI integration

- Route create vehicle and purchase correction through V2 RPCs with explicit purchase tax.
- Route sale record, correction, and void through V2 RPCs for V2 sales while leaving legacy RPCs available for legacy data.
- Update the mutation schemas and error mapping.
- Replace the sale form with sale date, pre-tax sale price, 5% sales tax, derived customer total, company/split routing, buyer fields, notes, reconciliation, and V2 preview labels. Remove taxable-profit, paper-sale, real-client-payment, and external-commission inputs from V2 UI.
- Add purchase-tax selection to new-vehicle and purchase-correction forms. Render purchase expenses from persisted purchase tax facts; keep ordinary expense no-tax/15%/custom behavior and show the external-funded tax-settlement note.
- Update dashboard, vehicle details, monthly series, tax views, Market Snap calibration, and labels to be version-aware.

### 5. Backup, reports, and documentation

- Preserve V2 fields in full JSON, CSV, PDF summaries, dry-run restore, and tax-report exports.
- Update `README.md`, migration/deployment documentation, `supabase/MANUAL_APPLY_README.md`, and append the new migration to `supabase/MANUAL_APPLY_ALL.sql` without rewriting prior manual sections.
- Add a concise accounting-model root-cause and migration/rollback note for reviewers.

### 6. Verification and handoff

- Update old tests that assert legacy behavior only where the behavior is intentionally version-scoped; do not delete regression coverage.
- Run `npm run lint`, `npm run build`, and `npm test` after implementation, plus focused accounting and migration tests.
- Run live Supabase verification queries and check data preservation, RLS grants, function ACLs, source links, reversal links, and no duplicate purchase cash rows.
- Inspect the final diff, confirm only the focused branch contains changes, commit, push `codex/accounting-model-v2`, and report the branch/SHA/PR status. Do not merge.

## Exact regression values

For a `$1,900` purchase at 13%, company fees `$165` at 15%, transport `$125` at 15%, Carfax `$46.55` at 15%, inspection `$220` at 15%, external repair `$910`, and a `$6,300` sale at 5%:

- company cost basis `$2,456.55`;
- company gross cash invested `$2,787.03`;
- recoverable company tax `$330.48`;
- external vehicle cost `$910.00`;
- sales tax `$315.00`; customer total `$6,615.00`;
- gross profit `$3,843.45`; profit tax `$845.56`;
- tax settlement `+$15.48`; tracked net profit `$2,087.89`;
- starting company cash `$322`: all-company ending `$6,106.92`; split `5000/1615`: company `$4,491.92`, external receipt `$1,615.00`;
- 5% purchase variant: purchase tax `$95.00`, gross purchase `$1,995.00`, recoverable tax `$178.48`, settlement `-$136.52`, all-company ending `$5,954.92`.
