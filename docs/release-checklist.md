# Dealer Flow Release Verification Checklist

Dealer Flow is not ready for private beta, official launch, or real dealer data until this release gate passes and the manual checklist is signed off.

## Automated Release Gate

Run from the repository root:

```powershell
npm install
npm run verify:extension
npm run verify:release
```

`npm run verify:release` runs:

1. `npm run lint`
2. `npm test`
3. `npm run build`

`npm run verify:extension` runs the extension manifest/runtime and OpenLane extractor suites without building the full app.

The automated suite must remain deterministic and must not require production Supabase, Vercel, R2, or private credentials.

If a local generated `.next/dev/types/routes.d.ts` syntax error appears, delete `.next` and rerun `npm run build` before treating it as a source failure. Do not edit generated `.next` files or commit the cache.

## Required Automated Coverage

- Tax calculations: purchase tax by source, expense tax, sale tax, period filtering, PDF/CSV/JSON export escaping.
- Dashboard metrics: inventory status, sold counts, cash balances, profit, and period totals.
- Vehicle lifecycle: creation validation, VIN/domain validation, safe vehicle archive and financial reversal guards, correction workflows, and sold vehicle protections.
- Expense and cash integrity: atomic expense cash impact, balance calculations, reversal integrity, and negative balance rejection.
- Sales integrity: sale breakdown, duplicate active-sale blocking, void workflow, correction workflow, and voided-sale exclusion.
- Roles and permissions: owner/admin/member/accountant/viewer security helpers and route schemas.
- Backups: generation, ZIP verification, restore dry-run, missing file rejection, and restore preparation safety.
- Market Snap: market separation, condition risk, sold refresh skip, low/no comparable guardrails, CatBoost candidate-only status, and calibration reporting.
- Market Snap dashboard: confirm the inventory table reads persisted snapshots only, labels values as estimates, exposes confidence/comparable/missing/warning data, and does not display a browser-generated fallback when no snapshot exists.
- Migrations: required migration order, append-only release migrations, RLS/security grants, safe vehicle archive behavior, and explicit review of any exceptional permanent purge migration.

## Migration Readiness

Before applying to production:

1. Apply `supabase/schema.sql` to a clean Supabase project.
2. Apply every file in `supabase/migrations/` in filename order.
3. Confirm every migration is append-only or uses guarded `if exists` / `if not exists` statements where it changes existing schema.
4. Confirm normal vehicle removal calls `archive_vehicle` and preserves financial, vehicle, sale, cash, contact, attachment, backup, and activity-log history. Any `purge_vehicle_completely` use must remain exceptional, owner/admin-only, vehicle-scoped, explicitly confirmed, and separately reviewed.
5. Confirm RLS remains enabled for organization-owned tables.
6. Confirm security-definer RPCs check `auth.uid()` and organization role where user-triggered.
7. Confirm cash manual edits use `update_manual_company_cash_transaction` / `update_manual_external_cash_transaction`, direct cash update policies are removed, and system-generated cash rows can only be corrected through vehicle/sale workflows.
8. Confirm purchase correction excludes voided/reversed cash impacts, rejects duplicate active impacts, and recreates a missing linked purchase payment atomically.
9. Confirm sale void/correction fails closed for missing or duplicate cash impacts and preserves the original buyer link when no replacement buyer is entered.
10. Confirm VINs are normalized and validated, duplicate active VIN writes are blocked under concurrency, and direct user inserts cannot create system-generated cash rows.
11. Confirm destructive cleanup RPCs are either service-role only or, for the exceptional `purge_vehicle_completely` path, protected by authenticated owner/admin authorization, exact vehicle-scoped confirmation, organization/vehicle locks, and atomic balance guards. Confirm the normal UI has no permanent-delete action.

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
5. Add a vehicle expense and verify the cash impact appears exactly once; edit it to a lower amount and void one with a reason, confirming the expense remains in history and the linked cash reversal is recorded.
6. Record a sale and verify paper sale, real client payment, external commission, cash entries, and tax report totals.
7. Void a sale with a reason and verify reversal entries preserve the audit trail.
8. Correct a sale with a reason and verify the old sale is corrected, the new sale is active, and ledgers stay balanced.
9. Archive a vehicle and verify it disappears from active inventory but remains auditable.
10. Create company and external cash transactions, edit a manual row, then reverse it where allowed. Confirm the original and linked reversal remain visible and balances are deterministic.
11. Create buyer/seller/vendor/contact records and verify empty/error states.
12. Upload an allowed attachment and reject a dangerous file type.
13. Export tax PDF, CSV, and JSON.
14. Generate and verify a backup ZIP.
15. Run restore preparation and confirm it performs dry-run checks only.
16. Open Market Snap and Deal Radar; confirm estimates show confidence, comparable counts, missing data, and warnings. Confirm the Market Snap inventory table is empty or clearly reports an unavailable snapshot when stored valuation data is absent.
17. Refresh Dashboard, Vehicles, Cash, Contacts, Taxes, Backups, Market Snap, Deal Radar, and Settings routes.

## Market Snap OpenLane Extension Checklist

Complete in Chrome and Brave before shipping the extension:

Deep Capture has a dedicated release QA companion at `docs/deep-capture-release-qa.md`. Complete that checklist before enabling Deep Capture for a real organization.

