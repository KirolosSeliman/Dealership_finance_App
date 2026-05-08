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

- Full backup download and R2 upload are owner/admin only.
- Backup ZIP verification is local and does not execute backup content.
- Restore dry-run validates structure and reports conflicts without writing data.
- Backup ZIPs include metadata and CSV/PDF/JSON exports but must be treated as sensitive files.

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

