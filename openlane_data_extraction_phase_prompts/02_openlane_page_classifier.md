# Phase 2 — OpenLane Page Classifier

## /goal

Build a reliable classifier that identifies what kind of OpenLane page the user opened before extraction/storage decisions are made.

## Codex Role

You are a senior data analyst, senior data engineer, senior software engineer, browser-extension engineer, database engineer, security reviewer, and production launch judge for Dealer Flow / Market Snap.

Repository: `KirolosSeliman/Dealership_finance_App`

Dealer Flow handles dealer inventory, OpenLane captures, purchase outcomes, valuation estimates, tax-sensitive financial flows, and future ML training data. Treat this as a real production system.

## Hard Rules

- Work only on this phase.
- Inspect the real repo before editing.
- Identify the root cause before writing code.
- Capture only visible data from pages the authenticated user opens and is authorized to view.
- Do not bypass login, CAPTCHA, Carfax paywalls, access controls, anti-bot systems, or rate limits.
- Current bids are observations/features, never final training labels.
- Purchase fee details, invoices, accepted negotiations, and user confirmations are outcome candidates.
- Store data with source, page type, timestamp, organization/user, confidence, and evidence.
- Keep raw visible text capped.
- Do not store secrets, session tokens, service-role keys, Supabase keys, passwords, or OpenLane credentials.
- Do not break existing Market Snap, Deal Radar, financial, backup, or extension flows.
- Add or update tests.
- Run verification before moving on.

## Root Cause

The extension currently detects OpenLane/vehicle pages, but it needs deeper page context. The same dollar amount can mean current bid, buy-now, sold candidate, fee, tax, subtotal, or invoice total.

## Second, Third, and Fourth Order Consequences

- Current bids may be mistaken for final prices.
- Purchase pages may be treated as active listing pages.
- Backend cannot choose observation vs candidate outcome vs verified outcome.
- Training datasets cannot know which records are safe labels.

## Production-Grade Solution

Create a page classifier that returns pageType, captureKind, confidenceScore, evidence, and warnings using URL, headings, tabs, sidebar context, labels, status text, and visible DOM markers.

## Implementation Requirements

- Add `browser-extension/src/openlane-page-classifier.js` or integrate cleanly into extractor if simpler.
- Classify active_listing from current bid, bid history, time remaining, photos, disclosures, vehicle header.
- Classify purchase_list/purchase_detail/fee_details from Purchases, Open Order, Order History, Fee details, Purchase info, Buy price - auction, Transaction Fee, Taxes, Total, Paid.
- Classify post_sale from Post Sale, Sold Price, negotiation, accepted, rejected, pending, counter offer.
- Classify unknown pages and avoid intrusive widgets.
- Include classification evidence in Copy JSON/debug payload.
- Update content runtime to use classification before showing or saving.

## Verification Requirements

- Fixture tests for active listing, purchase list, fee details, post-sale pending, post-sale accepted, unknown page.
- Active listing => observation.
- Fee details => verified_outcome.
- Post-sale without accepted status => candidate_outcome.
- Run all verification commands.

## Deliverables

- Page classifier module.
- Classification included in extracted payload.
- Tests for page types.
- Runtime uses classifier.

## Final Self-Check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
