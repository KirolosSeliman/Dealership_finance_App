# Dealer Flow / Market Snap OpenLane Extension Prompt

Repository: `KirolosSeliman/Dealership_finance_App`

Scope: `browser-extension/`, Market Snap API routes, Market Snap types/validation, Deal Radar save flow, Market Snap tests, and only the adjacent backend/storage code required for this specific issue.

You are acting as a senior extension engineer, product engineer, security reviewer, QA lead, and launch-readiness judge for Dealer Flow.

Non-negotiable safety rule: this is an authorized visible-page capture extension. Do not implement CAPTCHA bypass, login bypass, anti-bot bypass, proxy evasion, stealth scraping, hidden page crawling, or unauthorized Carfax/paywall extraction. Extract only what the logged-in user can already see on the current OpenLane page.


# 04 — In-Page Market Snap Widget

## Root Problem

Market Snap valuation results are currently rendered in the extension popup, not inside the OpenLane page. The user cannot see retail/wholesale values directly while reviewing or bidding.

## Second-Order Consequences

- Market Snap feels like a separate tool, not an extension.
- User must leave the page context to inspect values.
- The extension does not help at the decision point.
- Popup UI becomes too small for full status, warnings, and save actions.

## Third-Order Consequences

- User experience is slower during auction review.
- Important warnings/missing data may be ignored.
- Save-to-Deal-Radar workflow is disconnected from the page.
- Future in-page decision tools cannot be built cleanly.

## Fourth-Order Consequences

- The product cannot compete with professional dealer/auction assistant tools.
- User trust drops because valuation is not visibly attached to the vehicle page.
- Deployment is incomplete relative to the target product.

## Required Solution

Create a small, professional, isolated in-page Market Snap widget/overlay for OpenLane pages.

## Required Files

Create:

- `browser-extension/src/market-snap-widget.js`
- `browser-extension/styles/widget.css`

## Widget Requirements

The widget must:

- appear on OpenLane vehicle pages automatically
- be compact
- default to top-right or bottom-right
- have collapsed and expanded states
- use Shadow DOM or strong CSS isolation
- not break OpenLane page layout
- not cover critical bid buttons by default
- not create duplicate overlays
- show loading state
- show disconnected/settings state
- show extraction state
- show analyzing state
- show success state
- show error state
- show warnings

## Required Display Fields

In success state, show:

- vehicle title
- VIN if available
- mileage if available
- retail value
- wholesale buy value
- wholesale sell value
- max recommended bid
- estimated total acquisition cost
- potential net profit
- confidence score
- comparable count
- recommendation badge
- warning count
- missing data count
- Carfax available yes/no
- photo count
- video count

## Required Actions

Widget buttons:

1. Refresh analysis
2. Save to Deal Radar
3. Copy extracted JSON
4. Open Dealer Flow Market Snap
5. Open extension settings if disconnected
6. Collapse/expand

## Visual Requirements

- professional dark compact card
- readable on OpenLane page
- no giant modal by default
- no full-screen takeover
- use simple CSS
- avoid external CSS frameworks inside extension
- no heavy dependencies

## State API

Expose a simple widget API such as:

```js
window.DealerFlowMarketSnapWidget = {
  mount(),
  updateState(state),
  showLoading(message),
  showDisconnected(message),
  showExtraction(listing),
  showValuation(listing, valuation),
  showError(message),
  destroy()
}
```

or equivalent module pattern compatible with existing extension scripts.

## Acceptance Criteria

- Widget appears without opening popup.
- Widget renders valuation values.
- Widget handles missing settings.
- Widget handles API errors.
- Widget does not duplicate on DOM changes.
- Widget can collapse and expand.
- Widget Save button connects to extension API client.
- Widget Copy JSON works.
- Widget CSS is isolated enough not to damage OpenLane styles.

## Verification

Manual:

1. Open OpenLane page.
2. Confirm widget appears.
3. Confirm it starts collapsed or compact according to setting.
4. Confirm values appear.
5. Confirm collapse/expand works.
6. Confirm refresh works.
7. Confirm save works.
8. Confirm copy JSON works.
9. Confirm it does not block OpenLane bidding/details buttons.
10. Confirm no duplicate widget after DOM changes.

Automated:

- Add tests or static verification for widget file existence.
- Check required rendered labels exist.
- Check duplicate-prevention logic exists.
- Check required action handlers exist.

Run:

```bash
npm run lint
npm test
npm run build
npm run verify:release
```

## Required Report From Codex

Report:

- widget architecture
- state handling
- fields displayed
- actions implemented
- UX/accessibility choices
- manual verification result

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
