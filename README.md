# Dealer Flow

Dealer Flow is a personal finance, inventory, tax-reporting, backup, and contact-management app for an independent vehicle dealer in Quebec.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth, PostgreSQL, RLS, and private Storage
- Recharts
- PWA manifest/service worker
- Local ZIP backups
- Cloudflare R2 backup upload route

## Local development

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

Copy `.env.example` to `.env.local` and configure Supabase before using the app. Production flows use Supabase data as the source of truth.

## Environment variables

Required client-safe variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`

Required server-only variables:

- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

Cloudflare R2 automatic backups require:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

Do not expose service-role or R2 secrets to the browser. `CRON_SECRET` is required; `/api/backups/daily` returns an error when it is missing or incorrect.

## Database

Apply `supabase/schema.sql` in Supabase SQL editor or through the Supabase CLI. Create a private storage bucket named `dealer-flow-private`.

The schema includes:

- Supabase Auth profile bootstrap
- organization creation/join RPCs
- role-aware RLS policies
- private storage policies
- activity logs
- backup job/file tables

After the base schema, run the migrations in `supabase/migrations`:

```text
20260507_sales_member_policy.sql
20260508_production_constraints.sql
20260508_attachment_security.sql
20260508_p0_atomic_security.sql
20260509_membership_role_resolution.sql
20260509_recurring_expenses_funding_source.sql
20260510_delete_vehicle_cascade.sql
20260510_delete_vehicle_cascade_hardening.sql
```

The production constraints migrations add financial data checks, prevent duplicate sales for the same vehicle, validate organization matches for expenses/sales/attachments, enforce private attachment paths, protect final owners, restrict sensitive file reads, and add atomic vehicle/sale RPCs.

Vehicle deletion depends on the `delete_vehicle_and_related_data(uuid, uuid)` RPC created by the 20260510 vehicle deletion migrations. Deploying code alone does not create this database function; run those SQL files in Supabase before using vehicle deletion in production.

## Backups

Local backups are generated from the currently loaded organization data as ZIP files. The ZIP includes JSON, CSV, a manifest, attachment metadata, activity logs, and a real PDF summary.

The Backups page can verify a backup ZIP before trusting it and can run a restore dry-run. Dry-run parses the ZIP and reports counts/conflicts without writing to Supabase.

Automatic Cloudflare R2 backups are available at `/api/backups/daily` and scheduled by `vercel.json`; configure the R2, service-role, and `CRON_SECRET` environment variables before enabling the cron in production. Backups are written under:

```text
dealer-flow-backups/{organization_id}/{year}/{month}/dealer-flow-backup-{date}-{timestamp}.zip
```

Manual R2 uploads require an authenticated owner/admin of the selected organization.

## Deployment checklist

- Configure all environment variables from `.env.example`.
- Run `supabase/schema.sql`, then every SQL file in `supabase/migrations`.
- Confirm `dealer-flow-private` is a private Supabase Storage bucket.
- Confirm RLS is enabled on organization-owned tables.
- Confirm `CRON_SECRET` is set in production and in the Vercel cron authorization header.
- Run `npm test`, `npm run lint`, and `npm run build`.
- Generate a local backup, verify it, and run restore dry-run before relying on backup files.
- Trigger one manual R2 backup upload as an owner/admin and confirm the object appears in Cloudflare R2.
- Review [SECURITY.md](SECURITY.md) and [docs/deployment-security.md](docs/deployment-security.md) before real business use.

## Validation

```powershell
npm test
npm run lint
npm run build
```

## Tax disclaimer

These calculations are estimates and must be validated by an accountant or tax professional.
