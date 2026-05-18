# Codex Mega Prompt — Dealer Flow Production Hardening

You are acting as a SENIOR SOFTWARE ENGINEER, FINANCIAL SYSTEMS ARCHITECT, DATABASE INTEGRITY REVIEWER, SECURITY ENGINEER, QA LEAD, and STRICT RELEASE GATEKEEPER.

Repository: `https://github.com/KirolosSeliman/Dealership_finance_App`
Branch to inspect first: `main`

This prompt targets ONE production blocker. Do not drift into unrelated refactors. Fix the root problem and the directly tied secondary problems only.

Global rules:
- Inspect the current repository before changing anything.
- Do not assume a feature works because a file exists.
- Prefer small, surgical, production-grade changes over broad rewrites.
- Keep the existing product direction and UI style intact.
- Do not remove existing working features.
- Do not hardcode business logic in multiple places.
- Financial writes must be auditable, reversible, and safe.
- Database migrations must be idempotent, append-only where possible, and safe to run on an existing Supabase project.
- Never silently destroy finance, tax, sale, cash, or audit-history data.
- Add or update tests wherever the repo has a test structure.
- Run all available verification commands before claiming success:
  - `npm test`
  - `npm run lint`
  - `npm run build`
- If a command cannot run because of missing environment variables or unavailable services, explain exactly what blocked it and still run every static/unit check possible.
- Your final answer must include files changed, root cause, exact fix, tests added, commands run, results, remaining risks, and manual verification steps.


## Target Problem

**Title:** Unify purchase tax logic between TypeScript and SQL  
**Severity:** CRITICAL

## Root Problem

The TypeScript calculation logic applies 5% purchase tax only to OpenLane vehicle purchase price, but the SQL `create_vehicle_with_defaults` logic applies 5% purchase tax to every vehicle purchase with a positive purchase price.

This creates inconsistent vehicle cost basis, cash impact, dashboard metrics, sale profit, and tax reports.

## Secondary / Tied Problems

- Vehicle creation can calculate different tax rules than later TypeScript utilities.
- Non-OpenLane vehicles may get incorrect automatic 5% tax.
- Dashboard metrics can be wrong.
- Tax reports can be wrong.
- Sale cost basis can be wrong.
- Market Snap current cost basis can be wrong.
- Future developers may patch one layer and forget the other.

## Files / Areas Likely Involved

Likely files:
- `src/lib/domain/constants.ts`
- `src/lib/domain/calculations.ts`
- `src/lib/supabase/repository.ts`
- `supabase/migrations/20260508_p0_atomic_security.sql`
- `supabase/migrations/20260509_recurring_expenses_funding_source.sql`
- New migration under `supabase/migrations/`
- `tests/*.test.ts`

## Required Production-Grade Solution

Create one authoritative purchase-tax rule and make SQL and TypeScript match it.

Required business rule based on current product requirements:
- OpenLane vehicle purchase price: 5% tax.
- OpenLane auction fees: 15% tax.
- Repairs and other expenses: 15% only when selected/configured.
- Other purchase sources: no automatic 5% purchase tax unless a setting or explicit expense says so.

Implementation requirement:
1. Add a shared documented rule in constants.
2. Update TypeScript `calculateExpenseTax`.
3. Update SQL RPC `create_vehicle_with_defaults`.
4. If SQL cannot import TS constants, duplicate the numeric value only with explicit comments and tests that lock behavior.
5. Add tests proving TS calculation and SQL-created records follow the same rule.
6. Consider a DB function such as `calculate_purchase_tax_rate(p_purchase_source purchase_source)` to centralize DB-side tax rate.
7. Do not silently change historical data. If existing records were created with wrong tax, add a separate correction/repair script only if explicitly needed and safe.

## Implementation Plan

1. Inspect all places where `0.05`, `0.15`, `OPENLANE_PURCHASE_TAX_RATE`, and `QUEBEC_EXPENSE_TAX_RATE` are used.
2. Create or update a single DB function for purchase tax rate.
3. Update `create_vehicle_with_defaults` to use the correct source-aware rule.
4. Update tests for all purchase sources:
   - OpenLane
   - dealerAuction
   - IAA
   - Copart
   - FacebookMarketplace
   - trade
   - other
5. Verify dashboard and sale cost basis do not double-count.
6. Run all verification commands.

## Required Verification Matrix

Test matrix:
- OpenLane purchase at 10,000 creates purchase tax 500.
- FacebookMarketplace purchase at 10,000 creates purchase tax 0.
- trade purchase at 10,000 creates purchase tax 0.
- OpenLane auction fee expense at 1,000 creates tax 150.
- Repair expense with add 15% selected creates tax 15%.
- Repair expense with no tax selected creates tax 0.
- Run `npm test`, `npm run lint`, `npm run build`.

## Acceptance Criteria

- TS and SQL tax rules match.
- No source receives wrong automatic tax.
- Tests cover every purchase source.
- No historical data is silently rewritten.
- Build/lint/tests pass.

## Strict Boundaries

- Do not rewrite the whole app.
- Do not introduce a new stack.
- Do not fake success.
- Do not leave dead code, duplicated logic, or unused routes.
- Do not make UI-only changes if the bug is database/business-logic related.
- Do not claim production-ready until tests and build pass or until every failure is explained with exact evidence.



## Final Response Required From Codex

Return a concise but complete engineering report with:

1. Root cause confirmed from the current code.
2. Exact files changed.
3. Database migrations added or modified.
4. Tests added or updated.
5. Commands run and exact pass/fail results.
6. Manual verification checklist.
7. Remaining risks, if any.
8. Whether this specific blocker is now ready for real production use.
