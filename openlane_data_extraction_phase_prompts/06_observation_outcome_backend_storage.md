# Phase 6 — Observation and Outcome Backend Storage

## /goal

Implement backend storage and API support that separates OpenLane observations from verified/candidate outcomes and links them by vehicle identity.

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

Even if extraction is correct, data can still be stored ambiguously. Active observations, post-sale candidates, verified purchase outcomes, and invoice/acquisition costs need separate persistence.

## Second, Third, and Fourth Order Consequences

- ML training can accidentally consume currentBid as a label.
- Bid trajectory and outcomes cannot be reconstructed.
- Final fees/taxes become hard to audit.
- Cross-user/model aggregation becomes unsafe and low quality.

## Production-Grade Solution

Add durable, organization-owned, audit-friendly storage for vehicle identities, observations, and outcomes. Use append-only records with source, confidence, and evidence.

## Implementation Requirements

- Inspect existing Market Snap/Deal Radar schema and migrations.
- Add tables or clearly separated columns for vehicle identities, observations, and outcomes.
- Observation records include pageType, captureKind, currentBid, buyNowPrice, timeRemaining, statusText, disclosureCount, photoCount, capturedAt, capturedBy, organizationId, capped payload.
- Outcome records include outcomeType, buyPriceAuction, finalBidAmount, negotiatedAmount, fees, taxes, totalInvoiceAmount, finalAcquisitionCost, confidenceLevel, sourcePageType, evidence.
- Link by VIN when possible; fallback to listing URL/title/date with lower confidence.
- Preserve RLS and organization isolation.
- Add ingestion API routes and repository functions.
- Prevent verified outcomes from being overwritten by lower-confidence observations.
- Add idempotent upserts/dedupe constraints.

## Verification Requirements

- Migration is append-only and does not delete core data.
- RLS enabled for new tables.
- Tests prove observations and outcomes store separately.
- Tests prove active bids cannot overwrite verified outcomes.
- Tests prove cross-org access is rejected.
- Run all verification commands.

## Deliverables

- Safe migration.
- Validation schemas.
- Repository/API functions.
- Storage separation tests.

## Final Self-Check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
