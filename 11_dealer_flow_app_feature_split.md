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

**Title:** Split giant DealerFlowApp client component into feature modules  
**Severity:** HIGH

## Root Problem

`src/components/dealer-flow-app.tsx` is acting as app shell, router, data loader, auth handler, dashboard, inventory manager, expense manager, sale manager, cash manager, contacts manager, backup manager, settings page, and Market Snap UI. This is too much responsibility for one client component.

It creates a high risk of regressions and makes the app hard to test or evolve.

## Secondary / Tied Problems

- UI state is centralized and fragile.
- Business actions are mixed with rendering.
- Navigation is manual and mixed with feature state.
- Any feature change can break unrelated features.
- The file is difficult for Codex or a developer to modify safely.
- Feature-level testing is hard.

## Files / Areas Likely Involved

Likely files:
- `src/components/dealer-flow-app.tsx`
- New folders:
  - `src/features/dashboard`
  - `src/features/vehicles`
  - `src/features/expenses`
  - `src/features/sales`
  - `src/features/cash`
  - `src/features/contacts`
  - `src/features/taxes`
  - `src/features/backups`
  - `src/features/settings`
  - `src/features/market-snap`
- shared UI components
- app routes

## Required Production-Grade Solution

Refactor gradually, preserving behavior.

Required approach:
1. Do not do a massive risky rewrite.
2. Keep `DealerFlowApp` as a thin shell initially:
   - layout,
   - nav,
   - active organization,
   - top-level data load,
   - route delegation.
3. Extract feature components one by one:
   - DashboardView
   - VehicleListView
   - VehicleDetailView
   - VehicleExpenseTab
   - VehicleSaleTab
   - CashView
   - ContactsView
   - TaxesView
   - BackupsView
   - SettingsView
   - MarketSnapView
4. Move feature-specific handlers close to the feature or into hooks:
   - `useVehicles`
   - `useExpenses`
   - `useCash`
   - etc.
5. Keep existing styling and UX.
6. Avoid changing business logic unless required by previous production-hardening prompts.
7. Add smoke tests or at minimum ensure build catches type issues.

## Implementation Plan

1. Measure current responsibilities of `DealerFlowApp`.
2. Extract the smallest complete feature first, likely dashboard or contacts.
3. Continue with vehicles, then cash/sales/backup.
4. Ensure imports remain clean.
5. Remove unused state from shell.
6. Run build after each major extraction if possible.
7. Add tests where practical.
8. Document new feature structure.

## Required Verification Matrix

Test matrix:
- Dashboard renders.
- Inventory list renders.
- Vehicle detail tabs render.
- Add vehicle flow still works.
- Add expense flow still works.
- Sale flow still works.
- Cash page still works.
- Contacts page still works.
- Taxes/backups/settings still work.
- Mobile nav still works.
- Deep links still work.
- Run `npm test`, `npm run lint`, `npm run build`.

## Acceptance Criteria

- `DealerFlowApp` is significantly smaller and acts as shell only.
- Feature modules have clear boundaries.
- No UX regression.
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
