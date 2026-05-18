# Phase 7 — Extension Capture Queue, Deduplication, and Efficiency

## /goal

Make extension capture reliable and efficient by adding queueing, dedupe signatures, backoff, meaningful-change detection, and settings-based controls.

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

MutationObserver and dynamic routes can cause over-capture or missed captures. Without dedupe/throttle logic, the extension may spam API calls or save useless duplicates.

## Second, Third, and Fourth Order Consequences

- Dealer Flow storage fills with duplicate snapshots.
- Normal browsing can hit rate limits.
- Important changes like bid updates may be missed.
- OpenLane page performance and user experience can suffer.

## Production-Grade Solution

Build an efficient capture runtime that saves only meaningful observations/outcomes from pages the user opens, with robust throttling and safe retries.

## Implementation Requirements

- Separate analysis-for-widget from save-observation/save-outcome.
- Create stable signatures using VIN, URL, pageType, currentBid, buyNow, status, fee total, sold price, photo/disclosure counts.
- Save new observation only when signature changes or time bucket passes.
- Do not call backend on every DOM mutation.
- Implement backoff and clear disconnected/error states.
- Use a small capped local queue only if useful.
- Respect settings: capture on/off, model improvement on/off, include media URLs, include raw text, debug mode.
- Never crawl hidden/background pages.

## Verification Requirements

- Duplicate DOM mutations do not save duplicate records.
- Current bid change creates a new observation.
- Fee total change or purchase transition creates outcome capture.
- Capture disabled setting stops storage.
- Run all verification commands.

## Deliverables

- Capture queue/runtime.
- Dedupe and meaningful-change logic.
- Settings integration.
- Tests for throttling/dedupe.

## Final Self-Check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
