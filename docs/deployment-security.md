# Dealer Flow Deployment Security

## Required Environment Variables

Client-safe:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`

Server-only:

- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

Never prefix service-role, R2 secret, cron, database, or token values with `NEXT_PUBLIC_`.

## Supabase Setup

1. Run `supabase/schema.sql`.
2. Run every migration in `supabase/migrations`.
3. Confirm RLS is enabled on all organization-owned tables.
4. Confirm the `dealer-flow-private` bucket exists and is private.
5. Confirm storage policies only allow organization-scoped paths.

Required migrations:

- `20260507_sales_member_policy.sql`
- `20260508_production_constraints.sql`
- `20260508_attachment_security.sql`
- `20260508_p0_atomic_security.sql`

## Vercel Setup

1. Add all required environment variables in Vercel Project Settings.
2. Configure Vercel Cron to call `/api/backups/daily`.
3. Send `Authorization: Bearer {CRON_SECRET}` with the cron request.
4. Never print environment variables in build logs.

## Cloudflare R2 Setup

1. Use an account-level R2 token scoped only to the `dealerflow` bucket.
2. Grant only object read/write permissions needed for backups.
3. Keep the bucket private.
4. Do not configure public access for backup objects.
5. Rotate R2 keys if they are pasted into chat, screenshots, logs, or GitHub.

## Backup Safety

- Full backup download and R2 upload are generated server-side and are owner/admin only.
- Accountant users can export tax reports, but cannot generate full sensitive backups.
- Mutation, backup, restore-preparation, tax-export, and VIN routes use lightweight rate limiting.
- Browser mutation and backup POST routes reject unsafe cross-origin requests.
- Backup ZIP verification is local and does not execute backup content.
- Restore dry-run validates structure and reports conflicts without writing data.
- Restore preparation is owner-only. It creates a pending restore job only after the backup ZIP passes manifest/version/file/organization checks; it does not overwrite business records.
- Backup ZIPs include metadata and CSV/PDF/JSON exports but must be treated as sensitive files.

## Manual P1 Verification

Before using real business data, manually verify:

1. Log in as owner/admin and confirm full local backup download succeeds.
2. Log in as accountant and confirm tax PDF/CSV/JSON export succeeds, but full backup download/R2 upload is blocked.
3. Log in as member/viewer and confirm full backup and tax export buttons are unavailable or blocked.
4. Upload a valid backup ZIP in Backups / Exports and confirm restore preparation reports counts without writing business records.
5. Upload an invalid ZIP and confirm restore preparation returns a clear error.
6. Try editing a cash transaction so the resulting company/external balance would become negative and confirm the server rejects it.
7. Confirm Cloudflare R2 objects are private and the uploaded backup appears under `dealer-flow-backups/{organization_id}/{year}/{month}/`.

## Manual P2 Verification

Before production launch, do one browser pass on desktop and an iPhone-sized viewport:

1. Confirm Dashboard, Vehicles, Cash, Contacts, Taxes / Reports, Backups / Exports, and Settings have readable empty states with no organization data.
2. Confirm vehicle detail tabs scroll horizontally on mobile and forms do not force accidental page-wide horizontal scrolling.
3. Confirm wide ledger/inventory tables scroll inside their panels only.
4. Confirm the PWA manifest loads from `/manifest.webmanifest`, the app name is Dealer Flow, the dark theme color is applied, and `/icon.svg` is reachable.
5. Confirm successful backup verification, backup generation, R2 upload, restore preparation, tax export, role change, and document upload create activity logs without storing sensitive document contents.

## Final Launch Checklist

Run this checklist before entering real business data:

1. Supabase database
   - Apply `supabase/schema.sql` to a clean production project.
   - Apply every file in `supabase/migrations/`, including `20260508_p0_atomic_security.sql`.
   - Confirm RLS is enabled on every organization-owned table.
   - Confirm `organization_memberships_final_owner` exists and blocks removal of the final owner.

2. Supabase private storage
   - Confirm the `dealer-flow-private` bucket exists.
   - Confirm the bucket is not public.
   - Upload a test invoice/photo and confirm only allowed organization roles can open the signed URL.

3. Role verification
   - Owner: can manage users, backups, settings, vehicles, cash, contacts, and reports.
   - Admin: can manage operational data and backups, but cannot remove the final owner.
   - Member: can manage vehicles, expenses, sales, contacts, and attachments only.
   - Accountant: can view/export tax reports but cannot write operational data or full backups.
   - Viewer: read-only.

4. Backup and restore safety
   - Download a local backup ZIP.
   - Verify the backup ZIP in the Backups / Exports page.
   - Run restore preparation and confirm it creates only a pending restore job.
   - Confirm actual restore execution remains disabled until a transaction-backed restore RPC is reviewed.
   - Upload a manual R2 backup and confirm the object is private.

5. Cloudflare R2 and Vercel
   - Configure `CRON_SECRET` and all R2 server-only env vars.
   - Trigger `/api/backups/daily` with `Authorization: Bearer {CRON_SECRET}`.
   - Confirm missing/wrong cron secrets are rejected.
   - Confirm Vercel logs do not print secrets.

6. GitHub and operations
   - Enable secret scanning and push protection.
   - Enable Dependabot alerts and CodeQL.
   - Rotate any Supabase or Cloudflare keys that were shared in chat, screenshots, logs, or commits.
   - Keep `.env.local` out of Git.

7. Real-device launch pass
   - Test desktop Chrome/Edge.
   - Test iPhone Safari.
   - Add to iPhone Home Screen and confirm Dealer Flow name/icon/theme.
   - Confirm tables and vehicle tabs scroll inside their panels instead of breaking page width.

## Deferred P3 Restore Execution

Actual restore execution is intentionally not enabled yet. It should be added only after a dedicated restore migration/RPC is reviewed with real backup samples. The restore execution design must be owner-only, require explicit confirmation, run inside a database transaction, reject conflicts, avoid silent overwrites, create activity logs, and rollback completely on failure.

## GitHub Security

Recommended repository settings:

- Enable secret scanning and push protection.
- Enable Dependabot alerts.
- Enable CodeQL for JavaScript/TypeScript.
- Use least-privilege workflow permissions.
- Do not use `pull_request_target` workflows with secrets.

## Pre-Deployment Checks

Run:

```powershell
npm audit
npm run lint
npm test
npm run build
```

Manually verify:

- Viewer cannot create/update/delete records.
- Accountant cannot perform operational writes.
- Member cannot manage roles or backups.
- Users cannot access another organization by changing URLs.
- Private files open only for organization members.
- R2 backup object appears in Cloudflare and is not public.