1. Run Dealer Flow locally.
2. Apply migrations if needed.
3. Log into Dealer Flow.
4. Configure extension with base URL and organization ID.
5. Load extension unpacked in Chrome from `chrome://extensions`.
6. Load extension unpacked in Brave from `brave://extensions`.
7. Open OpenLane `.ca` vehicle detail page.
8. Open OpenLane `.com` vehicle detail page if accessible.
9. Confirm widget appears automatically.
10. Confirm retail value appears.
11. Confirm wholesale buy value appears.
12. Confirm max bid appears.
13. Confirm confidence and comparable count appear.
14. Confirm Carfax link is detected if visible.
15. Confirm photo count and URLs are extracted.
16. Confirm video count and URLs are extracted when visible.
17. Confirm Save to Deal Radar works.
18. Confirm unsupported pages do not show intrusive widget.
19. Confirm no duplicate widget after refresh/dynamic navigation.
20. Confirm popup remains usable for settings/status.

Before signing off, also confirm auto-analyze is on, auto-save is off by default, include media URLs is on, raw visible text is capped, Refresh analysis updates the same widget, Copy JSON copies listing and valuation data without media blobs or secrets, and dynamic OpenLane navigation updates extraction after content loads.

## OpenLane Live Verification Matrix

This matrix requires a real authorized OpenLane login and a Dealer Flow organization configured in the same browser profile. Do not use private APIs, background crawling, CAPTCHA bypass, login bypass, proxy evasion, or Carfax paywall bypass. Capture only the visible page the user opened.

Run the matrix in Chrome and Brave:

| Scenario | Required result |
| --- | --- |
| French active VDP | Widget appears, title/year/make/model/trim are correct, visible VIN and mileage are extracted, current bid or offer is observation-only, no outcome row is created. |
| English active VDP | Widget appears, active price remains observation-only, Carfax/media/disclosures are truthful, no duplicate widget after refresh or route changes. |
| VDP with purchase selling price | Page is not classified as `purchase_list`; selling price maps to `buyPriceAuction`; invoice/final acquisition stay blank unless total/fees are visible. |
| Purchase fee details | Buy price, fees, taxes, total invoice, and final acquisition cost stay separate; verified outcome evidence is present. |
| Post-sale pending | Candidate outcome is captured, pending/counter/sold values do not become verified training labels. |
| Post-sale accepted | Accepted amount becomes verified outcome only with accepted/visible evidence. |
| Carfax URL page | Widget says URL found when an actual link is visible; text-only pages say visible URL missing. |
| Video page | Photo/video counts and URLs are clean; logos/icons/translate assets are excluded. |
| Bid update page | Changing bid/offer changes Copy JSON and capture fingerprint; no outcome row is created from active bid changes. |
| Unsupported/search page | No intrusive widget; no capture spam; popup/settings remain usable. |

For every scenario record:

- Widget appears only when appropriate.
- Vehicle identity, VIN, mileage, current price state, Carfax state, media counts, disclosures, dealer notes, warnings, and missing data match the visible page.
- Copy JSON includes normalized extraction, legacy payload, section map summary, candidate scores, safe-expansion result, network summaries if enabled, backend response, and capture response.
- Refresh updates the same widget without duplicate overlays.
- Save to Deal Radar stores only visible, capped, safe metadata.
- No secret tokens, session data, data URLs, raw HTML blobs, or hidden/private data are captured.

## OpenLane Supabase Verification Queries

Run after the live matrix against the staging or production Supabase project used for the test organization. Replace `<organization_id>` with the Dealer Flow organization ID.

```sql
select id, vin, fallback_key, title, mileage_km, last_seen_at
from openlane_vehicle_identities
where organization_id = '<organization_id>'
order by last_seen_at desc
limit 20;

select id, page_type, capture_kind, current_bid, buy_now_price, photo_count, captured_at, observation_fingerprint
from openlane_observations
where organization_id = '<organization_id>'
order by captured_at desc
limit 20;

select id, source_page_type, capture_kind, confidence_level, sold_price_candidate, accepted_amount, buy_price_auction, total_invoice_amount, final_acquisition_cost, is_training_eligible, captured_at
from openlane_outcomes
where organization_id = '<organization_id>'
order by captured_at desc
limit 20;
```

Supabase sign-off requires:

- Active VDP bid/offer changes create observation rows only.
- Purchase fee and accepted post-sale pages create outcome rows only when visible evidence supports them.
- Candidate outcomes are not training eligible.
- Verified/manual outcomes are training eligible only when evidence is present.
- `openlane_vehicle_identities`, `openlane_observations`, and `openlane_outcomes` are organization-scoped by RLS.
- Viewer/accountant roles cannot write captures; owner/admin/member can capture only for their organization.
- No duplicate spam appears after refresh, route changes, or repeated widget rendering.

## Market Snap OpenLane Packaging Checklist

- `browser-extension/manifest.json` loads without errors as an unpacked Manifest V3 extension.
- No extension compilation step is required; the deployable folder is `browser-extension/`.
- Required scripts are present in manifest content script order: `storage.js`, `api-client.js`, `openlane-extractor.js`, `market-snap-widget.js`, and `content-script.js`.
- Widget CSS is loaded from `browser-extension/styles/widget.css`.
- Dealer Flow extension origins are configured in deployed environments with `MARKET_SNAP_EXTENSION_ORIGINS`.
- The extension is tested against visible, authorized OpenLane pages only.
- No CAPTCHA bypass, login bypass, hidden crawling, proxy evasion, Carfax paywall bypass, or secret token storage is present.
- Remaining real-browser findings are recorded before private beta approval.

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
