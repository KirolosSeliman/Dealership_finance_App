# Dealer Flow / Market Snap OpenLane Extension Prompt

Repository: `KirolosSeliman/Dealership_finance_App`

Scope: `browser-extension/`, Market Snap API routes, Market Snap types/validation, Deal Radar save flow, Market Snap tests, and only the adjacent backend/storage code required for this specific issue.

You are acting as a senior extension engineer, product engineer, security reviewer, QA lead, and launch-readiness judge for Dealer Flow.

Non-negotiable safety rule: this is an authorized visible-page capture extension. Do not implement CAPTCHA bypass, login bypass, anti-bot bypass, proxy evasion, stealth scraping, hidden page crawling, or unauthorized Carfax/paywall extraction. Extract only what the logged-in user can already see on the current OpenLane page.


# 05 — Extension API Client and Settings

## Root Problem

The current popup directly handles Dealer Flow API calls. There is no reusable extension API client for automatic content-script analysis, widget refresh, save-to-Deal-Radar, and settings validation.

## Second-Order Consequences

- Content script cannot auto-analyze cleanly.
- Widget cannot save to Deal Radar without duplicating fetch logic.
- Error handling stays inconsistent.
- Settings remain too minimal for production extension behavior.

## Third-Order Consequences

- Authentication/session errors are harder to explain.
- Extension behavior cannot be configured safely.
- Debugging OpenLane extraction and API calls becomes messy.
- Auto-analyze cannot be turned off.

## Fourth-Order Consequences

- Deployment support becomes difficult.
- Users cannot reliably configure localhost/staging/production.
- A future production extension store submission would be weak.

## Required Solution

Create a reusable extension API/settings layer.

## Required Files

Create/update:

- `browser-extension/src/storage.js`
- `browser-extension/src/api-client.js`
- `browser-extension/src/options.js`
- `browser-extension/options.html`
- `browser-extension/src/popup.js`
- `browser-extension/popup.html`

## Required Settings

Options page must support:

- Dealer Flow base URL
- Organization ID
- Auto-analyze supported pages: default true
- Widget default collapsed: choose product-friendly default
- Auto-save to Deal Radar: default false
- Include media URLs: default true
- Include raw visible text: default true, capped
- Debug mode: default false

Store settings using Chrome storage.

Do not store:

- Supabase keys
- service-role key
- auth token
- password
- OpenLane credentials
- Carfax credentials

## API Client Requirements

Create functions:

- `getMarketSnapSettings()`
- `saveMarketSnapSettings(settings)`
- `validateMarketSnapSettings(settings)`
- `analyzeListing(listing)`
- `saveListing(listing, valuation)`
- `buildDealerFlowUrl(path)`
- `formatApiError(error, responsePayload)`

API client must:

- call `dealerFlowBaseUrl + /api/market-snap/analyze-listing`
- call `dealerFlowBaseUrl + /api/market-snap/save-listing`
- use `credentials: "include"`
- send JSON
- handle not signed into Dealer Flow
- handle invalid extension origin
- handle missing organization ID
- handle invalid base URL
- handle backend validation errors
- never expose secrets

## Popup Requirements

Popup becomes secondary:

- show connection status
- show current page supported/not supported
- button: analyze current page manually
- button: open settings
- button: open Dealer Flow
- show last result if available
- do not be required for main auto-analysis

## Acceptance Criteria

- Content script/widget uses shared API client.
- Popup uses shared API client.
- Settings are robust.
- Missing settings show clear widget state.
- Invalid backend origin gives clear guidance.
- Auto-save is off by default.
- No secrets are stored.

## Verification

Manual:

1. Open options page.
2. Save localhost Dealer Flow URL.
3. Save deployed Dealer Flow URL.
4. Save invalid URL and confirm validation rejects or warns.
5. Clear organization ID and confirm widget shows disconnected state.
6. Log out of Dealer Flow and confirm authentication error is clear.
7. Log in and confirm analyze/save work.

Automated:

- tests or static checks for settings keys
- tests or static checks that no service key strings are in extension folder
- tests for API client error formatting if possible

Run:

```bash
npm run lint
npm test
npm run build
npm run verify:release
```

## Required Report From Codex

Report:

- settings added
- API client functions added
- popup behavior changed
- security checks
- manual verification result

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
