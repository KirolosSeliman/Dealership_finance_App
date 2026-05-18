# Codex Mega Prompt — Dealer Flow Production Hardening

You are acting as a SENIOR SOFTWARE ENGINEER, FINANCIAL SYSTEMS ARCHITECT, DATABASE INTEGRITY REVIEWER, SECURITY ENGINEER, QA LEAD, and STRICT RELEASE GATEKEEPER.

Repository: `https://github.com/KirolosSeliman/Dealership_finance_App`
Branch to inspect first: `main`

This prompt targets ONE production blocker. Do not drift into unrelated refactors. Fix the root problem and the directly tied secondary problems only.

Global rules:
- Inspect the current repository before changing anything.
- Do not assume a feature works because a file exists.
- Prefer small, surgical, production-grade changes over broad rewrites.
- Keep the existing product direction and UI style intact.
- Do not remove existing working features.
- Do not hardcode business logic in multiple places.
- Financial writes must be auditable, reversible, and safe.
- Database migrations must be idempotent, append-only where possible, and safe to run on an existing Supabase project.
- Never silently destroy finance, tax, sale, cash, or audit-history data.
- Add or update tests wherever the repo has a test structure.
- Run all available verification commands before claiming success:
  - `npm test`
  - `npm run lint`
  - `npm run build`
- If a command cannot run because of missing environment variables or unavailable services, explain exactly what blocked it and still run every static/unit check possible.
- Your final answer must include files changed, root cause, exact fix, tests added, commands run, results, remaining risks, and manual verification steps.


## Target Problem

**Title:** Make Market Snap honest, calibrated, and safe for production MVP  
**Severity:** HIGH

## Root Problem

Market Snap currently has a rule/comparable estimator foundation with hardcoded multipliers, estimated costs, risk scoring, and fallback pricing. This is useful as an MVP, but not safe to present as a validated AI valuation engine without calibration and guardrails.

## Secondary / Tied Problems

- Estimates may look more precise than they are.
- Fallback pricing can hide lack of comparable data.
- Risk scoring is rule-based and not validated.
- CatBoost service is candidate-only and should not be treated as production model.
- Sold vehicle prediction error tracking must be respected.
- Saved listings and external market data need retention rules.
- Extension capture must remain authorized and user-assisted only.

## Files / Areas Likely Involved

Likely files:
- `src/lib/market-snap/engine.ts`
- `src/types/market-snap.ts`
- Market Snap API routes
- Deal Radar components/routes
- `ml-service/`
- `browser-extension/`
- Supabase Market Snap migrations
- README/docs

## Required Production-Grade Solution

Implement production guardrails, not fake AI claims.

Required changes:
1. UI must clearly label outputs as estimates.
2. Show confidence score, comparable count, missing data, and warnings prominently.
3. If comparable count is low, show fallback warning.
4. Do not show “Strong Buy” without enough confidence/comparables unless explicitly justified.
5. Store prediction vs actual sale outcomes for sold vehicles.
6. Add a calibration/report function:
   - average error,
   - median error,
   - error by make/model/source,
   - confidence vs error.
7. CatBoost remains candidate-only until:
   - trained,
   - evaluated,
   - manually promoted,
   - versioned,
   - better than comparable baseline.
8. Keep extension language compliant:
   - visible authorized listing capture only,
   - no CAPTCHA bypass,
   - no login-wall bypass,
   - no anti-bot evasion.
9. Add tests for estimator edge cases.

## Implementation Plan

1. Inspect Market Snap UI/API/storage.
2. Add explicit estimation disclaimers and confidence warnings.
3. Tighten recommendation thresholds for low data quality.
4. Add prediction-error storage/update if not complete.
5. Add calibration summary if feasible.
6. Ensure sold vehicles are not refreshed but remain useful for training/evaluation.
7. Update docs and README.
8. Add tests for:
   - no comparables,
   - low comparables,
   - salvage vs clean separation,
   - severe condition warnings,
   - sold vehicle refresh skip.
9. Run full verification.

## Required Verification Matrix

Test matrix:
- No comparables → fallback warning, low confidence, no overconfident recommendation.
- 1-2 comparables → low confidence warning.
- Salvage listing not mixed with clean retail comparables.
- Severe rust/OBD warning increases risk.
- Sold vehicle is skipped by daily refresh.
- Actual sale price can be compared with previous valuation.
- CatBoost candidate not used as production without promoted model version.
- Run `npm test`, `npm run lint`, `npm run build`.

## Acceptance Criteria

- Market Snap is honest and transparent.
- No fake production AI claims.
- Low-data estimates are clearly marked.
- Calibration path exists.
- Build/lint/tests pass.

## Strict Boundaries

- Do not rewrite the whole app.
- Do not introduce a new stack.
- Do not fake success.
- Do not leave dead code, duplicated logic, or unused routes.
- Do not make UI-only changes if the bug is database/business-logic related.
- Do not claim production-ready until tests and build pass or until every failure is explained with exact evidence.



## Final Response Required From Codex

Return a concise but complete engineering report with:

1. Root cause confirmed from the current code.
2. Exact files changed.
3. Database migrations added or modified.
4. Tests added or updated.
5. Commands run and exact pass/fail results.
6. Manual verification checklist.
7. Remaining risks, if any.
8. Whether this specific blocker is now ready for real production use.
