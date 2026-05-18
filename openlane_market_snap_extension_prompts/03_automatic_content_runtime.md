# Dealer Flow / Market Snap OpenLane Extension Prompt

Repository: `KirolosSeliman/Dealership_finance_App`

Scope: `browser-extension/`, Market Snap API routes, Market Snap types/validation, Deal Radar save flow, Market Snap tests, and only the adjacent backend/storage code required for this specific issue.

You are acting as a senior extension engineer, product engineer, security reviewer, QA lead, and launch-readiness judge for Dealer Flow.

Non-negotiable safety rule: this is an authorized visible-page capture extension. Do not implement CAPTCHA bypass, login bypass, anti-bot bypass, proxy evasion, stealth scraping, hidden page crawling, or unauthorized Carfax/paywall extraction. Extract only what the logged-in user can already see on the current OpenLane page.


# 03 — Automatic Content-Script Runtime

## Root Problem

The current content script is passive. It only responds to a popup message. It does not automatically detect OpenLane vehicle pages, extract data, call Dealer Flow, or update UI.

## Second-Order Consequences

- User must manually open popup and click Analyze.
- Market Snap does not feel like a real extension.
- Values are not available at the moment of decision on the OpenLane page.
- Extension cannot react to dynamic OpenLane page loading.

## Third-Order Consequences

- Extraction may happen too early or too late.
- Dynamic single-page OpenLane navigation can break the flow.
- API calls cannot be debounced or controlled centrally.
- Popup becomes overloaded with product logic.

## Fourth-Order Consequences

- The extension cannot be deployed as a useful auction workflow tool.
- The user has to leave their bidding context to evaluate a car.
- Future overlay/widget work remains disconnected from extraction.

## Required Solution

Turn `browser-extension/src/content-script.js` into the OpenLane extension runtime.

It must automatically detect, extract, analyze, and update the widget.

## Required Runtime Flow

On supported OpenLane pages:

```text
page loads
→ content script initializes once
→ detect supported OpenLane vehicle detail page
→ inject widget in loading state
→ wait until vehicle data is visible
→ extract OpenLane listing
→ call Dealer Flow analyze API
→ update widget with valuation
→ allow refresh/save/copy/open actions
→ observe DOM/URL changes
→ re-run extraction only when meaningful page changes happen
```

## Required Implementation Details

1. Add initialization guard:
   - prevent multiple runtimes from being created
   - prevent duplicate widgets

2. Add page detection:
   - host includes `openlane.ca` or `openlane.com`
   - page contains enough vehicle markers
   - do not run aggressively on non-vehicle pages

3. Add content readiness:
   - wait for body
   - wait for likely vehicle data
   - retry a few times with capped timeout

4. Add MutationObserver:
   - observe body subtree
   - debounce changes
   - detect URL changes
   - avoid API spam

5. Add extraction state:
   - idle
   - detecting
   - extracting
   - analyzing
   - success
   - warning
   - error
   - disconnected

6. Add API call:
   - read settings from extension storage
   - if Dealer Flow URL or org ID missing, show disconnected widget
   - call analyze API only after extraction has minimum required vehicle identity

7. Add manual refresh:
   - user can click Refresh in widget
   - refresh re-extracts and re-analyzes

8. Preserve popup fallback:
   - popup message `MARKET_SNAP_EXTRACT` can still return current extraction
   - do not break existing manual flow

## Debounce Requirements

- Do not call the backend for every DOM mutation.
- Use debounce window around 1–2 seconds.
- Avoid repeated API calls if extracted VIN/listing URL did not change.
- Add a maximum auto-analyze retry count.

## Acceptance Criteria

- Opening OpenLane vehicle page triggers extraction without popup.
- Widget enters loading/analyzing state automatically.
- API call is made automatically only when settings are configured.
- Missing settings produce a clear disconnected state.
- DOM changes do not create duplicate widgets.
- Dynamic route changes re-run extraction safely.
- Existing popup manual extraction still works.

## Verification

Manual verification:

1. Load extension unpacked.
2. Configure Dealer Flow base URL and organization ID.
3. Open OpenLane page.
4. Do not click popup.
5. Confirm widget appears.
6. Confirm extraction starts.
7. Confirm values appear after backend response.
8. Confirm refreshing the OpenLane page still works.
9. Confirm navigating to another OpenLane vehicle updates extraction.
10. Confirm unsupported OpenLane pages do not get intrusive overlay.

Run:

```bash
npm run lint
npm test
npm run build
npm run verify:release
```

## Required Report From Codex

Report:

- runtime lifecycle implemented
- auto-detection logic
- debounce/retry strategy
- how duplicate widgets are prevented
- how popup compatibility is preserved
- manual verification result

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
