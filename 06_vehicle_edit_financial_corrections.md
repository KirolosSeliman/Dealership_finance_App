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

**Title:** Add production-safe vehicle edit and financial correction workflows  
**Severity:** HIGH

## Root Problem

Vehicle editing currently updates only basic identity fields such as VIN, year, make, model, trim, color, mileage, and notes. Important business fields like purchase price, purchase date, purchase source, listed price, and status are not fully editable through a safe correction workflow.

This creates pressure to delete/recreate vehicles, which is dangerous in a finance app.

## Secondary / Tied Problems

- Wrong purchase price cannot be safely corrected.
- Wrong purchase source cannot be safely corrected.
- Listed price/status may be blocked or inconsistently handled.
- Purchase corrections require recalculating tax and cash impact.
- Editing after sale can corrupt sale cost basis if not locked.
- Vehicle status transitions need business rules.

## Files / Areas Likely Involved

Likely files:
- `src/lib/supabase/repository.ts`
- `src/app/api/mutations/route.ts`
- `src/components/dealer-flow-app.tsx`
- `src/lib/validation.ts`
- `src/lib/domain/calculations.ts`
- `src/types/domain.ts`
- Supabase migration for correction/audit fields if needed
- `tests/*.test.ts`

## Required Production-Grade Solution

Implement safe vehicle correction workflows.

Required behavior:
1. Simple edits allowed:
   - VIN
   - year/make/model/trim/color/mileage
   - notes
   - listed price
2. Controlled status transitions:
   - purchased → in_repair
   - in_repair → listed_for_sale
   - listed_for_sale → sold only through sale workflow
   - sold cannot return to active without sale void/correction workflow
3. Purchase price/source/date correction:
   - allowed only before sale unless using formal correction workflow,
   - recalculates automatic purchase expense and cash impact atomically,
   - preserves old values in activity log or correction history,
   - does not silently rewrite financial history after sale.
4. Add UI that clearly separates:
   - basic details edit,
   - financial correction,
   - status transition.
5. Do not patch fields casually in `updateVehicle` if financial impact is required.

## Implementation Plan

1. Inspect current vehicle edit UI and repository function.
2. Define allowed field groups and status transitions.
3. Add validation schemas for basic update vs financial correction.
4. Add atomic RPC for purchase correction if changing purchase price/source/date impacts cash/expense.
5. Update UI to show correct forms/actions.
6. Add tests for allowed and blocked transitions.
7. Add tests for purchase correction before sale.
8. Add tests that sold vehicle purchase correction is blocked or uses explicit correction flow.
9. Run all verification commands.

## Required Verification Matrix

Test matrix:
- Update listed price only → no cash impact.
- Update mileage/notes → no cash impact.
- Change status purchased → in_repair → listed_for_sale → works.
- Try status listed_for_sale → sold outside sale workflow → blocked.
- Correct purchase price before sale → purchase expense/cash impact update atomically.
- Correct purchase source before sale → tax recalculates correctly.
- Correct purchase price after sale → blocked unless formal correction supported.
- Run `npm test`, `npm run lint`, `npm run build`.

## Acceptance Criteria

- Users can correct real-world vehicle mistakes safely.
- Financial fields are not casually overwritten.
- Sale records remain stable.
- All corrections are auditable.
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
