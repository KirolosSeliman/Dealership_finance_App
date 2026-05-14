# Dealer Flow Market Snap Extension

Chromium Manifest V3 extension for Chrome and Brave. The primary experience is an in-page Market Snap widget on OpenLane vehicle detail pages, not a separate popup workflow.

## What It Does

- Detects supported `openlane.ca` and `openlane.com` vehicle pages.
- Extracts visible OpenLane vehicle data from the current page only.
- Shows a compact floating widget with retail value, wholesale values, max bid, estimated costs, potential profit, confidence, comparables, warnings, missing data, Carfax availability, photo count, and video count.
- Lets the user refresh analysis, save to Deal Radar, copy extracted JSON, or open Dealer Flow.

## Supported Pages

- `https://*.openlane.ca/*`
- `https://*.openlane.com/*`

Unsupported OpenLane pages should not show an intrusive widget unless enough vehicle-detail markers are visible.

## What It Does Not Do

This is an authorized page-capture extension. It does not:

- bypass CAPTCHA
- bypass OpenLane login
- bypass Dealer Flow login
- bypass Carfax paywalls or paid report access
- crawl hidden pages in the background
- use stealth scraping, proxy rotation, fake user agents, or anti-bot evasion
- fetch private data that is not already visible to the logged-in user
- store Dealer Flow session tokens, Supabase keys, service-role keys, or API secrets

If a value is not visible in the page DOM, the extractor reports it as missing instead of inventing or fetching it.

## Installation In Chrome

No extension build step is required. Load the `browser-extension/` folder directly.

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the repository's `browser-extension/` folder.
6. Open the extension details page and confirm there are no load errors.

## Installation In Brave

No extension build step is required. Load the `browser-extension/` folder directly.

1. Open Brave.
2. Go to `brave://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the repository's `browser-extension/` folder.
6. Open the extension details page and confirm there are no load errors.

## Required Dealer Flow Setup

1. Run Dealer Flow locally with `npm run dev` or deploy it to a trusted environment.
2. Apply Supabase migrations before testing Deal Radar persistence.
3. Log into Dealer Flow in the same Chrome or Brave browser profile that will run the extension.
4. Open the extension Options page.
5. Set Dealer Flow base URL, for example `http://localhost:3000`.
6. Set the organization ID for the Dealer Flow organization being tested.
7. Leave auto-save to Deal Radar off unless intentionally testing auto-save.
8. In deployed environments, set `MARKET_SNAP_EXTENSION_ORIGINS` to include the installed extension origin shown by Chrome or Brave. Localhost development does not require storing any secret in the extension.

## Settings

Configure these values from the extension Options page:

- Dealer Flow base URL
- Organization ID
- Auto-analyze on supported pages
- Auto-save to Deal Radar, off by default
- Widget default collapsed
- Debug mode
- Include media URLs
- Include capped raw visible text

The user must already be signed in to Dealer Flow in the same browser profile.

## OpenLane Usage

1. Log into OpenLane normally.
2. Open an authorized OpenLane vehicle detail page.
3. Wait for the floating Market Snap widget to appear.
4. Review extracted vehicle data, retail value, wholesale values, max bid, profit, confidence, comparable count, warnings, and missing data.
5. Use Refresh analysis if OpenLane finishes loading late or dynamic navigation changes the listing.
6. Use Copy JSON to inspect the visible listing payload sent to Dealer Flow.
7. Use Save to Deal Radar only after reviewing the extracted data.

The widget should appear automatically. The popup is only a compact status/settings entry point.

## Troubleshooting

- Widget not appearing: confirm the page is an OpenLane vehicle detail page, auto-analyze is enabled, the extension is loaded without errors, and the page contains vehicle markers such as VIN, mileage, Carfax, lot/run data, or a gallery.
- Not authenticated: log into Dealer Flow in the same browser profile and refresh the OpenLane page.
- Invalid extension origin: add the extension origin to `MARKET_SNAP_EXTENSION_ORIGINS` in the Dealer Flow deployment, then redeploy/restart the backend.
- Organization missing: enter the Dealer Flow organization ID on the extension Options page.
- No comparables: Market Snap will cap confidence and avoid strong buy recommendations when comparable data is insufficient.
- Missing Carfax: the extension only captures Carfax links that are visible on the OpenLane page. It will not open, buy, or bypass a report.
- Photos/videos not visible: enable Include media URLs, then confirm the media URLs are present in the page DOM. The extension does not download media blobs.
- OpenLane page not supported: unsupported pages should not show an intrusive widget. Open a vehicle detail page with visible listing data.
- Save to Deal Radar fails: confirm the user has permission in the selected organization and Supabase migrations have been applied.

## Privacy And Security

- Captures visible page data only from the current OpenLane tab.
- Sends listing data only to the configured Dealer Flow backend.
- Uses the user's existing Dealer Flow browser session with `credentials: include`.
- Stores settings only in Chrome/Brave extension storage.
- Does not store secrets, service-role keys, Supabase keys, or session tokens.
- Does not store base64 photo or video blobs.
- Caps raw visible text before sending it to Dealer Flow.

## Release Checklist

Run these automated checks from the repository root:

```powershell
npm run verify:extension
npm run verify:release
```

Manual release verification must cover both Chrome and Brave:

1. Run Dealer Flow locally.
2. Apply migrations if needed.
3. Log into Dealer Flow.
4. Configure extension with base URL and organization ID.
5. Load extension unpacked in Chrome.
6. Load extension unpacked in Brave.
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
