# Dealer Flow / Market Snap OpenLane Extension Prompt

Repository: `KirolosSeliman/Dealership_finance_App`

Scope: `browser-extension/`, Market Snap API routes, Market Snap types/validation, Deal Radar save flow, Market Snap tests, and only the adjacent backend/storage code required for this specific issue.

You are acting as a senior extension engineer, product engineer, security reviewer, QA lead, and launch-readiness judge for Dealer Flow.

Non-negotiable safety rule: this is an authorized visible-page capture extension. Do not implement CAPTCHA bypass, login bypass, anti-bot bypass, proxy evasion, stealth scraping, hidden page crawling, or unauthorized Carfax/paywall extraction. Extract only what the logged-in user can already see on the current OpenLane page.


# 07 — Deal Radar Persistence for Carfax, Photos, Videos, and OpenLane Metadata

## Root Problem

Even if rich OpenLane data is extracted and analyzed, Deal Radar may not preserve enough of it to make saved listings useful later.

## Second-Order Consequences

- Saved listings may lose Carfax link.
- Saved listings may lose media URLs.
- Saved listings may lose OpenLane auction metadata.
- User cannot revisit why a valuation was made.
- Future ML/calibration receives weaker saved data.

## Third-Order Consequences

- Deal Radar becomes a simple valuation bookmark instead of a useful deal-analysis database.
- User must reopen OpenLane to re-check the same information.
- Saved valuation snapshots lack context for audit and learning.

## Fourth-Order Consequences

- Market Snap cannot become a serious dealer workflow.
- The extension’s extraction work is wasted after save.
- Future features like image analysis, re-training, or comparison charts have poor data foundation.

## Required Solution

Ensure save-to-Deal-Radar preserves the important OpenLane extraction metadata efficiently and safely.

## Files to Inspect

- `src/lib/market-snap/repository.ts`
- `src/types/market-snap.ts`
- `src/lib/market-snap/validation.ts`
- `src/lib/server/market-snap-api.ts`
- Supabase migrations for:
  - `market_listings`
  - `deal_radar_saved_listings`
  - `vehicle_valuations`

## Required Persistence Behavior

When user saves OpenLane listing, preserve:

- Carfax URL
- Carfax availability
- photos metadata
- videos metadata
- VIN
- current bid
- buy-now price
- auction run/lane/lot/stock
- sale date/time if visible
- location/province
- seller name/type
- declarations
- condition report text
- damage/mechanical/structural/odometer announcements
- extraction confidence
- extraction warnings
- missing data
- valuation snapshot

Do not store:

- huge raw HTML
- base64 media
- private credentials
- hidden user/session tokens
- unauthorized Carfax report content

## Data Model Strategy

Prefer a hybrid storage strategy:

1. Existing common columns:
   - title
   - year/make/model/trim
   - mileage
   - price
   - location
   - market type

2. JSON payload:
   - `openlaneMetadata`
   - `photos`
   - `videos`
   - `carfax`
   - extraction context

3. Capped text:
   - `conditionReportText`
   - `rawVisibleText`, only if explicitly enabled and capped

If migration is needed, make it safe and additive.

## UI Requirements

Deal Radar page should surface at least:

- Carfax available indicator
- photo count
- video count
- confidence
- comparable count
- warnings count
- recommendation
- Open listing link

Do not overload the table. Put detailed metadata in a detail drawer/modal or existing detail view if one exists.

## Acceptance Criteria

- Save to Deal Radar keeps Carfax URL.
- Save to Deal Radar keeps photos/videos metadata.
- Saved valuation snapshot still includes confidence/warnings/missing data.
- No huge payloads are stored accidentally.
- Existing Deal Radar rows still load.
- Existing Market Snap dashboard still works.

## Verification

Tests:

- save listing with Carfax/media payload
- verify repository preserves metadata
- verify validation caps media arrays
- verify unsafe URLs rejected
- verify existing saved listing without media still renders

Manual:

1. Open OpenLane page with visible Carfax and media.
2. Widget analyzes.
3. Click Save to Deal Radar.
4. Open Deal Radar in Dealer Flow.
5. Confirm saved listing has Carfax/media indicators and valuation snapshot.
6. Confirm no broken UI for older rows.

Run:

```bash
npm run lint
npm test
npm run build
npm run verify:release
```

## Required Report From Codex

Report:

- metadata preserved
- DB changes
- UI changes
- old-row compatibility
- tests added
- manual verification

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
