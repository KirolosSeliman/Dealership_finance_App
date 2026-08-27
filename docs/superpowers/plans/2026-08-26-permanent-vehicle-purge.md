# Permanent Vehicle Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the user-facing vehicle archive action with an owner/admin-only permanent purge that atomically removes the vehicle's live relational history and restores cash balances by deleting authoritative vehicle-linked ledger rows.

**Architecture:** A new `purge_vehicle_completely(uuid, uuid, text)` security-definer PostgreSQL RPC locks the organization and vehicle, validates the exact confirmation, collects all target IDs, closes same-ledger correction chains, checks projected cash balances, and deletes relational rows in one transaction. The authenticated server mutation calls that RPC once, then removes returned private Storage paths with bounded retries; the UI uses the same strong confirmation and clears the deleted vehicle state.

**Tech Stack:** Next.js App Router, TypeScript, Supabase SSR/client, PostgreSQL PL/pgSQL migrations, Node test runner via `tsx`.

**Spec:** `C:\Users\kirol\.codex\attachments\8610da24-0044-47e4-8e4d-673b1df50617\pasted-text.txt`

## Global Constraints

- Create only `supabase/migrations/20260826_permanent_vehicle_purge.sql`; do not edit historical migrations.
- Require `auth.uid() IS NOT NULL` and `has_org_role(..., array['owner','admin']::app_role[])` in the RPC and API.
- Require exact `DELETE <VIN>` or `DELETE <FULL-VEHICLE-UUID>` confirmation after trimming and case normalization.
- Do not create refund, balancing, archive, audit, or final-delete rows during a successful purge.
- Delete target cash rows physically; deleted cash rows contribute zero to projected live balances.
- Preserve unrelated vehicles, contacts, cash, transfers, backups, and source financial data.
- Return private storage paths from the RPC; storage cleanup failure must warn without restoring database rows.
- Do not push application code or production SQL; stop after local verification and provide the complete migration for manual Supabase application.

---

### Task 1: Permanent confirmation contract

**Files:**
- Modify: `src/lib/vehicle-delete.ts`
- Modify: `src/lib/validation.ts`
- Modify: `tests/calculations.test.ts`
- Create: `tests/vehicle-purge.test.ts`

**Interfaces:**
- Produces `expectedVehicleDeleteConfirmation(vehicle)` and `isValidVehicleDeleteConfirmation(input, vehicle)` for both UI and server validation.
- `deleteVehicleSchema` accepts `vehicleId` and `confirmationText` and no archive-only reason field.

- [x] **Step 1: Write failing tests** for rejecting `DELETE`, rejecting VIN-only text, accepting case-insensitive surrounding-whitespace `DELETE <VIN>`, accepting UUID confirmation when VIN is missing, and rejecting an incorrect identifier.
- [x] **Step 2: Run the focused tests** and verify failure is caused by the current weak confirmation contract.
- [x] **Step 3: Implement the smallest confirmation helper and schema change.**
- [x] **Step 4: Run the focused tests** and verify they pass.

### Task 2: Forward migration and RPC contract

**Files:**
- Create: `supabase/migrations/20260826_permanent_vehicle_purge.sql`
- Create or modify: `tests/vehicle-purge.test.ts`
- Modify: `tests/release-verification.test.ts`

**Interfaces:**
- Produces `public.purge_vehicle_completely(p_organization_id uuid, p_vehicle_id uuid, p_confirmation_text text) returns jsonb`.
- RPC JSON includes `vehicleId`, `vehicleVin`, deletion counts, `invalidatedTaxReports`, and deduplicated `storagePaths`.

- [x] **Step 1: Add failing SQL contract tests** covering authentication, owner/admin authorization, organization and vehicle locks, exact confirmation, shared buyer rejection, recursive cash correction closure in both directions, official cash-effect functions, deleted-row zero effect, projected-negative aborts, attachment path collection, tax report invalidation, no backup deletion, purge-context trigger bypass, deletion order, no backfill, and execute grants.
- [x] **Step 2: Run the migration contract tests** and verify the missing migration/contract failures.
- [x] **Step 3: Implement the one forward migration.** Collect sales, expenses, contacts, cash roots, recursive same-ledger cash closures, attachments and paths before deletion. Lock organization first and vehicle second. Delete attachments, cash closures, sales, expenses, contact-only rows, target activity, stale organization tax reports, direct vehicle-linked valuation/prediction/feedback/correction rows where current schema exposes them, then the vehicle. Keep backups and unrelated transfers untouched.
- [x] **Step 4: Redefine only the existing cash mutation trigger function** so refund/reversed system rows can be deleted only when `dealer_flow.purge_vehicle_rpc = 'on'`; preserve all normal insert/update/delete protections outside that transaction-local context and preserve transfer triggers.
- [x] **Step 5: Run the migration contract tests** and verify they pass.

