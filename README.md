# Dealer Flow

Dealer Flow is a personal finance, inventory, tax-reporting, backup, and contact-management MVP for an independent vehicle dealer in Quebec.

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

Copy `.env.example` to `.env.local` and configure Supabase before using the app. The UI no longer uses demo data as the source of truth.

## Database

Apply `supabase/schema.sql` in Supabase SQL editor or through the Supabase CLI. Create a private storage bucket named `dealer-flow-private`.

The schema includes:

- Supabase Auth profile bootstrap
- organization creation/join RPCs
- role-aware RLS policies
- private storage policies
- activity logs
- backup job/file tables

## Backups

Local backups are generated in the browser from the currently loaded organization data. Automatic Cloudflare R2 backups are available at `/api/backups/daily` and scheduled by `vercel.json`; configure the R2 and service-role environment variables before enabling the cron in production.

## Validation

```powershell
npm test
npm run lint
npm run build
```

## Tax disclaimer

These calculations are estimates and must be validated by an accountant or tax professional.
