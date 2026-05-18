# Dealer Flow / Market Snap OpenLane Extension Prompt

Repository: `KirolosSeliman/Dealership_finance_App`

Scope: `browser-extension/`, Market Snap API routes, Market Snap types/validation, Deal Radar save flow, Market Snap tests, and only the adjacent backend/storage code required for this specific issue.

You are acting as a senior extension engineer, product engineer, security reviewer, QA lead, and launch-readiness judge for Dealer Flow.

Non-negotiable safety rule: this is an authorized visible-page capture extension. Do not implement CAPTCHA bypass, login bypass, anti-bot bypass, proxy evasion, stealth scraping, hidden page crawling, or unauthorized Carfax/paywall extraction. Extract only what the logged-in user can already see on the current OpenLane page.


# 09 — Release Packaging and Manual Verification for OpenLane Extension

## Root Problem

Even if code is implemented, the extension is not deployable until there are clear packaging instructions, local install instructions, runtime configuration steps, and manual verification procedures.

## Second-Order Consequences

- User cannot confidently load/test the extension.
- Chrome/Brave differences may go unnoticed.
- OpenLane real-page behavior may not match fixtures.
- Dealer Flow auth/session issues may be misdiagnosed as extraction bugs.

## Third-Order Consequences

- Extension appears broken even if code is mostly correct.
- Deployment cannot be repeated.
- No one knows how to verify a release candidate.

## Fourth-Order Consequences

- Market Snap remains stuck as “developer only.”
- Private beta fails.
- Official launch cannot be approved.

## Required Solution

Make the OpenLane extension deployable as an unpacked Chrome/Brave extension with clear packaging, setup, and manual verification documentation.

## Required Docs

Update/create:

- `browser-extension/README.md`
- `docs/release-checklist.md`
- optionally `docs/market-snap-extension.md`

## Required README Sections

Include:

1. What the extension does
2. Supported pages:
   - OpenLane `.ca`
   - OpenLane `.com`
3. What it does not do:
   - no CAPTCHA bypass
   - no login bypass
   - no hidden scraping
   - no Carfax paywall bypass
4. Installation in Chrome:
   - open `chrome://extensions`
   - enable Developer mode
   - Load unpacked
   - select `browser-extension/`
5. Installation in Brave:
   - open `brave://extensions`
   - enable Developer mode
   - Load unpacked
6. Required Dealer Flow setup:
   - deploy or run Dealer Flow
   - log into Dealer Flow in same browser profile
   - set Dealer Flow base URL
   - set organization ID
7. OpenLane usage:
   - log into OpenLane
   - open vehicle detail page
   - wait for Market Snap widget
   - review values
   - save to Deal Radar
8. Troubleshooting:
   - widget not appearing
   - not authenticated
   - invalid extension origin
   - organization missing
   - no comparables
   - missing Carfax
   - photos/videos not visible
   - OpenLane page not supported
9. Privacy/security:
   - captures visible page data only
   - sends to user’s configured Dealer Flow backend only
   - no secrets stored
10. Release checklist

## Optional Build/Packaging Script

If the extension does not require compilation, document that no build step is required.

If adding a package script is useful, add something simple like:

```json
"verify:extension": "npm test -- tests/browser-extension.test.ts tests/openlane-extractor.test.ts"
```

Only add if compatible with existing script patterns.

## Manual Verification Checklist

The final documentation must include these steps:

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

## Acceptance Criteria

- Extension can be loaded unpacked without errors.
- Documentation explains installation and usage.
- Release checklist includes OpenLane extension checks.
- Tests and build pass.
- Remaining risks are documented.
- User can follow docs without guessing.

## Verification

Run:

```bash
npm run lint
npm test
npm run build
npm run verify:release
```

Manual verification must be documented in final Codex response.

## Required Report From Codex

Report:

- packaging state
- install instructions
- manual verification performed
- Chrome result
- Brave result
- OpenLane `.ca` result
- OpenLane `.com` result if available
- remaining deployment blockers

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
