# Dealer Flow Release Verification Checklist

Dealer Flow is not ready for private beta, official launch, or real dealer data until this release gate passes and the manual checklist is signed off.

## Automated Release Gate

Run from the repository root:

```powershell
npm install
npm run verify:release
```

`npm run verify:release` runs:

1. `npm run lint`
2. `npm test`
3. `npm run build`

The automated suite must remain deterministic and must not require production Supabase, Vercel, R2, or private credentials.

## Required Automated Coverage

- Tax calculations: purchase tax by source, expense tax, sale tax, period filtering, PDF/CSV/JSON export escaping.
- Dashboard metrics: inventory status, sold counts, cash balances, profit, and period totals.
- Vehicle lifecycle: creation validation, VIN/domain validation, archive safety, correction workflows, and sold vehicle protections.
- Expense and cash integrity: atomic expense cash impact, balance calculations, reversal integrity, and negative balance rejection.
- Sales integrity: sale breakdown, duplicate active-sale blocking, void workflow, correction workflow, and voided-sale exclusion.
- Roles and permissions: owner/admin/member/accountant/viewer security helpers and route schemas.
- Backups: generation, ZIP verification, restore dry-run, missing file rejection, and restore preparation safety.
- Market Snap: market separation, condition risk, sold refresh skip, low/no comparable guardrails, CatBoost candidate-only status, and calibration reporting.
- Migrations: required migration order, append-only release migrations, RLS/security grants, and no unreviewed destructive production data changes.

## Migration Readiness

Before applying to production:

1. Apply `supabase/schema.sql` to a clean Supabase project.
2. Apply every file in `supabase/migrations/` in filename order.
3. Confirm every migration is append-only or uses guarded `if exists` / `if not exists` statements where it changes existing schema.
4. Confirm no migration drops financial, vehicle, sale, cash, contact, attachment, backup, or activity-log data.
5. Confirm RLS remains enabled for organization-owned tables.
6. Confirm security-definer RPCs check `auth.uid()` and organization role where user-triggered.
7. Confirm destructive cleanup RPCs are service-role only.

## Supabase And Storage Checklist

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set for the correct project.
- `SUPABASE_SERVICE_ROLE_KEY` is set only in server-side environments.
- The `dealer-flow-private` bucket exists and is private.
- Storage policies limit paths by organization membership.
- Owner/admin/member can upload allowed vehicle documents.
- Viewer/accountant cannot mutate operational records.
- Cross-organization URL tampering is rejected by RLS and server checks.

## Vercel And Runtime Checklist

- `NEXT_PUBLIC_APP_URL` points to the deployed app.
- `RATE_LIMIT_BACKEND=supabase` in production.
- `CRON_SECRET` is set and not exposed client-side.
- Vercel Cron calls `/api/backups/daily` with `Authorization: Bearer {CRON_SECRET}`.
- R2 variables are set only if automated external backup is expected:
  - `R2_ACCOUNT_ID`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_BUCKET_NAME`
- Production build passes on Vercel without printing secrets.

## Manual Desktop Browser Checklist

Complete in a fresh desktop browser session:

1. Sign up and log in.
2. Create an organization.
3. Join an organization with an invite code and verify the new user starts with the expected restricted role.
4. Add a vehicle and refresh/deep link to the vehicle detail page.
5. Add a vehicle expense and verify the cash impact appears exactly once.
6. Record a sale and verify paper sale, real client payment, external commission, cash entries, and tax report totals.
7. Void a sale with a reason and verify reversal entries preserve the audit trail.
8. Correct a sale with a reason and verify the old sale is corrected, the new sale is active, and ledgers stay balanced.
9. Archive a vehicle and verify it disappears from active inventory but remains auditable.
10. Create company and external cash transactions, then reverse them where allowed.
11. Create buyer/seller/vendor/contact records and verify empty/error states.
12. Upload an allowed attachment and reject a dangerous file type.
13. Export tax PDF, CSV, and JSON.
14. Generate and verify a backup ZIP.
15. Run restore preparation and confirm it performs dry-run checks only.
16. Open Market Snap and Deal Radar; confirm estimates show confidence, comparable counts, missing data, and warnings.
17. Refresh Dashboard, Vehicles, Cash, Contacts, Taxes, Backups, Market Snap, Deal Radar, and Settings routes.

## Manual Mobile Checklist

Complete on an iPhone-sized viewport or real iPhone:

1. Login/signup forms fit without horizontal scrolling.
2. Navigation can reach every primary route.
3. Vehicle detail tabs scroll within their tab row.
4. Wide inventory, ledger, tax, and Market Snap tables scroll inside their panels only.
5. Add vehicle, add expense, record sale, tax export, and backup pages remain readable.
6. Refreshing deep links preserves the intended route.
7. Empty, loading, error, and dangerous-action states remain visible and usable.

## Role Matrix

- Owner: can manage organizations, roles, backups, settings, vehicles, cash, contacts, reports, and attachments.
- Admin: can manage operational data and backups, but cannot remove the final owner.
- Member: can manage vehicles, expenses, sales, contacts, and attachments; cannot manage roles or full backups.
- Accountant: can view/export tax reports; cannot write operational data or full backups.
- Viewer: read-only; cannot mutate or export sensitive full backups.

## Release Decision

- Private beta: allowed only after automated gate passes, migrations are applied to a staging Supabase project, and desktop/mobile manual checklists pass with no critical findings.
- Official launch: allowed only after private beta passes on real workflows, R2/Vercel/Supabase production checks pass, and no high-severity financial, security, or data-loss issue remains.
- Not ready: any failed automated command, missing migration, unverified RLS/storage, unresolved financial mismatch, or incomplete manual browser pass.
