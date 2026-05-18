# Dealer Flow / Market Snap OpenLane Extension Prompt

Repository: `KirolosSeliman/Dealership_finance_App`

Scope: `browser-extension/`, Market Snap API routes, Market Snap types/validation, Deal Radar save flow, Market Snap tests, and only the adjacent backend/storage code required for this specific issue.

You are acting as a senior extension engineer, product engineer, security reviewer, QA lead, and launch-readiness judge for Dealer Flow.

Non-negotiable safety rule: this is an authorized visible-page capture extension. Do not implement CAPTCHA bypass, login bypass, anti-bot bypass, proxy evasion, stealth scraping, hidden page crawling, or unauthorized Carfax/paywall extraction. Extract only what the logged-in user can already see on the current OpenLane page.


# 06 — Backend Support for Rich OpenLane Payload

## Root Problem

The backend Market Snap payload currently accepts a limited listing shape. It does not explicitly support rich OpenLane fields such as VIN, Carfax URL, photos, videos, current bid, buy-now price, run/lane/lot, declarations, seller name, and OpenLane metadata.

## Second-Order Consequences

- Even if the extension extracts rich data, validation may reject or drop it.
- Useful OpenLane data may not reach the valuation engine.
- Useful data may not be saved to Deal Radar.
- Media and Carfax metadata may be lost.

## Third-Order Consequences

- Retail/wholesale estimates cannot benefit from better source data.
- Deal Radar becomes less useful.
- Future calibration and ML training receive incomplete data.
- Debugging extraction quality becomes hard because backend discards context.

## Fourth-Order Consequences

- The extension looks advanced but backend remains shallow.
- Deployable extension cannot preserve the value of extraction.
- The product cannot scale toward serious auction intelligence.

## Required Solution

Extend Market Snap backend types, validation, normalization, repository persistence, and valuation input support for rich OpenLane visible-page payloads.

## Files to Inspect

- `src/types/market-snap.ts`
- `src/lib/market-snap/validation.ts`
- `src/lib/market-snap/engine.ts`
- `src/lib/market-snap/repository.ts`
- `src/lib/server/market-snap-api.ts`
- `src/app/api/market-snap/analyze-listing/route.ts`
- `src/app/api/market-snap/save-listing/route.ts`
- relevant Supabase Market Snap migrations

## Required Type Additions

Extend `MarketListingInput` safely with optional fields:

```ts
vin?: string;
currentBid?: number;
buyNowPrice?: number;
reservePrice?: number;
estimatedAuctionFees?: number;
exteriorColor?: string;
interiorColor?: string;
drivetrain?: string;
transmission?: string;
engine?: string;
fuelType?: string;
bodyStyle?: string;
doors?: number;
cylinders?: number;
sellerName?: string;
auctionStatus?: string;
saleDate?: string;
runNumber?: string;
lane?: string;
lotNumber?: string;
stockNumber?: string;
declarations?: string[];
damageAnnouncements?: string[];
mechanicalAnnouncements?: string[];
structuralAnnouncements?: string[];
odometerAnnouncements?: string[];
tireCondition?: string;
keysAvailable?: boolean;
carfaxUrl?: string;
carfaxAvailable?: boolean;
photos?: MarketListingPhoto[];
videos?: MarketListingVideo[];
videoCount?: number;
rawVisibleText?: string;
openlaneMetadata?: Record<string, unknown>;
extractedFields?: Record<string, unknown>;
extractionConfidenceScore?: number;
```

Add `MarketListingPhoto` and `MarketListingVideo` types.

## Validation Requirements

Update Zod validation:

- VIN optional, normalized uppercase, max length, valid characters
- URL arrays capped
- photos capped, such as max 200
- videos capped, such as max 50
- declarations/announcements capped
- rawVisibleText capped, such as 12,000 chars
- openlaneMetadata accepted but bounded if possible
- no base64 blobs in media URLs
- reject non-http/https media URLs unless relative URLs were normalized by extension

## Valuation Requirements

- Use `buyNowPrice`, `currentBid`, or `listedPrice` as price source in a clear priority.
- Feed condition report + declarations + announcements into risk/condition text.
- Use Carfax availability as metadata/warning/confidence context, not as proof of clean history.
- Use `photos.length` and `videoCount` for image/media data quality.
- Preserve existing guardrails:
  - no comparables = low confidence
  - low comparables = confidence cap
  - CatBoost candidate-only unless actually promoted

## Persistence Requirements

Safely persist rich data.

Preferred:
- Keep normalized common fields in existing columns.
- Store rich OpenLane-specific data in `normalized_payload` or `openlane_metadata` JSON.
- If DB migration is necessary, add:
  - `vin`
  - `carfax_url`
  - `carfax_available`
  - `photos_json`
  - `videos_json`
  - `openlane_metadata`
  - `extraction_confidence_score`
  - `extraction_warnings`

Do not destructively change existing Market Snap tables.

## Acceptance Criteria

- Analyze API accepts rich OpenLane payload.
- Save API accepts rich OpenLane payload.
- Existing dashboard Market Snap still works.
- Existing import flows still work.
- OpenLane photos/videos/Carfax are not dropped.
- Valuation uses richer price/condition/media data where appropriate.
- Validation rejects oversized/unsafe payloads.

## Verification

Automated tests:

- rich OpenLane payload accepted
- unsafe media URL rejected
- oversized raw text rejected or truncated
- Carfax URL preserved
- photos/videos preserved
- no comparables guardrails still apply
- existing generic listing still accepted

Run:

```bash
npm run lint
npm test
npm run build
npm run verify:release
```

## Required Report From Codex

Report:

- type changes
- validation changes
- valuation changes
- persistence strategy
- migration changes if any
- compatibility with existing flows
- verification results

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
