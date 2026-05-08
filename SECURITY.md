# Dealer Flow Security Policy

Dealer Flow stores sensitive dealership, financial, tax, and client data. Treat every production environment as confidential.

## Supported Reporting

If a secret is exposed or unauthorized access is suspected:

1. Rotate the affected Supabase, Cloudflare R2, Vercel, or GitHub secret immediately.
2. Revoke any exposed token from the provider dashboard.
3. Check Supabase Auth, Storage, database logs, R2 access logs, and Vercel deployment logs.
4. Generate and verify a fresh backup after rotation.
5. Document what was exposed and which records may have been accessed.

## Secret Rules

- Never commit `.env.local`, `.env.production`, service-role keys, R2 keys, cron secrets, database URLs, or private tokens.
- `NEXT_PUBLIC_*` values are public browser values. Never put secrets in them.
- `SUPABASE_SERVICE_ROLE_KEY`, R2 credentials, and `CRON_SECRET` must only exist in server-side environments.
- Rotate secrets after accidental paste, screenshot, repository exposure, or shared terminal log.

## Access Control Model

- Supabase Auth identifies the user.
- Organization membership and role decide access.
- Supabase RLS enforces organization isolation.
- API routes re-check current-user role before sensitive writes.
- Owner/admin can manage backups and cash.
- Owner/admin/member can manage vehicles, expenses, sales, contacts, and attachments.
- Accountant can view/export reports but cannot perform operational writes.
- Viewer is read-only.

## Private Files

All sensitive uploads must use the private `dealer-flow-private` Supabase Storage bucket and paths under:

```text
organizations/{organization_id}/{generated_file_name}
```

Allowed upload MIME types:

- `image/jpeg`
- `image/png`
- `image/webp`
- `application/pdf`
- `text/csv`

Do not use public URLs for driver's license photos, invoices, tax reports, backups, or private business documents.

