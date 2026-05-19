# Deep Capture Release QA

This checklist is the release companion for Market Snap Deep Capture. It does not replace `docs/release-checklist.md`; it records the consent, extension, persistence, migration, deployment, rollback, and privacy checks that must pass before private beta use.

## Final release notes

- Deep Capture remains off until an owner/admin accepts the current consent, terms, and privacy versions.
- Basic visible DOM extraction remains available without Deep Capture, but network response observation, safe read-only section expansion, fee/outcome evidence, and model-improvement eligibility require active consent.
- Withdrawal disables future Deep Capture and should cause the extension to fail closed on the next consent refresh.
- Model improvement is separate from Deep Capture. Active bids/current offers stay observation features and are not training labels.
- Dealer Flow captures only visible vehicle/listing/business data from pages the signed-in client is authorized to view.

## Manual QA checklist

Run this checklist in both Chrome and Brave with a staging Dealer Flow organization and an authorized OpenLane account:

1. Load extension unpacked in Chrome/Brave.
2. Open Dealer Flow locally and sign in.
3. Open extension options.
4. Confirm Deep Capture is off before consent.
5. Open OpenLane active listing.
6. Confirm basic extraction works.
7. Accept Deep Capture consent.
8. Refresh OpenLane page.
9. Confirm Deep Capture badge is active.
10. Confirm network evidence appears only in sanitized debug/copy payload.
11. Save to Deal Radar.
12. Confirm backend persisted consent and capture.
13. Withdraw consent.
14. Refresh OpenLane page.
15. Confirm network observer no longer runs.
16. Confirm backend rejects deep capture.
17. Confirm basic extraction still works.
18. Confirm model improvement can be off while Deep Capture is on.
19. Confirm current bid is not training label.
20. Confirm build/deploy instructions.

## Migration checklist

1. Back up the target Supabase project before applying migrations.
2. Apply all migrations in filename order through `20260527_deep_capture_release_security_hardening.sql`.
3. Confirm `market_snap_capture_consents`, `market_snap_capture_consent_events`, `openlane_vehicle_identities`, `openlane_observations`, and `openlane_outcomes` have RLS enabled.
4. Confirm owner/admin users can accept, withdraw, export, and delete eligible unsaved Deep Capture data only inside their organization.
5. Confirm viewer/accountant users can read status but cannot accept, withdraw, export, delete, or disable model improvement.
6. Confirm `cleanup_market_snap_deep_capture_retention()` is executable by `service_role` only.
7. Confirm candidate/pending outcomes have `is_training_eligible = false`.
8. Confirm verified outcomes are training eligible only when model improvement is opted in.

## Supabase migration checklist

- Run `supabase db reset` on a local/staging project when the Supabase CLI is available.
- Run `supabase test db` if database tests are configured.
- Run the OpenLane Supabase verification queries from `docs/release-checklist.md`.
- Verify no financial tables are dropped, truncated, or bulk-deleted by Deep Capture migrations.
- Verify retention cleanup deletes only expired temporary observations and sanitizes outcome evidence instead of deleting business outcome rows.

## Vercel deployment checklist

- Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_APP_URL`.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, R2 keys, and any other secrets server-only.
- Set `RATE_LIMIT_BACKEND=supabase` in production.
- Set `MARKET_SNAP_EXTENSION_ORIGINS` to the exact Chrome/Brave extension origins used for the deployed extension.
- Follow `docs/market-snap-extension-deployment.md` to collect the extension ID, add Vercel env vars, redeploy, and validate Save to Deal Radar.
- Run `npm run verify:release` before deployment and confirm the Vercel build does not print secrets.
- Confirm Market Snap routes reject cross-origin requests except the configured extension origins.

## Chrome/Brave extension packaging checklist

- Load `browser-extension/` directly as an unpacked Manifest V3 extension.
- Confirm the manifest includes only required permissions and the OpenLane `.ca` and `.com` domains.
- Confirm the content scripts load storage, API client, extractor, network observer, safe expander, widget, capture runtime, and content script in order.
- Confirm no extension file contains Supabase service-role keys, Dealer Flow session tokens, OpenLane credentials, cookies, authorization headers, CAPTCHA bypass, proxy evasion, or hidden crawler logic.
- Confirm Copy JSON redacts sensitive fields and caps debug/network payload size.
- Confirm unsupported OpenLane pages do not show an intrusive widget or send capture spam.

## Rollback plan

1. Disable Deep Capture from Dealer Flow Settings for the affected organization.
2. Withdraw consent through `/api/market-snap/deep-capture-consent` if the UI is unavailable.
3. Remove the extension origin from `MARKET_SNAP_EXTENSION_ORIGINS` and redeploy Dealer Flow to block extension-origin calls.
4. Instruct users to turn off Deep Capture and observe-page-network-data in extension options, then reload OpenLane tabs.
5. Pause any scheduled retention/model export job that depends on Deep Capture data.
6. Do not delete saved Deal Radar listings, vehicle records, sales, cash transactions, tax reports, or audit logs during rollback.
7. If evidence minimization is required, run the owner/admin delete eligible unsaved captures action or the service-role retention cleanup after reviewing the target organization.

## Known limitations

- Real OpenLane validation requires an authorized OpenLane account and cannot be fully automated in CI.
- Chrome/Brave extension loading must be manually verified because the extension is shipped as an unpacked folder for now.
- Supabase RLS and maintenance-function grants require a real Supabase project or local Supabase CLI to verify beyond static migration review.
- Carfax content is not fetched, purchased, bypassed, or parsed unless the user can already see a visible authorized link or visible page text.
- Market Snap valuations remain estimates with confidence, warnings, and missing-data indicators; they are not guaranteed transaction outcomes.

## Security/privacy assurance statement

Deep Capture is an authorized page-capture feature, not a scraper bot. It must not bypass CAPTCHA, login walls, access controls, paywalls, anti-bot systems, rate limits, or Carfax restrictions. It must not collect or store passwords, cookies, authorization headers, session tokens, CSRF tokens, JWTs, refresh tokens, service-role keys, or unrelated personal data. It stores normalized vehicle/listing fields, capped evidence snippets, endpoint patterns, confidence/provenance metadata, and retention-limited payload summaries needed for Dealer Flow business features.
