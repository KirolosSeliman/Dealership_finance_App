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

**Title:** Make expense creation/update atomic with cash ledger impact  
**Severity:** CRITICAL

## Root Problem

Expense creation currently inserts a `vehicle_expenses` row and then inserts the linked company/external cash transaction as a separate client operation. This is not atomic. If the second operation fails, the system can record an expense without cash impact, corrupting financial state.

For a finance app, expense and ledger impact must be one transaction.

## Secondary / Tied Problems

- Expense row can exist without matching cash transaction.
- Cash transaction can be missing, duplicated, or outdated.
- Updating expenses can leave inconsistent ledger impact.
- Linked cash impact currently depends on app code rather than a single database transaction.
- Race conditions can occur with concurrent users spending the same balance.
- Current balance checks are read-then-write and can become stale.

## Files / Areas Likely Involved

Likely files:
- `src/lib/supabase/repository.ts`
- `src/app/api/mutations/route.ts`
- `src/lib/domain/calculations.ts`
- `src/lib/validation.ts`
- `supabase/schema.sql`
- `supabase/migrations/20260509_recurring_expenses_funding_source.sql`
- New migration under `supabase/migrations/`
- `tests/*.test.ts`

## Required Production-Grade Solution

Move expense creation and cash impact into database-side atomic RPCs.

Required RPCs:
1. `create_vehicle_expense_with_cash_impact(...)`
2. `update_vehicle_expense_with_cash_impact(...)`
3. Optional: `void_vehicle_expense_with_cash_reversal(...)`

Each RPC must:
- require authenticated user,
- verify user role owner/admin/member,
- lock relevant organization/ledger rows or use safe transactional checks,
- verify vehicle belongs to organization,
- verify funding source,
- verify sufficient company/external cash before spending,
- insert/update expense,
- insert/update/reverse cash transaction,
- write activity log,
- commit all or rollback all.

Important:
- Do not rely on separate client calls for one financial operation.
- Do not hard-delete financial impact.
- If changing funding source on update is allowed, create proper reversal in old ledger and new transaction in new ledger.
- If changing funding source is not allowed yet, explicitly block it and show clear error.

## Implementation Plan

1. Inspect current expense create/update/delete flows.
2. Design SQL RPC(s) with full transaction behavior.
3. Add migration for RPC(s), constraints, and indexes if needed.
4. Update repository functions to call RPCs instead of separate insert calls.
5. Remove or stop using non-atomic helper paths.
6. Add tests for failure and rollback behavior.
7. Add concurrent-spend test if test setup supports it.
8. Run all verification commands.

## Required Verification Matrix

Test matrix:
- Company cash sufficient → expense + company cash transaction created.
- External cash sufficient → expense + external cash transaction created.
- Insufficient company cash → no expense row created.
- Insufficient external cash → no expense row created.
- Forced invalid vehicle/org mismatch → no partial records.
- Update amount higher than available balance → blocked with no partial update.
- Update amount lower → cash transaction updated or reversed correctly.
- Run `npm test`, `npm run lint`, `npm run build`.

## Acceptance Criteria

- Expense and ledger impact are atomic.
- No partial financial records can be created.
- Balance checks are safe.
- Tests prove rollback behavior.
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
