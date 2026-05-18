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

**Title:** Replace unsafe cash transaction deletion with reversal-based ledger integrity  
**Severity:** HIGH

## Root Problem

Cash transactions can currently be soft-deleted. Balance calculations ignore `deletedAt`, meaning deleting an old deposit after later spending can invalidate account balances and distort history.

A financial ledger should be immutable or correction-based. Entries should be reversed or voided with traceability, not deleted from balance history without safety checks.

## Secondary / Tied Problems

- Soft-deleting deposits can make company/external cash negative.
- Linked vehicle payments may lose their funding context.
- Historical reports can change after the fact.
- Activity logs may not fully explain financial corrections.
- Manual cash edits can rewrite history instead of creating auditable corrections.
- Owner/admin UX may encourage deletion instead of correction.

## Files / Areas Likely Involved

Likely files:
- `src/lib/domain/calculations.ts`
- `src/lib/supabase/repository.ts`
- `src/app/api/mutations/route.ts`
- `src/components/dealer-flow-app.tsx`
- `src/types/domain.ts`
- `supabase/schema.sql`
- Existing cash-related migrations
- New migration under `supabase/migrations/`
- `tests/*.test.ts`

## Required Production-Grade Solution

Implement correction/reversal-based ledger behavior.

Required design:
1. Treat cash ledgers as append-only for production accounting.
2. Replace normal delete with `void` or `reverse`:
   - keep original transaction,
   - add reversal transaction of equal opposite effect,
   - link reversal to original transaction,
   - store reason, created_by, created_at.
3. Keep `deleted_at` only for administrative/legacy compatibility, not normal financial correction.
4. Add fields if needed:
   - `reversed_transaction_id`
   - `correction_of_transaction_id`
   - `voided_at`
   - `voided_by`
   - `void_reason`
5. Update balance calculations to handle reversal entries correctly.
6. Block deleting/reversing system-generated vehicle expense/sale transactions unless done through the correct vehicle/sale correction workflow.
7. Add UI copy: “Reverse transaction” or “Void transaction”, not “Delete”.

## Implementation Plan

1. Inspect cash transaction types and balance calculations.
2. Define reversal transaction types or a generic reversal linkage model.
3. Add migration for reversal fields/types.
4. Update API route and repository functions.
5. Update UI dangerous action labels and confirmation.
6. Add tests for:
   - reversing company deposit,
   - reversing external commission,
   - blocked reversal if it would make balance invalid,
   - linked expense/sale transaction correction blocked directly.
7. Run all verification commands.

## Required Verification Matrix

Test matrix:
- Add company cash 10,000, spend 8,000, attempt reverse original 10,000 deposit: block or require safe correction path.
- Add company cash 10,000, reverse 2,000 withdrawal: balance correct and history preserved.
- Add external cash commission, transfer part to company, reverse commission: should block if it invalidates transfer history.
- System-generated vehicle expense transaction cannot be manually deleted.
- Balance calculations remain deterministic.
- Run `npm test`, `npm run lint`, `npm run build`.

## Acceptance Criteria

- No normal cash transaction is physically or silently deleted.
- Financial corrections preserve original entries.
- Balances cannot become invalid through deletion.
- Activity logs clearly explain corrections.
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
