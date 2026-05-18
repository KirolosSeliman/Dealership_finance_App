# Phase 8 — Widget Data Quality and Debug Tools

## /goal

Improve the in-page widget so users can move it, configure it, inspect extraction, and see whether captured prices are observations, candidates, or verified outcomes.

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

The widget can block bid controls, settings can be hard to access, and wrong extraction is hard to debug without evidence. The user needs control and transparency in-page.

## Second, Third, and Fourth Order Consequences

- Widget blocks OpenLane bidding workflow.
- Settings failure prevents testing.
- Users cannot diagnose bad extraction.
- Users may trust unsafe price states.

## Production-Grade Solution

Make the widget draggable, minimizable, hideable, settings-capable, and diagnostic while staying compact and non-invasive.

## Implementation Requirements

- Add draggable widget with saved position.
- Default position away from bid controls.
- Add compact/minimized/hide current page controls.
- Add in-widget settings drawer: Dealer Flow URL, organization ID, auto-analyze, capture on/off, include media, include raw text, debug.
- Do not rely only on options.html.
- Show pageType and captureKind.
- Label each price: current bid, buy now, sold candidate, buy price auction, invoice total.
- Add data-quality panel: missing fields, warnings, confidence, evidence snippets.
- Improve Copy JSON to include classification, evidence, payload, valuation, backend response.

## Verification Requirements

- Widget has drag hooks and storage.
- Settings drawer exists and saves settings.
- Price semantics render clearly.
- Manual test: widget does not block bid button.
- Manual test: settings work even if options page is blocked.
- Run all verification commands.

## Deliverables

- Draggable widget.
- In-widget settings.
- Debug/data-quality panel.
- Tests/manual notes.

## Final Self-Check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
