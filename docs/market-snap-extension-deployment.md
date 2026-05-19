# Market Snap Extension Deployment

This guide is the operator checklist for connecting the unpacked Dealer Flow Market Snap extension to a deployed Dealer Flow backend on Vercel. It keeps extension access explicit: only exact installed extension origins are allowed, and the extension must still use the normal signed-in Dealer Flow session and organization role checks.

## Required Environment

Set these values in Vercel Project Settings for the target environment:

- `NEXT_PUBLIC_APP_URL`: deployed Dealer Flow URL, for example `https://dealer-flow.example`.
- `NEXT_PUBLIC_SUPABASE_URL`: the Supabase project URL for the same environment.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the public anon key for that Supabase project.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service role key. Never expose this to the browser.
- `CRON_SECRET`: server-only cron secret for backup and Market Snap scheduled routes.
- `RATE_LIMIT_BACKEND`: `supabase` in production.
- `MARKET_SNAP_EXTENSION_ORIGINS`: comma-separated exact extension origins, for example `chrome-extension://<extension-id>`.

Do not add `http://localhost:3000` to `MARKET_SNAP_EXTENSION_ORIGINS`. Local browser testing uses the extension setting named Dealer Flow URL and same-origin app routes; cross-origin extension API calls are allowed only from the exact `chrome-extension://...` origins listed above.

## Get The Extension Origin

1. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
2. Enable Developer mode.
3. Load the unpacked extension from `browser-extension/`.
4. Copy the extension ID shown on the extension card.
5. Convert it to an origin: `chrome-extension://<extension-id>`.
6. Add one origin per installed browser profile if Chrome and Brave produce different IDs.

Brave still uses the `chrome-extension://<extension-id>` origin scheme. Do not invent a `brave-extension://` origin.

## Configure Vercel

Use the Vercel dashboard or CLI. CLI example:

```powershell
vercel env add MARKET_SNAP_EXTENSION_ORIGINS production
vercel env add NEXT_PUBLIC_APP_URL production
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add CRON_SECRET production
vercel env add RATE_LIMIT_BACKEND production
```

Then redeploy:

```powershell
vercel --prod
```

For preview environments, add the same variables to Preview and use the preview Dealer Flow URL in the extension settings.

## Extension Settings

In the extension Options page:

1. Set Dealer Flow URL to the deployed app URL for production testing, or `http://localhost:3000` for local testing.
2. Set Organization ID to the Dealer Flow organization that should receive captures.
3. Confirm Auto-analyze is on.
4. Confirm Capture observations/outcomes is on only for authorized OpenLane testing.
5. Confirm Observe page network data is on only when Deep Capture is enabled and authorized.
6. Save settings and confirm the widget reports the saved state.

Missing or blank Dealer Flow URL falls back to local development. For production testing, always confirm the visible setting is the deployed URL before using Save to Deal Radar.

## Backend Validation

The deployed backend should allow:

- Same-origin Dealer Flow app requests from `NEXT_PUBLIC_APP_URL`.
- Exact extension origins listed in `MARKET_SNAP_EXTENSION_ORIGINS`.
- Authenticated users with the required organization role.

It should reject:

- Unlisted extension origins.
- Requests without a Dealer Flow authenticated session.
- Requests for an organization the user does not belong to.
- Deep Capture payloads without active consent where the backend requires consent.
- Unsafe evidence containing cookies, tokens, credentials, private account data, or oversized raw/debug payloads.

The extension must collect no cookies, no authorization headers, no passwords, no session tokens, no CSRF tokens, and no unrelated profile, billing, account, or payment data.

## Validation After Redeploy

1. Run `npm run lint`.
2. Run `npm test`.
3. Run `npm run build`.
4. Run `npm run verify:extension`.
5. If the Vercel CLI is available and linked, run `vercel build`.
6. Reload the unpacked extension from `chrome://extensions`.
7. Log into Dealer Flow at the same deployed Dealer Flow URL configured in the extension.
8. Open an authorized `https://app.openlane.ca/vdp/...` page.
9. Confirm the widget appears only on supported OpenLane capture pages.
10. Confirm Copy JSON includes readiness, Deep Capture runtime status, sanitized network summaries, and no secrets.
11. Confirm VIN, mileage, CARFAX status, current bid, media counts, and disclosures match the visible page.
12. Click Save to Deal Radar.
13. Confirm the widget shows Saved to Deal Radar and records returned IDs.
14. Open Deal Radar and confirm the saved listing exists under the expected Organization ID.

## Rollback

1. Remove the affected origin from `MARKET_SNAP_EXTENSION_ORIGINS`.
2. Redeploy Dealer Flow with `vercel --prod`.
3. Reload the extension and turn off Deep Capture and Observe page network data in extension settings.
4. Withdraw Deep Capture consent for the organization if the issue involves deep evidence capture.
5. Do not delete Deal Radar listings, OpenLane observations/outcomes, inventory, sales, cash, tax, backup, or activity-log records during rollback. Use reviewed cleanup/void/retention flows only.
