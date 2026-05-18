# Dealer Flow / Market Snap OpenLane Extension Prompt

Repository: `KirolosSeliman/Dealership_finance_App`

Scope: `browser-extension/`, Market Snap API routes, Market Snap types/validation, Deal Radar save flow, Market Snap tests, and only the adjacent backend/storage code required for this specific issue.

You are acting as a senior extension engineer, product engineer, security reviewer, QA lead, and launch-readiness judge for Dealer Flow.

Non-negotiable safety rule: this is an authorized visible-page capture extension. Do not implement CAPTCHA bypass, login bypass, anti-bot bypass, proxy evasion, stealth scraping, hidden page crawling, or unauthorized Carfax/paywall extraction. Extract only what the logged-in user can already see on the current OpenLane page.


# 02 — OpenLane-Specific Extractor

## Root Problem

OpenLane currently uses a generic text extractor. It guesses title, price, mileage, year, make/model, and image count from `document.body.innerText`. This is not sufficient for OpenLane auction pages.

## Second-Order Consequences

- VIN is not reliably extracted.
- Carfax link is not extracted.
- Photos and videos are not extracted as URLs.
- Current bid, buy-now price, reserve, fees, run number, lane, lot, stock, seller, location, declarations, and condition data are missed.
- Market Snap receives weak input and produces weak valuation.

## Third-Order Consequences

- Retail and wholesale values may be based on incomplete or wrong vehicle identity.
- Confidence score and missing-data warnings are less meaningful.
- Deal Radar saved listings lack useful OpenLane metadata.
- OpenLane pages with dynamic layouts may silently produce bad outputs.

## Fourth-Order Consequences

- User trust drops because values appear disconnected from the real page.
- Extension cannot become a reliable buying assistant.
- Future ML/calibration data becomes low quality because extraction data is incomplete.

## Required Solution

Create a dedicated OpenLane extractor that reads structured visible OpenLane page data safely, with resilient fallback logic.

## Required File

Create or replace:

`browser-extension/src/openlane-extractor.js`

Do not cram this logic into `connectors.js`.

## Required Extracted Output Shape

Return an object compatible with current Market Snap plus richer OpenLane metadata:

```js
{
  sourceName: "OpenLane",
  sourceType: "auction",
  marketType: "auction_market",
  listingUrl,
  capturedAt,
  title,
  year,
  make,
  model,
  trim,
  vin,
  mileageKm,
  exteriorColor,
  interiorColor,
  drivetrain,
  transmission,
  engine,
  fuelType,
  bodyStyle,
  doors,
  cylinders,
  location,
  province,
  sellerName,
  sellerType,
  auctionStatus,
  saleDate,
  runNumber,
  lane,
  lotNumber,
  stockNumber,
  listedPrice,
  currentBid,
  buyNowPrice,
  reservePrice,
  estimatedAuctionFees,
  titleStatus,
  declarations,
  conditionReportText,
  damageAnnouncements,
  mechanicalAnnouncements,
  structuralAnnouncements,
  odometerAnnouncements,
  tireCondition,
  keysAvailable,
  carfaxUrl,
  carfaxAvailable,
  photos,
  videos,
  imageCount,
  videoCount,
  description,
  rawVisibleText,
  extractedFields,
  missingData,
  warnings,
  extractionConfidenceScore
}
```

## Photo Object Shape

```js
{
  url,
  thumbnailUrl,
  alt,
  width,
  height,
  source
}
```

Allowed `source` values:

```js
"img" | "srcset" | "picture" | "background-image" | "link"
```

## Video Object Shape

```js
{
  url,
  posterUrl,
  title,
  type,
  source
}
```

Allowed `source` values:

```js
"video" | "source" | "iframe" | "link"
```

## Extraction Strategy

Implement layered extraction:

1. Structured selectors:
   - `h1`
   - detail tables
   - label/value pairs
   - definition lists
   - cards
   - vehicle specification sections
   - condition report sections
   - auction information sections
   - gallery/media containers

2. Label/value fallback:
   - scan visible text
   - normalize labels
   - parse values near labels such as VIN, Odometer, Mileage, Transmission, Engine, Exterior, Interior, Location, Seller, Run, Lane, Lot, Stock

3. Link extraction:
   - find anchors containing Carfax, Vehicle History, History Report, CarProof
   - return visible/authorized URL only

4. Media extraction:
   - `img.src`
   - `img.srcset`
   - `picture source[srcset]`
   - CSS `background-image`
   - links to image files
   - `video[src]`
   - `source[src]`
   - iframe video URLs
   - links to video files

5. Dedupe all URLs.
6. Normalize relative URLs to absolute URLs.
7. Do not download media by default.
8. Cap `rawVisibleText` to a safe length, such as 12,000 characters.
9. Return `missingData` instead of inventing values.
10. Return `warnings` when confidence is low.

## Required Helper Functions

Implement reusable helpers:

- `extractOpenLaneListing()`
- `isOpenLaneVehiclePage()`
- `extractVisibleText()`
- `extractLabelValueMap()`
- `extractMoneyByLabels(labels)`
- `extractMileage()`
- `extractVin()`
- `extractYearMakeModelTrim()`
- `extractCarfaxLink()`
- `extractPhotos()`
- `extractVideos()`
- `normalizeAbsoluteUrl(url)`
- `dedupeMedia(items)`
- `calculateExtractionConfidence(listing)`
- `buildMissingData(listing)`

## Safety Requirements

- Do not bypass Carfax access.
- Do not open hidden Carfax pages.
- Do not crawl every image link recursively.
- Do not fetch unrelated pages.
- Do not use automation to bypass OpenLane controls.
- Extract only current DOM-visible data and URLs.

## Acceptance Criteria

- Dedicated OpenLane extractor exists.
- VIN extraction works from label/value text and visible page text.
- Carfax visible link is extracted.
- Photo URLs are extracted and deduped.
- Video URLs are extracted when visible.
- `currentBid` and `buyNowPrice` are separated when possible.
- `conditionReportText` captures condition/declaration sections when visible.
- Missing data is explicit.
- Extraction confidence score exists.
- Generic extractor remains available for non-OpenLane pages.

## Verification

Manual verification:

1. Open a real authorized OpenLane vehicle page.
2. Run extractor in page console or via content script debug.
3. Confirm extracted JSON includes title, VIN, mileage, price/bid, Carfax if visible, photo count, and media URLs.
4. Confirm missing data is explicit, not silently absent.

Run:

```bash
npm run lint
npm test
npm run build
npm run verify:release
```

## Required Report From Codex

Report:

- exact OpenLane fields now extracted
- fallback logic used
- known selectors/label patterns supported
- media extraction strategy
- safety guardrails
- what still depends on real OpenLane page layout

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
