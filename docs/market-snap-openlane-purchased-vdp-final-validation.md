# Market Snap OpenLane Purchased VDP Final Validation

## Summary

This validation covers the OpenLane purchased VDP fix sequence completed on branch `codex/vehicle-safe-archive`.

Automated validation passes for the extension, extractor, backend validation, fixture regression suite, lint, and production build. The remaining release gate is live Chrome validation in an authenticated OpenLane session, because this environment cannot access the user's logged-in OpenLane pages.

## Purchased VDP Validation

Automated fixtures prove purchased VDP pages with `Order history`, `Sold price`, and `Mark as picked up` classify as purchase outcome pages instead of active listings.

Expected live result:

- `pageType` is `purchase_detail` or `post_sale`.
- `captureKind` is `candidate_outcome` or `verified_outcome`.
- `outcomeConfidence` is `high` or `verified`.
- `soldPriceCandidate`, `buyPriceAuction`, or `finalBidAmount` equals the visible sold price.
- Current bid is not used as an outcome label.
- Transport estimates are not used as listing, sold, or acquisition prices.
- VIN is found from visible DOM, safe attributes, URL fallback, or consent-gated network evidence.
- `readyToCapture` is true when the VIN is valid and the page identity is stable.

Automated coverage:

- `OpenLane classifier treats purchased VDP sold-price panels as purchase details before active listing fallback`
- `OpenLane purchased VDP extracts sold price as outcome and ignores transport estimate as price`
- `OpenLane VDP purchase outcome ignores sidebar text and extracts hero vehicle plus selling price`
- `Phase 8 required OpenLane purchased VDP fixture matrix protects known regressions`

## Active VDP Validation

Automated fixtures prove active VDP pages remain observations.

Expected live result:

- `pageType` is `active_listing`.
- `captureKind` is `observation`.
- `currentBid` equals the visible bid.
- `soldPriceCandidate`, `buyPriceAuction`, and `finalBidAmount` are absent.
- Widget message says current bid is observation-only.

Automated coverage:

- `OpenLane active VDP keeps current bid observational and rejects transport estimate as listed price`
- `OpenLane active offer labels remain observation-only and separate from current bid`
- `Phase 8 fixtures protect active observation and post-sale outcome semantics`

## Outcome Price Validation

Outcome prices now require explicit evidence before they can be accepted as candidate or verified outcome fields.

Backend validation rejects active listing payloads that claim verified outcome prices and rejects candidate outcome prices without evidence.

Automated coverage:

- `Market Snap validation rejects active listing payloads that claim verified outcome prices`
- `Market Snap validation rejects observation payloads that carry outcome price fields`
- `Market Snap validation requires evidence for candidate OpenLane outcome prices`
- `Market Snap validation accepts verified purchased VDP outcome with strong evidence`

## Transport Price Guard Validation

Transport cost and distance are penalized or rejected as vehicle mileage and listing price evidence.

Expected live result:

- Text like `CAD $378 / 211km` remains transport evidence only.
- It does not populate `listedPrice`, `soldPriceCandidate`, `buyPriceAuction`, `finalBidAmount`, or `mileageKm`.
- Widget and Copy JSON include the diagnostic message `Transport estimate ignored as listing price.` when applicable.

Automated coverage:

- `OpenLane mileage resolver chooses odometer over transport distance`
- `Market Snap validation rejects mileage that is evidenced as transport distance`
- `Phase 8 required OpenLane purchased VDP fixture matrix protects known regressions`

## Zone-Scoped Field Validation

The section map now removes ignored sidebar, footer, and market-guide text before building trusted non-ignored marker zones. This prevents nearby sidebar text such as `Lane A` from polluting trusted vehicle/business fields.

Expected live result:

- Q&A text does not populate `engine` or `transmission`.
- Sidebar/footer/market-guide text does not populate `sellerName`, `auctionStatus`, `lane`, or `stockNumber`.
- Actual vehicle specs and business fields remain available when present in trusted zones.

Automated coverage:

- `OpenLane canonical fields ignore Q&A sidebar footer market-guide and transport noise`
- `OpenLane valid vehicle specs still populate canonical specs from trusted zones`
- `OpenLane section map isolates noisy English VDP regions`
- `OpenLane section map isolates noisy French VDP regions`
- `Phase 8 required OpenLane purchased VDP fixture matrix protects known regressions`

## Condition Cleanup Validation

Condition extraction keeps real disclosure, announcement, dealer note, and known-history text while excluding Q&A, navigation, legal footer, market-guide, and transport bleed.

Expected live result:

- `conditionReportText`, `damageAnnouncements`, `mechanicalAnnouncements`, and `interiorAnnouncements` contain vehicle condition evidence only.
- Q&A questions and market-guide text are absent from canonical condition fields.

Automated coverage:

- `OpenLane condition disclosure cleanup removes navigation legal transport and Q&A bleed`
- `OpenLane extractor structures bilingual condition disclosures and dealer notes`
- `OpenLane extractor captures condition reports and missing data`

## Carfax Diagnostics Validation

CARFAX extraction is truth-preserving.

Expected live result:

- `carfaxUrlStatus = "url_found"` only when a real URL is visible in DOM, safe attributes, router metadata, or consent-gated allowed network JSON.
- `carfaxUrlStatus = "text_only"` when the page only exposes visible CARFAX text/button text.
- The extension does not fetch paid CARFAX content.
- Widget and Copy JSON show candidate counts for link, data-href, data-url, HTML zone, safe attributes, network, and text-only evidence.

