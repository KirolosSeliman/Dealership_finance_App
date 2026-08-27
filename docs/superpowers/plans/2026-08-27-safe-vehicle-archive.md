# Safe Vehicle Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the normal vehicle-removal workflow preserves financial and audit history by archiving vehicles through the existing atomic archive RPC.

**Architecture:** Keep the existing `archive_vehicle(uuid, uuid, text)` database transaction as the source of truth for archive authorization, row locking, cash reversals, and audit logging. Route the normal `deleteVehicle` compatibility operation to that RPC, retain permanent purge code only as an explicit non-default endpoint, and align repository, UI, error copy, and regression tests with archive semantics.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/PostgreSQL RPCs, React, Node test runner via `tsx`.

**Spec:** `01_vehicle_deletion_safe_archive.md`

## Global Constraints

- Never silently destroy finance, tax, sale, cash, contact, attachment, or activity-log history.
- Database migrations are forward-only and safe to apply to an existing Supabase project.
- Normal vehicle removal must archive, not permanently delete.
- Archived vehicles are excluded from active inventory but remain available for reporting and audit.
- Archive requires an authenticated owner/admin and must lock the organization and vehicle rows.
- Run `npm test`, `npm run lint`, and `npm run build` before claiming success.

### Task 1: Prove the normal removal contract is archive-only

**Files:**
- Modify: `tests/vehicle-archive.test.ts`
- Test: `tests/vehicle-archive.test.ts`

**Interfaces:**
- Consumes: `mutationEndpoint`, `src/app/api/vehicles/[vehicleId]/archive/route.ts`, repository source, and app UI source.
- Produces: regression assertions that fail while the active path calls `purge_vehicle_completely` or advertises permanent deletion.

- [ ] **Step 1: Write the failing regression tests**

  Assert that `mutationEndpoint("deleteVehicle", formData)` returns `/api/vehicles/:id/archive`, that the archive route forwards `deleteVehicle`, that the repository exposes `archiveVehicle` and calls `archive_vehicle`, and that the UI copy explains preservation rather than irreversible deletion.

- [ ] **Step 2: Run the focused test and verify the expected failure**

  Run: `npx tsx --test tests/vehicle-archive.test.ts`

  Expected: FAIL because the current mutation endpoint targets `/purge`, the repository only exposes `purgeVehicle`, and the UI says “Delete vehicle permanently”.

### Task 2: Route the normal operation to the archive RPC

**Files:**
- Modify: `src/features/app/mutations.ts`
- Modify: `src/app/api/vehicles/[vehicleId]/archive/route.ts`
- Modify: `src/lib/supabase/repository.ts`
- Modify: `src/app/api/mutations/route.ts`
- Modify: `src/lib/validation.ts`

**Interfaces:**
- Consumes: `archive_vehicle(p_organization_id uuid, p_vehicle_id uuid, p_reason text)`.
- Produces: `archiveVehicle(client, organizationId, vehicleId, reason): Promise<void>` and the compatibility `deleteVehicle` operation invoking it.

- [ ] **Step 1: Implement the smallest archive repository wrapper**

  Call `client.rpc("archive_vehicle", { p_organization_id: organizationId, p_vehicle_id: vehicleId, p_reason: reason })` and throw RPC errors. Do not delete relational data or perform storage cleanup.

- [ ] **Step 2: Change the active endpoint and API dispatch**

  Make `deleteVehicle` resolve to `/api/vehicles/:id/archive`, accept an optional bounded archive reason, and dispatch to `archiveVehicle` after the existing owner/admin role check. Remove the obsolete `/purge` route and repository wrapper from the application surface, and add a forward migration revoking authenticated access to the historical purge RPC.

- [ ] **Step 3: Run the focused tests and verify they pass**

  Run: `npx tsx --test tests/vehicle-archive.test.ts tests/archive-cash-refund.test.ts`

  Expected: PASS with archive-only routing and existing archive-RPC integrity checks intact.

### Task 3: Align UI and documentation with archive semantics

**Files:**
- Modify: `src/components/dealer-flow-app.tsx`
- Modify: `src/app/api/mutations/route.ts`
- Modify: `README.md`
- Modify: `docs/deployment-security.md`
- Modify: `docs/release-checklist.md`

**Interfaces:**
- Consumes: `archiveVehicle` mutation contract and `activeVehiclesOnly` filtering.
- Produces: clear archive confirmation copy, archive success/error messages, and deployment guidance naming `archive_vehicle` as the normal workflow.

- [ ] **Step 1: Replace destructive UI wording and confirmation**

  Use “Archive vehicle”, explain that the vehicle is hidden from active inventory while sales, expenses, cash, documents, tax, and activity history are preserved, and submit the archive operation with a bounded reason. Keep the existing owner/admin permission gate.

- [ ] **Step 2: Update API error mapping and docs**

  Map archive RPC failures to archive-specific user messages and remove normal-flow claims that a vehicle is permanently deleted or that balances are recomputed as if it never existed. Document the forward migration and the explicit distinction between archive and any optional purge endpoint.

- [ ] **Step 3: Run the full verification suite**

  Run: `npm test`

  Run: `npm run lint`

  Run: `npm run build`

  Expected: all tests pass, ESLint exits 0, and the production build exits 0.

### Task 4: Manually verify the archive lifecycle

**Files:**
- No production files.

- [ ] **Step 1: Inspect the final diff and migration ordering**

  Run: `git diff --check`, `git diff -- src/features/app/mutations.ts src/app/api/vehicles/[vehicleId]/archive/route.ts src/lib/supabase/repository.ts src/app/api/mutations/route.ts src/components/dealer-flow-app.tsx`, and list `supabase/migrations` in lexical order.

- [ ] **Step 2: Verify archive invariants from source**

  Confirm the archive migration locks organization and vehicle rows, rejects an already archived vehicle, blocks an active sale, reverses only live vehicle-cost payments, updates archive fields, writes `vehicle_archived`, and contains no deletes of core financial rows.

- [ ] **Step 3: Record remaining risks**

  Note that an actual Supabase migration/RPC integration test requires configured Supabase credentials or a local Supabase instance; do not describe source-level tests as database execution.
