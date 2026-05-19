# Market Snap Final Extraction Validation

## Summary

Dealer Flow Market Snap extraction is validated for the fixed OpenLane extension pipeline: stable SPA readiness, cache invalidation, VIN recovery, CARFAX evidence, consent-gated network evidence, backend capture quality gates, and ML training-label safety.

This validation is based on automated fixture and unit coverage. It does not replace final live Chrome validation against a logged-in `https://app.openlane.ca/vdp/...` page.

## What Was Fixed

- OpenLane VDP capture now waits for stable, meaningful vehicle content instead of finalizing on a loading shell.
- OpenLane cache invalidation clears stale extraction/classification data on retries and route changes.
- VIN recovery covers visible text, URL, safe DOM attributes, generic data attributes, copy controls, and consent-gated network JSON.
- CARFAX recovery covers direct links, relative links, `data-href`, `data-url`, safe DOM attributes, text-only fallback, missing status, and network JSON.
- Deep Capture network evidence remains consent-gated and sanitized.
- Backend storage separates active observations from outcome labels and applies stricter quality gates.
- Candidate ML training now rejects unsafe labels and never falls back from missing targets to `listed_price` or `0`.

## VIN Extraction Validation

Validated by `npm run verify:extension`, `npm test`, and fixtures/tests in:

- `tests/openlane-extractor.test.ts`
- `tests/openlane-stable-capture.test.ts`
- `tests/openlane-phase8-fixtures.test.ts`
- `tests/fixtures/openlane/*`

Covered sources:

- Visible text: `openlane-basic.html`, realistic active VDP fixtures.
- URL-only VIN recovery: `openlane-vdp-vin-in-url-only.html`.
- Safe/generic DOM attributes: `openlane-vdp-vin-data-attribute-only.html`.
- Network JSON: `openlane-network-carfax-response.json` and existing network tests.
- Invalid VIN rejection: `openlane-invalid-vin.html` and explicit extractor tests for forbidden `I`, `O`, and `Q`.

## Carfax Extraction Validation

Validated paths:

- Direct CARFAX URL: `openlane-carfax-url.html`, `openlane-with-carfax.html`.
- Relative URL and safe attribute URLs: extractor tests.
- `data-href`: `openlane-carfax-data-href.html`.
- `data-url`: `openlane-carfax-data-url.html`.
- Text-only: `openlane-carfax-text-only.html`.
- Missing: `openlane-no-carfax.html`.
- Network JSON: `openlane-network-carfax-response.json`.

The extractor stores URL/metadata only. It does not fetch paid CARFAX report content.

## Deep Capture Validation

Validated behavior:

- Network observer requires active Deep Capture consent and a consent id.
- Auth/session/profile/payment/user/token endpoints are ignored.
- Headers, cookies, tokens, sessions, passwords, JWTs, bearer strings, emails, and phone values are redacted or rejected.
- Network JSON is normalized into candidates and capped evidence instead of raw unlimited payloads.
- Runtime/widget debug exposes readiness, blocked reason, network observer status, and evidence counts.

Relevant tests:

- `tests/deep-capture-network-observer.test.ts`
- `tests/deep-capture-consent.test.ts`
- `tests/browser-extension.test.ts`
- `tests/openlane-phase8-fixtures.test.ts`

## Backend Quality Gate Validation

Validated backend rules:

- Active listings remain `observation`.
- Observations cannot carry verified outcome labels.
- Verified outcomes require evidence.
- Candidate outcomes are not training eligible.
- Training eligibility requires model-improvement opt-in, non-pending status, verified/manual capture kind, a valid target price, and visible evidence.
- CARFAX status and field evidence persist in capped metadata.
- Missing VIN lowers OpenLane identity confidence and capture quality score.
- Admin data-quality metrics now include VIN coverage, CARFAX status counts, duplicate identity rate, observation/outcome counts, training-eligible outcome counts, and extraction/quality averages.

Relevant tests:

- `tests/market-snap-validation.test.ts`
- `tests/market-snap-openlane-storage.test.ts`
- `tests/market-snap-training-export.test.ts`

## ML Readiness Validation

Candidate ML infrastructure is gated, not promoted.

Validated ML safeguards:

- `listed_price` is never used as a supervised target.
- Missing targets are rejected instead of becoming `0`.
- Targets must come from verified fields: `actual_sale_price`, `accepted_amount`, `negotiated_amount`, `final_bid_amount`, `buy_price_auction`, `total_invoice_amount`, `final_acquisition_cost`, or manual confirmed price.
- Observations, candidate outcomes, pending negotiations, invalid market types, non-positive targets, and OpenLane rows missing model-improvement opt-in are rejected.
- Candidate dataset export returns only clean rows plus rejection reasons and quality metrics.
- `/predict` remains fallback/candidate-only; `/model-status` reports no production model and `catboost_enabled: false`.

Validated by `python -m pytest` in `ml-service`.

## Commands Run

From repository root:

```bash
npm.cmd run verify:extension
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

From `ml-service`:

```bash
python -m pytest
```

## Test Results

Latest repository-wide validation was rerun on May 19, 2026 after the OpenLane purchased VDP and widget-debug phases.

- `npm.cmd run verify:extension`: passed, 85 tests.
- `npm.cmd test`: passed, 278 tests.
- `npm.cmd run lint`: passed.
- `npm.cmd run build`: passed.
- `python -m pytest`: rerun from `ml-service`, passed, 25 tests.

## Remaining Risks

- Live OpenLane DOM/network shapes can still change; fixture tests reduce this risk but cannot eliminate it.
- Deep Capture behavior must be manually verified in a real authenticated Chrome profile with active consent.
- Backend persistence must be verified against the deployed Supabase project after migrations are applied.
- Production ML remains blocked until enough clean verified outcomes exist and model performance is measured against the comparable estimator.
- GitHub reports 2 moderate vulnerabilities on the default branch via Dependabot; they were not part of this extraction fix.

## Go/No-Go Decision For Supervised ML Infrastructure

GO for supervised ML infrastructure preparation.

Reason: dataset gates, strict target validation, candidate-only export, rejection reporting, model-improvement gating, and automated tests are in place.

## Go/No-Go Decision For Production ML Promotion

NO-GO for production ML promotion.

Reason: CatBoost is still candidate-only, `/model-status` reports no production model, `/predict` remains fallback-only, and there is no validated evidence that a trained model beats the comparable estimator on clean verified outcomes.
