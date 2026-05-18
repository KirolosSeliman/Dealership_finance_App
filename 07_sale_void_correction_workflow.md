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

**Title:** Add sale void/correction workflow without destroying financial history  
**Severity:** HIGH

## Root Problem

Sale recording has an atomic SQL RPC, which is good, but there is no confirmed production-safe workflow for correcting or voiding a sale after it was recorded. A real dealership app needs a way to handle wrong sale price, wrong buyer, wrong date, cancellation, or accidental sale entry.

Corrections must preserve audit history and reverse cash impacts safely.

## Secondary / Tied Problems

- Sold vehicles may be stuck with wrong sale data.
- Users may try deleting the vehicle to undo a sale, destroying history.
- Paper sale cash and external commission cash need reversal logic.
- Buyer contact may need correction without deleting original records.
- Tax reports need to reflect voided/corrected sales clearly.
- Market Snap training data must not treat voided sale as real final sale.

## Files / Areas Likely Involved

Likely files:
- `src/lib/supabase/repository.ts`
- `src/app/api/mutations/route.ts`
- `src/components/dealer-flow-app.tsx`
- `src/lib/domain/calculations.ts`
- `src/types/domain.ts`
- `supabase/schema.sql`
- `supabase/migrations/20260508_p0_atomic_security.sql`
- New migration under `supabase/migrations/`
- `tests/*.test.ts`

## Required Production-Grade Solution

Implement a production-safe sale correction system.

Required design:
1. Sales should not be hard-deleted.
2. Add sale status/correction fields:
   - `voided_at`
   - `voided_by`
   - `void_reason`
   - `corrected_by_sale_id` or `correction_of_sale_id`
   - possibly `status = active | voided | corrected`
3. Add RPC `void_vehicle_sale_atomic(...)` that:
   - requires owner/admin, or member if business allows,
   - locks vehicle and sale,
   - marks sale voided,
   - creates reversal cash transactions for paper sale and external commission,
   - changes vehicle status back to pre-sale safe status only if appropriate,
   - writes activity logs.
4. Add optional `correct_vehicle_sale_atomic(...)` that:
   - voids old sale,
   - creates corrected sale,
   - creates corrected cash impacts,
   - preserves full history.
5. Tax reports must exclude voided sales from active totals but optionally show voided/correction notes.
6. Market Snap training must use only active final sales unless explicitly analyzing corrected historical records.

## Implementation Plan

1. Inspect sale RPC and sale UI.
2. Add sale status/correction columns with migration.
3. Add atomic void/correct SQL RPC.
4. Update repository and API route.
5. Update UI with clear dangerous action confirmation.
6. Update tax report logic to exclude voided sales from active totals.
7. Update Market Snap sold-data usage if present.
8. Add tests for sale void and correction.
9. Run all verification commands.

## Required Verification Matrix

Test matrix:
- Record sale → vehicle sold, paper sale cash added, external commission added.
- Void sale → original sale remains marked voided, reversal cash entries added, active totals exclude it.
- Correct sale → old sale voided/corrected, new sale active, cash totals match corrected values.
- Tax report excludes voided sale from active totals.
- Buyer contact remains preserved or linked correctly.
- Viewer/accountant blocked from sale void.
- Run `npm test`, `npm run lint`, `npm run build`.

## Acceptance Criteria

- Sale mistakes can be fixed without deleting history.
- Cash ledgers stay consistent.
- Tax reports handle voided/corrected sales.
- Vehicle status remains valid.
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
