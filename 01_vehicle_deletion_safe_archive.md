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

**Title:** Replace dangerous vehicle hard-delete with production-safe archive/void workflow  
**Severity:** CRITICAL

## Root Problem

The current vehicle deletion path relies on `delete_vehicle_and_related_data(uuid, uuid)`, which permanently deletes records tied to a vehicle: tax reports, attachments, company cash transactions, external cash transactions, sales, expenses, activity logs, and the vehicle itself.

For a finance/tax/inventory app, this is unacceptable. A sold or financially active vehicle must not disappear from history. The product needs an audit-safe archive/void workflow, not destructive deletion.

## Secondary / Tied Problems

- Deleting a vehicle can destroy sale history.
- Deleting a vehicle can destroy expense history.
- Deleting a vehicle can destroy cash ledger history.
- Deleting a vehicle can destroy tax reports.
- Deleting a vehicle can orphan or mishandle private storage files.
- UI confirmation text protects against accidental clicks, but not against bad business logic.
- Current naming says “delete”, but production behavior should be “archive”, “void”, or “purge only when safe”.

## Files / Areas Likely Involved

Likely files:
- `src/app/api/mutations/route.ts`
- `src/lib/supabase/repository.ts`
- `src/components/dealer-flow-app.tsx`
- `src/lib/vehicle-delete.ts`
- `src/lib/validation.ts`
- `src/types/domain.ts`
- `supabase/schema.sql`
- `supabase/migrations/20260510_delete_vehicle_cascade.sql`
- `supabase/migrations/20260510_delete_vehicle_cascade_hardening.sql`
- New migration under `supabase/migrations/`
- Tests under `tests/`

## Required Production-Grade Solution

Implement a production-safe vehicle archive system.

Required design:
1. Add soft-delete/archive columns to `vehicles`:
   - `archived_at timestamptz`
   - `archived_by uuid`
   - `archive_reason text`
   - optionally `archive_status text` if useful.

2. Normal delete action should archive the vehicle, not hard-delete it.

3. Preserve:
   - `sales`
   - `vehicle_expenses`
   - `company_cash_transactions`
   - `external_cash_transactions`
   - `attachments`
   - `tax_reports`
   - `activity_logs`

4. Dashboard/inventory should exclude archived vehicles by default, but reports/history should still be able to include archived records where appropriate.

5. Add a clear UI message: archived vehicles are hidden from active inventory but preserved for financial/tax history.

6. Keep a hard purge option only if ALL are true:
   - owner role only,
   - vehicle has no sale,
   - vehicle has no expenses except possibly zero-value draft records,
   - vehicle has no cash transactions,
   - vehicle has no tax report references,
   - vehicle has no attachments,
   - user types a strong confirmation.
   If purge is not needed, do not implement it.

7. Do not use `delete_vehicle_and_related_data` for normal app behavior anymore. Either deprecate it, replace it with a safe archive RPC, or leave it unused with documentation warning.

8. Create a SQL RPC such as `archive_vehicle(p_organization_id uuid, p_vehicle_id uuid, p_reason text)` that:
   - requires authenticated user,
   - requires owner/admin,
   - locks the vehicle row,
   - validates org ownership,
   - sets archive fields,
   - writes an activity log,
   - returns success.

9. Update repository/API/UI names to avoid misleading “delete” semantics where possible. If UI still says delete for user familiarity, backend must archive.

## Implementation Plan

1. Inspect current deletion flow end-to-end from UI to API to repository to SQL.
2. Add migration for archive columns and safe archive RPC.
3. Update TypeScript types and mappers to include archive fields.
4. Update `loadAppData` or client filtering so active inventory excludes archived vehicles by default.
5. Update delete/archive mutation route to call the new archive function.
6. Update UI confirmation copy to explain archive behavior.
7. Add tests for:
   - archive unsold vehicle,
   - archive sold vehicle,
   - archived vehicle hidden from active inventory,
   - sale/expense/cash records preserved,
   - owner/admin allowed,
   - member/viewer blocked.
8. Remove or stop calling destructive hard-delete logic from production UI.
9. Update README/deployment notes if a new migration is required.

## Required Verification Matrix

Test matrix:
- Create vehicle with purchase price and expense, archive it, verify expense and cash ledger remain.
- Record sale, archive vehicle, verify sale remains and tax report logic can still see it if needed.
- Attempt archive as viewer/accountant/member, expect permission denied except roles allowed by business rule.
- Attempt archive with wrong confirmation, expect blocked.
- Refresh browser after archive, vehicle must not reappear in active inventory.
- Query DB manually or through tests to confirm no related rows were physically deleted.
- Run `npm test`, `npm run lint`, `npm run build`.

## Acceptance Criteria

- No normal user action permanently deletes vehicle financial history.
- Existing deletion bug is eliminated.
- Active inventory stays clean.
- Archived records remain available for reporting/audit.
- Tests prove related financial records are preserved.
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
