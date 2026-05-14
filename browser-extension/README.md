# Dealer Flow Market Snap Extension

Chromium Manifest V3 extension for Chrome and Brave. The primary experience is an in-page Market Snap widget on OpenLane vehicle detail pages, not a separate popup workflow.

## What It Does

- Detects supported `openlane.ca` and `openlane.com` vehicle pages.
- Extracts visible OpenLane vehicle data from the current page only.
- Shows a compact floating widget with retail value, wholesale values, max bid, estimated costs, potential profit, confidence, comparables, warnings, missing data, Carfax availability, photo count, and video count.
- Lets the user refresh analysis, save to Deal Radar, copy extracted JSON, or open Dealer Flow.

## Compliance Boundary

This is an authorized page-capture extension. It does not bypass login walls, CAPTCHA, paywalls, anti-bot controls, rate limits, private APIs, or Carfax access. If a value is not visible in the page DOM, the extractor reports it as missing instead of inventing or fetching it.

The extension sends visible listing metadata to the user's own authenticated Dealer Flow backend. It does not store service-role keys, Supabase keys, or Dealer Flow session tokens.

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

The user must already be signed in to Dealer Flow in the same browser profile. `MARKET_SNAP_EXTENSION_ORIGINS` must include the installed extension origin for production/staging API calls.

## Local Installation

1. Open Chrome or Brave.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the `browser-extension` folder.
6. Open the extension options and set Dealer Flow URL plus organization ID.
7. Sign into Dealer Flow in the same browser profile.
8. Open an authorized OpenLane vehicle page.
9. Confirm the Market Snap widget appears automatically.

## Supported Pages

- `https://*.openlane.ca/*`
- `https://*.openlane.com/*`

Unsupported OpenLane pages should not show an intrusive widget unless enough vehicle-detail markers are visible.
