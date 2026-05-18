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

**Title:** Split giant mutation endpoint into safer domain-specific API routes  
**Severity:** HIGH

## Root Problem

The app currently uses one giant `/api/mutations` route with an `operation` string and a large switch statement. This centralizes many unrelated write workflows: vehicles, expenses, sales, cash, contacts, attachments, roles, backups activity, recurring expenses, and invitations.

This is fragile, hard to test, and easy to break.

## Secondary / Tied Problems

- Role checks are repeated and can drift.
- Validation schemas are selected manually by operation string.
- Monitoring and logs are less precise.
- Rate limiting cannot easily target specific operations.
- One route file becomes too large and risky.
- Refactoring business logic becomes harder.
- Client mutation helper may hide domain-specific error handling.

## Files / Areas Likely Involved

Likely files:
- `src/app/api/mutations/route.ts`
- New API routes under `src/app/api/*`
- `src/lib/supabase/repository.ts`
- `src/lib/server/security.ts`
- `src/components/dealer-flow-app.tsx`
- feature hooks if created
- tests

## Required Production-Grade Solution

Gradually split the mutation API without breaking the app.

Required approach:
1. Do not rewrite everything at once if risky.
2. Start with the highest-risk domains:
   - vehicles/archive/corrections,
   - expenses,
   - sales,
   - cash.
3. Create domain routes such as:
   - `POST /api/vehicles`
   - `PATCH /api/vehicles/[id]`
   - `POST /api/vehicles/[id]/archive`
   - `POST /api/vehicles/[id]/expenses`
   - `PATCH /api/vehicles/[id]/expenses/[expenseId]`
   - `POST /api/vehicles/[id]/sale`
   - `POST /api/cash/company`
   - `POST /api/cash/external`
4. Keep old route only as temporary compatibility if needed, but mark it deprecated and avoid adding new logic to it.
5. Extract shared helpers:
   - auth/user loading,
   - organization role checks,
   - JSON/form-data parsing,
   - error formatting,
   - validation helpers.
6. Add tests per route.
7. Update client calls incrementally.

## Implementation Plan

1. Inspect all current `serverMutation` calls.
2. Build a route migration map from operation string to domain route.
3. Extract common API helpers.
4. Move one domain at a time, beginning with vehicles/expenses/sales/cash.
5. Update UI calls for moved operations.
6. Keep behavior identical except where previous prompts required safer financial logic.
7. Add route-level tests.
8. Run full verification.

## Required Verification Matrix

Test matrix:
- Create vehicle through new route.
- Add/update expense through new route.
- Record/void sale through new route.
- Cash add/reverse through new route.
- Old route either still works for unmigrated operations or returns clear deprecation for migrated ones.
- Permission failures return 403.
- Validation failures return 400 with useful messages.
- Run `npm test`, `npm run lint`, `npm run build`.

## Acceptance Criteria

- High-risk mutations are split by domain.
- Behavior remains stable.
- Route tests exist.
- Old giant switch is reduced or deprecated.
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