Automated coverage:

- `OpenLane CARFAX resolver extracts relative and data URL metadata without fetching reports`
- `OpenLane CARFAX status is explicit for button text and missing pages`
- `OpenLane network CARFAX candidate normalizes status and evidence after Deep Capture merge`
- `Phase 8 fixtures protect CARFAX URL, text-only, missing, and network evidence paths`

## Network Observer Validation

The extension now injects a minimal OpenLane page hook at `document_start` and replays a bounded early queue into the main consent-gated observer.

Expected live result:

- Deep Capture/network observation starts only when the runtime activation rules allow it.
- Allowed vehicle/listing JSON can contribute VIN, CARFAX, media, mileage, bid, seller, location, and condition candidates.
- Auth/session/profile/payment/user/token endpoints are ignored.
- Headers, cookies, authorization values, credentials, tokens, passwords, and sessions are not captured.
- Widget says `Network observer enabled but no vehicle JSON observed yet` when observation is active but no allowed vehicle JSON has been seen.

Automated coverage:

- `OpenLane early network hook is injection-only and keeps extraction in the main observer`
- `OpenLane network observer flushes early page hook queue when active and clears it when stopped`
- `OpenLane network observer ignores duplicate page-hook replay events`
- `OpenLane network observer ignores irrelevant and auth/session endpoints`
- `OpenLane network observer redacts token, cookie, email, and phone values`
- `OpenLane network observer creates structured candidates for vehicle JSON`

## Backend Validation

Backend validation protects Deal Radar, market listings, and training data.

Verified behavior:

- Save payloads omit `valuation` when it is null or undefined.
- Backend accepts missing/null valuation defensively and recomputes valuation during save.
- Observation payloads cannot carry outcome labels.
- Candidate outcome prices require evidence.
- Active bids remain observation-only.
- OpenLane verified outcomes require evidence and model-improvement opt-in before training eligibility.
- Invalid VINs and transport-distance mileage are rejected or omitted safely.

Automated coverage:

- `extension saveListing omits valuation when widget has no valuation yet`
- `Deal Radar save payload requires an organization and a listing object`
- `OpenLane capture storage writes active listing observations separately from outcomes`
- `OpenLane verified outcomes require model-improvement opt-in before training eligibility`
- `OpenLane training export excludes active bids and pending outcomes from labels`

## Commands Run

Final automated validation on May 19, 2026:

- `npm.cmd run verify:extension` - passed, 85/85 extension tests.
- `npm.cmd test` - passed, 278/278 tests.
- `npm.cmd run lint` - passed.
- `npm.cmd run build` - passed, Next.js production build completed.

`vercel build` was not run because no deployment configuration changed in this phase.

## Manual Browser Results

Not executed in this environment. This sandbox does not have access to the user's authenticated Chrome/OpenLane session.

Manual validation required before production release:

1. Open `chrome://extensions`.
2. Reload the unpacked Dealer Flow Market Snap extension.
3. Open Dealer Flow in the same Chrome profile and confirm login.
4. Open extension settings.
5. Confirm Dealer Flow URL.
6. Confirm Organization ID.
7. Configure Auto-analyze on, Capture observations/outcomes on, Auto-save off, Deep Capture on/default active, Observe page network data on, Include media URLs on, Include raw text on, Debug mode on, Model improvement opt-in off.
8. Open a real purchased OpenLane VDP showing `Order history`, `Sold price`, and `Mark as picked up`.
9. Confirm purchased page classification, outcome confidence, sold price extraction, valid VIN, ignored transport estimate, truthful CARFAX state, and clean fields in Copy JSON.
10. Open a real active OpenLane VDP showing current bid/floor set.
11. Confirm active listing classification, observation capture kind, current bid observation-only warning, and no outcome price fields.
12. Click Save on an active listing and confirm Deal Radar entry.
13. Save a purchased page only if backend validation allows it, then confirm outcome semantics and evidence.
14. Navigate from one VDP to another without full reload and confirm extraction refreshes.

## Remaining Risks

- Live OpenLane DOM and network shapes may differ from fixtures. The final release remains `No-Go` until authenticated Chrome validation confirms purchased and active pages behave as expected.
- If OpenLane changes endpoint paths or JSON shape, network evidence may stay at zero; the widget now exposes that state but manual verification is still required.
- If a purchased VDP lacks a valid VIN in visible/authorized evidence, the extension should remain preview-only rather than saving bad data.
- GitHub reports two moderate Dependabot vulnerabilities on the default branch; they are outside this OpenLane fix branch scope and should be triaged separately.

## Rollback Plan

Rollback is branch-safe and can be performed by reverting the OpenLane purchased VDP fix commits on `codex/vehicle-safe-archive`.

Lowest-risk rollback order:

1. Revert widget/debug-only commit `896df77` if the debug UX causes extension display issues.
2. Revert Phase 8 fixture/section-map commit `c82b325` only if section-map behavior regresses live extraction.
3. Revert earlier extraction/classification/network/backend validation commits only if the specific phase is identified as the failing change.

Do not roll back backend validation gates unless the replacement keeps active bids out of training labels and prevents dirty outcome prices from being saved.

## Final Go/No-Go

Automated release gate: Go.

Live production release gate: No-Go until manual Chrome/OpenLane validation is completed in the authenticated user session and confirms:

- live purchased VDP classification,
- live active VDP classification,
- correct sold price extraction,
- clean field scoping,
- truthful CARFAX status,
- safe Save to Deal Radar behavior.
