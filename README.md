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
- Market Snap foundation module with Deal Radar, Market Data Admin, browser-extension scaffold, and ML-service scaffold

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
- `RATE_LIMIT_BACKEND=supabase` for production persistent rate limiting

Cloudflare R2 automatic backups require:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

Optional Market Snap variables:

- `MARKET_SNAP_ML_SERVICE_URL`
- `MARKET_SNAP_EXTENSION_ORIGINS` for deployed browser-extension API calls. Use exact origins such as `chrome-extension://<extension-id>`.

Do not expose service-role or R2 secrets to the browser. `CRON_SECRET` is required; `/api/backups/daily` and `/api/market-snap/cron/daily-refresh` return an error when it is missing or incorrect.

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
20260508_attachment_security.sql
20260508_p0_atomic_security.sql
20260508_production_constraints.sql
20260509_membership_role_resolution.sql
20260509_recurring_expenses_funding_source.sql
20260510_delete_vehicle_cascade.sql
20260510_delete_vehicle_cascade_hardening.sql
20260510_market_snap_foundation.sql
20260511_market_snap_hardening.sql
20260512_market_snap_production_hardening.sql
20260513_vehicle_archive.sql
20260514_purchase_tax_consistency.sql
20260515_atomic_expense_cash_impact.sql
20260516_cash_ledger_reversal_integrity.sql
20260517_vehicle_financial_corrections.sql
20260518_sale_void_correction_workflow.sql
20260519_validation_domain_integrity.sql
20260520_persistent_rate_limiting.sql
20260521_market_snap_calibration_guardrails.sql
20260522_openlane_extension_payload.sql
20260523_openlane_capture_storage.sql
20260524_market_snap_training_export_safety.sql
20260525_market_snap_deep_capture_consent.sql
20260526_deep_capture_retention_training_guards.sql
20260527_deep_capture_release_security_hardening.sql
20260821_external_cash_manual_add.sql
20260823_atomic_external_cash_transfer.sql
20260825_archive_vehicle_cash_refund.sql
20260826_permanent_vehicle_purge.sql
20260827_vehicle_archive_default.sql
20260828_atomic_expense_void.sql
20260829_cash_ledger_reversal_hardening.sql
20260830_vehicle_correction_integrity.sql
20260831_sale_cash_impact_integrity.sql
20260832_validation_domain_integrity_hardening.sql
20260833_accounting_model_v2.sql
```

The production constraints migrations add financial data checks, prevent duplicate sales for the same vehicle, validate organization matches for expenses/sales/attachments, enforce private attachment paths, protect final owners, restrict sensitive file reads, and add atomic vehicle/sale/expense RPCs. Validation hardening normalizes and validates VINs, blocks concurrent duplicate active VIN writes, and prevents direct manual insertion of system-generated cash rows.

Accounting Model V2 is additive and versioned. New vehicle purchases require an explicit persisted purchase-tax rate, new sales use atomic V2 RPCs with sale-before-tax, customer-total, company/external routing, company cost basis, pending recoverable tax, sale-time tax settlement, estimated profit tax, and tracked net profit. Legacy sales remain readable under their original paper-sale semantics. Apply `20260833_accounting_model_v2.sql` after the validation hardening migration; it preserves historical financial rows and adds only forward-compatible columns, constraints, indexes, and RPCs.

Normal vehicle removal uses the owner/admin-only `archive_vehicle(uuid, uuid, text)` RPC from `20260825_archive_vehicle_cash_refund.sql`. It hides the vehicle from active inventory, preserves financial, tax, sale, cash, document, and activity history, and reverses live vehicle-cost cash impacts with linked auditable rows. Vehicles with an active sale must have the sale voided before archival. Expense creation, correction, and voiding use atomic database RPCs; voiding preserves the expense and adds a linked cash reversal. Cash corrections preserve the original entry and require a linked reversal; manual cash edits use account-specific atomic RPCs and system-generated rows cannot be edited directly. The application does not push migrations automatically; apply the archive, `20260827_vehicle_archive_default.sql`, `20260828_atomic_expense_void.sql`, `20260829_cash_ledger_reversal_hardening.sql`, `20260830_vehicle_correction_integrity.sql`, `20260831_sale_cash_impact_integrity.sql`, and `20260832_validation_domain_integrity_hardening.sql` migrations before enabling the production UI flow. The historical `purge_vehicle_completely` RPC is disabled for `public` and `authenticated` by the forward migration and is not part of the application workflow.

High-risk writes use domain-specific routes for vehicles, expenses, sales, and cash. They share the authenticated handler in `src/lib/server/domain-mutation-handlers.ts`, apply per-domain rate-limit buckets, and preserve the old `/api/mutations` endpoint only as a deprecated compatibility path for existing clients. New clients should use the domain routes; the legacy route must not receive new financial mutation logic.

The client UI keeps `DealerFlowApp` as the shell for authentication, organization scope, route state, data loading, and feature delegation. Renderers live in `src/features/app/feature-views.tsx` with domain entrypoints under `src/features/dashboard`, `src/features/vehicles`, `src/features/cash`, `src/features/contacts`, `src/features/taxes`, `src/features/backups`, `src/features/settings`, and `src/features/market-snap`. This keeps feature rendering changes out of the shell while preserving the existing design and navigation behavior.

Market Snap depends on the Market Snap migrations. The foundation migration creates sources, market listings, Deal Radar, valuation history, ML run/version tables, data settings, and RLS. The hardening migrations add condition/image/diagnostic features, retention cleanup, import quality fields, sold-vehicle prediction-error columns, indexes, cron job observability, and stricter maintenance-function/model-version access.

## Market Snap

Market Snap is additive to the existing Dealer Flow app. It keeps clean retail, wholesale, auction, salvage, rebuilt, and parts/non-running market contexts separate. The production MVP uses a comparable estimator with time-decay weighting and condition/risk scoring; the CatBoost service in `ml-service/` is candidate-only until a model is trained, evaluated, manually promoted, versioned, and proven better than the comparable baseline.

Market Snap values are estimates, not appraisals, offers, or guaranteed sale prices. The dashboard reads only the latest persisted valuation snapshot for each active vehicle and exposes its confidence score, comparable count, missing data, and warnings; it does not manufacture a fallback value in the browser. No- and low-comparable estimates are confidence-capped and cannot receive a `Strong Buy` recommendation. Sold vehicles are excluded from refresh, while active, non-voided sales can link to the preceding valuation and are included in the owner/admin calibration report at `/api/market-snap/admin/calibration`.

The calibration report is based on stored prediction outcomes and reports average absolute error, median absolute error, average percentage error, and error groupings by make/model, source, and confidence band. It is a monitoring aid, not evidence that the estimator is universally accurate. The report uses the declared paper sale price as the retail-sale outcome, matching Dealer Flow's taxable sale model.

Browser capture lives in `browser-extension/`. Configure the extension from its Options page with the Dealer Flow URL and organization ID. For deployed testing, configure `MARKET_SNAP_EXTENSION_ORIGINS` with the exact installed extension origin; see `docs/market-snap-extension-deployment.md`. It is for visible, authorized, user-assisted listing capture only and must not be used for CAPTCHA bypass, login-wall bypass, proxy evasion, anti-bot evasion, rate-limit bypass, private-message capture, or unauthorized scraping.

### Local Market Snap ML service

Authorized Scrapling extraction is served by `ml-service/` and called server-side through `MARKET_SNAP_ML_SERVICE_URL`.

```powershell
cd ml-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Then run Dealer Flow with `MARKET_SNAP_ML_SERVICE_URL=http://localhost:8000`. Scheduled source sync calls `/sources/sync` in the ML service for OpenLane and Facebook Marketplace, using `MARKET_SNAP_OPENLANE_SEARCH_URLS` and `MARKET_SNAP_MARKETPLACE_SEARCH_URLS` when configured. The extension still uses the authorized extraction API when `dealerFlowBaseUrl`, `organizationId`, and session cookies are available. CatBoost remains candidate-only; use Python 3.11/3.12 for CatBoost training because the pinned CatBoost package does not currently install cleanly on Python 3.13.

Market Snap source sync uses Vercel Cron at `/api/market-snap/cron/sync-openlane` (`0 9 * * *`) and `/api/market-snap/cron/sync-marketplace` (`0 12 * * *`). These schedules are once daily so the project can deploy on Vercel Hobby; use Vercel Pro or an external scheduler before increasing cron frequency. Market Snap daily refresh uses Vercel Cron at `/api/market-snap/cron/daily-refresh`. It refreshes only active inventory statuses (`purchased`, `in_repair`, `listed_for_sale`), skips sold vehicles, and avoids duplicate valuation snapshots when no meaningful change occurred. Retention cleanup and model-version writes are service-role maintenance operations; the authenticated application cannot invoke them directly.

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
- Run `supabase/schema.sql`, then every SQL file in `supabase/migrations` in filename order, including `20260833_accounting_model_v2.sql`.
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
