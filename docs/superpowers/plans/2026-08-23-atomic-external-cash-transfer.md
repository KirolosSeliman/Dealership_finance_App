# Atomic External Cash Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every new External Cash → Company Cash transfer one linked, atomic PostgreSQL operation with paired reversal and legacy-row compatibility.

**Architecture:** Keep the existing Cash Management form and mutation route. Add a single Supabase RPC for paired creation and a second RPC for paired reversal; route the repository to those RPCs and keep generic cash paths for non-paired legacy transactions. Add nullable pair IDs, database trigger protections, and partial unique indexes in one forward migration without backfilling history.

**Tech Stack:** Next.js, TypeScript, Supabase/PostgreSQL RPCs and triggers, Node test runner, Zod.

**Spec:** `C:\Users\kirol\.codex\attachments\27a4e88d-e2fc-410d-ae0f-e8bd8f38c67b\pasted-text.txt`

## Global Constraints

- Work on `main` from starting SHA `3412023aa11e9a2b91eaf1cfc1f0bd978bb0f903`.
- Create only `supabase/migrations/20260823_atomic_external_cash_transfer.sql` for database changes; do not edit historical migrations.
- Never backfill, delete, or alter historical financial rows.
- Creation must use one RPC transaction; JavaScript must never insert the two sides separately.
- Only `owner` and `admin` may execute the transfer and reversal RPCs.
- Preserve existing Add External Cash, sales commission, external expense, personal removal, company cash, tax, and vehicle semantics.
- Paired rows are immutable financial history and can only be reversed through the paired reversal RPC.
- Do not apply production SQL, push `main`, or claim GO without authenticated production Supabase verification.

### Task 1: Add failing transfer, pair, and migration regression tests

**Files:**
- Create: `tests/external-cash-transfer.test.ts`
- Modify: `tests/calculations.test.ts`

**Interfaces:**
- Tests will exercise the current repository and domain APIs and will initially fail because paired RPC routing, pair fields, and migration source do not yet exist.

- [ ] Write tests for the transfer invariant, unchanged profit/tax metrics, new type/constant coverage, mapper null handling, RPC creation/reversal SQL markers, no destructive SQL, and legacy migration immutability.
- [ ] Add repository mock tests proving transfer creation calls `transfer_external_cash_to_company` without `.from(...).insert(...)`, system-generated types are rejected, paired reversal rows route to the pair RPC, reversal rows are rejected, and legacy unpaired rows use the old RPC.
- [ ] Add source/UI tests for paired edit/reverse controls and regression tests for existing cash types.
- [ ] Run the focused test file and confirm failures are caused by the missing implementation.

### Task 2: Implement domain types, constants, and mappers

**Files:**
- Modify: `src/types/domain.ts`
- Modify: `src/lib/domain/constants.ts`
- Modify: `src/lib/supabase/mappers.ts`

**Interfaces:**
- Produces `ExternalCashTransactionType = "external_transfer_returned"` support and optional `transferPairId` on both cash transaction models.

- [ ] Add the new external reversal type without removing existing types.
- [ ] Add `transferPairId?: string` to both cash transaction interfaces and map `transfer_pair_id` with NULL → `undefined` in both mappers.
- [ ] Run focused tests and keep the existing calculation semantics unchanged.

### Task 3: Implement atomic creation and paired reversal repository routing

**Files:**
- Modify: `src/lib/supabase/repository.ts`
- Modify: `src/app/api/mutations/route.ts`

**Interfaces:**
- `createCashTransaction(..., "external_cash_transferred_to_company", ...)` calls `transfer_external_cash_to_company` and returns without generic insertion.
- `deleteCashTransaction(...)` loads the organization-scoped transaction metadata and calls `reverse_external_cash_transfer_pair` for active paired originals.

- [ ] Add system-generated type rejection before generic creation.
- [ ] Add the atomic creation RPC branch.
- [ ] Add paired lookup/routing, reversal-row rejection, and legacy fallback to `deleteCashTransaction`.
- [ ] Add repository and API defense against editing paired rows.
- [ ] Run focused repository tests and fix production code, not tests, until green.

### Task 4: Implement the forward Supabase migration

**Files:**
- Create: `supabase/migrations/20260823_atomic_external_cash_transfer.sql`

**Interfaces:**
- Adds nullable pair IDs, partial unique indexes, the complete external type constraint, `transfer_external_cash_to_company`, `reverse_external_cash_transfer_pair`, paired insert validation, paired update immutability, and updated generic reversal functions.

- [ ] Add columns and indexes without backfilling.
- [ ] Add creation RPC with auth, owner/admin role check, organization `FOR UPDATE`, in-transaction balance check, two inserts, one activity log, and authenticated-only execution.
- [ ] Add reversal RPC with pair consistency checks, company balance protection, paired reversal rows, original-row audit updates, one activity log, and authenticated-only execution.
- [ ] Redefine generic reversal RPCs to reject paired originals while preserving legacy behavior.
- [ ] Add insert/update triggers that permit legacy NULL pairs but prevent new unpaired system types and independent financial edits.
- [ ] Run SQL static review for required markers and absence of destructive financial SQL.

### Task 5: Protect the existing Cash Management UI

**Files:**
- Modify: `src/components/dealer-flow-app.tsx`

**Interfaces:**
- Existing transfer form remains unchanged; paired originals show only `Reverse transfer`, reversed originals show status only, and paired reversal rows show no mutation controls.

- [ ] Gate paired-row edit/reverse controls using `transferPairId`, `correctionOfTransactionId`, `reversedTransactionId`, and `voidedAt`.
- [ ] Preserve controls for all non-paired cash transactions.
- [ ] Run UI source tests.

### Task 6: Verify and hand off with production blockers explicit

**Files:**
- No additional production files.

- [ ] Run `git diff --check`, focused tests, full direct test suite, lint, build, and release verification where the local dependency environment permits.
- [ ] Verify historical migrations are unchanged and the new migration is ordered after `20260821_external_cash_manual_add.sql`.
- [ ] Check for Supabase CLI/config/credentials. If production cannot be authenticated, report `BLOCKED_DB_MIGRATION` and do not push `main`.
- [ ] Report exact test/build results, migration application/verification status, QA mutation safety status, and final NO-GO unless every mandatory production gate is verified.
