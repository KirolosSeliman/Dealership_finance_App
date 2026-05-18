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

**Title:** Tighten validation, domain enums, VIN quality, and input safety  
**Severity:** MEDIUM

## Root Problem

The project uses Zod validation, but some schemas still accept generic strings where domain enums exist. VIN handling is also too weak for an inventory system. This allows invalid domain values or low-quality vehicle identity data to reach deeper layers.

Validation should fail early, before database constraints or runtime assumptions are hit.

## Secondary / Tied Problems

- `cashTransactionSchema.type` is generic string.
- `contactSchema.type` is generic string.
- VIN is optional text without strict validation when provided.
- Duplicate VIN handling is unclear.
- Invalid business values may produce database errors instead of clean user messages.
- Some optional text handling may allow empty strings into fields where null would be cleaner.

## Files / Areas Likely Involved

Likely files:
- `src/lib/validation.ts`
- `src/types/domain.ts`
- `src/lib/domain/constants.ts`
- `src/lib/supabase/repository.ts`
- `src/components/dealer-flow-app.tsx`
- Supabase constraints/migrations if needed
- `tests/*.test.ts`

## Required Production-Grade Solution

Strengthen validation and data normalization.

Required changes:
1. Use enum validation for all domain-controlled fields:
   - cash transaction types,
   - contact types,
   - expense categories,
   - funding sources,
   - roles,
   - vehicle statuses,
   - purchase sources.
2. VIN rules:
   - optional is acceptable if business wants incomplete documents,
   - when provided, normalize uppercase,
   - remove spaces,
   - reject invalid VIN characters I/O/Q if using standard VIN rules,
   - enforce 17 characters when provided unless the app explicitly supports partial VIN drafts.
3. Add duplicate VIN warning or block per organization:
   - If VIN is provided and already exists in active inventory, warn or block.
   - Decide behavior for archived vehicles.
4. Return clean user-facing validation errors.
5. Add tests for invalid values and valid edge cases.

## Implementation Plan

1. Inspect validation schemas and constants.
2. Add missing domain constants for cash/contact types if not already present.
3. Tighten schemas.
4. Normalize VIN in one place.
5. Add duplicate VIN check in create/update flow if business rule allows.
6. Ensure UI displays validation errors clearly.
7. Run all verification commands.

## Required Verification Matrix

Test matrix:
- Invalid cash type rejected by API.
- Invalid contact type rejected by API.
- VIN with lowercase becomes uppercase.
- VIN with spaces normalized or rejected cleanly.
- VIN with invalid characters rejected.
- Duplicate VIN in same organization warns/blocks according to chosen rule.
- Empty VIN still allowed if incomplete-document workflow requires it.
- Run `npm test`, `npm run lint`, `npm run build`.

## Acceptance Criteria

- Invalid domain values cannot pass API validation.
- VIN quality is enforced without blocking allowed incomplete records.
- User sees clear errors.
- Tests cover validation rules.
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
