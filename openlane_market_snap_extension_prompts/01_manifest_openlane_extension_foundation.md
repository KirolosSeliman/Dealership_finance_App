# Dealer Flow / Market Snap OpenLane Extension Prompt

Repository: `KirolosSeliman/Dealership_finance_App`

Scope: `browser-extension/`, Market Snap API routes, Market Snap types/validation, Deal Radar save flow, Market Snap tests, and only the adjacent backend/storage code required for this specific issue.

You are acting as a senior extension engineer, product engineer, security reviewer, QA lead, and launch-readiness judge for Dealer Flow.

Non-negotiable safety rule: this is an authorized visible-page capture extension. Do not implement CAPTCHA bypass, login bypass, anti-bot bypass, proxy evasion, stealth scraping, hidden page crawling, or unauthorized Carfax/paywall extraction. Extract only what the logged-in user can already see on the current OpenLane page.


# 01 — Manifest and Extension Foundation

## Root Problem

The current Manifest V3 extension is still configured like a popup-triggered demo, not a deployable OpenLane in-page assistant.

The manifest currently centers around `popup.html`, uses generic content scripts, and does not provide the required module structure for a real OpenLane overlay runtime.

## Second-Order Consequences

- The extension cannot run as an automatic Market Snap assistant on OpenLane pages.
- The extension does not load a dedicated OpenLane extractor.
- The extension does not load an API client module.
- The extension does not load an in-page widget renderer.
- OpenLane Canada may not be covered if `*.openlane.ca/*` is missing.

## Third-Order Consequences

- The user must manually open the popup and click analyze.
- OpenLane vehicle pages cannot show retail/wholesale values directly.
- Future code will keep being forced into the popup and generic connector files.
- The extension cannot become maintainable as Market Snap grows.

## Fourth-Order Consequences

- Market Snap remains perceived as “not a real extension.”
- OpenLane extraction stays fragile.
- Deployment review fails because the extension architecture does not match the product requirement.
- Future support for OpenLane layouts, media, Carfax, and auto-analysis becomes messy.

## Required Solution

Refactor the extension foundation so it can support a real OpenLane in-page runtime while preserving the existing popup as a settings/status fallback.

## Required Actions

1. Inspect the actual current files:
   - `browser-extension/manifest.json`
   - `browser-extension/popup.html`
   - `browser-extension/options.html`
   - `browser-extension/src/popup.js`
   - `browser-extension/src/options.js`
   - `browser-extension/src/content-script.js`
   - `browser-extension/src/connectors.js`

2. Update `browser-extension/manifest.json`:
   - include `https://*.openlane.ca/*`
   - include `https://*.openlane.com/*`
   - keep existing supported domains unless deliberately moving them into legacy flow
   - include only necessary permissions
   - keep `storage`
   - keep `activeTab` only if popup manual extraction still needs it
   - keep `scripting` only if still needed
   - avoid broad permissions such as `<all_urls>` or unnecessary `tabs`

3. Add new extension files:
   - `browser-extension/src/storage.js`
   - `browser-extension/src/api-client.js`
   - `browser-extension/src/openlane-extractor.js`
   - `browser-extension/src/market-snap-widget.js`
   - `browser-extension/styles/widget.css`

4. Update content scripts to load in this safe order:
   - `src/storage.js`
   - `src/api-client.js`
   - `src/openlane-extractor.js`
   - `src/market-snap-widget.js`
   - `src/connectors.js` if still needed for non-OpenLane legacy support
   - `src/content-script.js`

5. Keep `popup.html` and `popup.js`, but prepare them to become secondary:
   - settings/status
   - manual analyze fallback
   - open Dealer Flow
   - open options

6. Update `browser-extension/README.md`:
   - explain unpacked installation
   - explain OpenLane supported domains
   - explain required Dealer Flow session
   - explain the extension captures only visible authorized page data
   - explain no CAPTCHA/login/paywall bypass

## Security Requirements

- Do not add hidden background scraping.
- Do not request excessive permissions.
- Do not embed credentials.
- Do not scrape outside the current visible user page.
- Do not bypass OpenLane or Carfax access controls.

## Acceptance Criteria

- Manifest includes OpenLane `.ca` and `.com`.
- Extension file structure supports in-page runtime.
- Existing popup still opens.
- Content scripts load without reference errors.
- No duplicate broad permissions are introduced.
- Extension can be loaded unpacked in Chrome/Brave.
- Existing non-OpenLane popup flow does not break unless intentionally marked legacy.

## Verification

Run:

```bash
npm run lint
npm test
npm run build
npm run verify:release
```

Manual verification:

1. Load extension unpacked in Chrome.
2. Load extension unpacked in Brave.
3. Confirm extension is allowed on OpenLane `.ca` and `.com`.
4. Confirm extension options page opens.
5. Confirm popup still opens.
6. Confirm no errors appear in extension service worker/content-script console.

## Required Report From Codex

After completing this file, report:

- root problem fixed
- manifest changes
- new files added
- permissions kept/removed and why
- manual load result
- lint/test/build results
- remaining risks

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