### Task 3: Server repository, API routes, and storage cleanup

**Files:**
- Modify: `src/lib/supabase/repository.ts`
- Modify: `src/app/api/mutations/route.ts`
- Modify: `src/features/app/mutations.ts`
- Modify: `src/app/api/vehicles/[vehicleId]/archive/route.ts`
- Create: `src/app/api/vehicles/[vehicleId]/purge/route.ts`
- Modify: `tests/vehicle-purge.test.ts`

**Interfaces:**
- Produces `purgeVehicle(client, organizationId, vehicleId, confirmationText)` which invokes only `purge_vehicle_completely` for relational deletion and then removes returned private paths from `dealer-flow-private` up to three times.
- Returns `{ purge: jsonbResult, warning?: string }`; warning is exactly `Vehicle data was deleted, but some private files require manual storage cleanup.` when cleanup remains incomplete.

- [x] **Step 1: Add failing tests** asserting the active mutation endpoint is `/api/vehicles/:id/purge`, the legacy archive route forwards to the same permanent operation, the repository calls `purge_vehicle_completely`, storage URLs are excluded, private paths are retried at most three times, and cleanup failure does not request a database rollback.
- [x] **Step 2: Run the focused tests** and verify the current archive route/repository behavior fails them.
- [x] **Step 3: Implement repository purge and storage cleanup with a small injectable storage-removal helper** so retries and URL filtering are deterministic in tests.
- [x] **Step 4: Update mutation handling** to remove the archived-row rejection and archive wording, validate through the purge RPC/server contract, map known database errors to safe user-facing messages, and return purge counts/warnings.
- [x] **Step 5: Add the preferred purge route** and make the legacy `/archive` route use the same operation and confirmation semantics.
- [x] **Step 6: Run the focused tests** and verify they pass.

### Task 4: Permanent-delete UI behavior

**Files:**
- Modify: `src/components/dealer-flow-app.tsx`
- Modify: `tests/vehicle-purge.test.ts`

**Interfaces:**
- The detail action is labeled `Delete vehicle permanently`.
- The warning explains permanent deletion, cash recomputation, and negative-balance blocking using the exact required copy.
- The confirmation field displays `DELETE <VIN>` or `DELETE <vehicle UUID>` and disables the button until valid.

- [x] **Step 1: Add failing UI/source contract tests** for permanent-delete wording, required warning copy, strong confirmation example, no archive reason field, and post-success navigation/state clearing.
- [x] **Step 2: Run the focused tests** and verify current archive copy/state fails.
- [x] **Step 3: Replace archive state and callback naming in the active delete flow**, call the purge mutation, navigate to `/vehicles`, clear selected vehicle/tab state, refresh organization data, and surface storage-cleanup warnings.
- [x] **Step 4: Run the focused tests** and verify they pass.

### Task 5: Documentation and full verification gate

**Files:**
- Modify: `README.md`
- Modify: `tests/release-verification.test.ts`
- Modify: `docs/release-checklist.md` only where the old active archive behavior is now inaccurate.

- [x] **Step 1: Update documentation** to describe the active permanent purge migration and the manual Supabase application sequence without claiming production deployment.
- [x] **Step 2: Run `npm test`, `npm run lint`, and `npm run build`.**
- [x] **Step 3: Review the final diff and verify no historical migration was modified, no backup deletion was added, no hard-coded VIN was added, and no production push/deployment was performed.
- [x] **Step 4: Report exact commands/results, manual verification limits, remaining risks, and provide the complete SQL block for manual Supabase application.

---

## Self-review

- The financial requirements are covered by Task 2's authoritative-ledger collection, correction closure, deleted-row semantics, and projected-balance aborts.
- The security requirements are covered by Task 2's RPC checks/locks and Task 3's server role check/error mapping.
- The storage transaction boundary is covered by Task 2's returned paths and Task 3's post-RPC retry policy.
- The UX requirements are covered by Task 4, including archived records being purgable and successful state reset.
- The release constraints are covered by Task 5; production push is intentionally outside this local task.
