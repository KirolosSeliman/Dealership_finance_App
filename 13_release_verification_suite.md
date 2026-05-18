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

**Title:** Create final production release verification suite  
**Severity:** CRITICAL

## Root Problem

The project needs a final release gate that verifies financial correctness, data integrity, permissions, UI workflows, backups, tax exports, and build health. Without a repeatable release suite, regressions will keep coming back.

## Secondary / Tied Problems

- Build/lint/test commands exist but coverage is unknown.
- Financial flows need regression tests.
- Role permissions need systematic tests.
- Migrations need verification.
- Manual browser scenarios need a checklist.
- Vercel/Supabase environment readiness needs verification.
- Mobile behavior needs a repeatable check.

## Files / Areas Likely Involved

Likely files:
- `tests/*.test.ts`
- `package.json`
- `README.md`
- `docs/deployment-security.md`
- New `docs/release-checklist.md`
- Possibly Playwright setup if chosen
- Supabase seed/test helpers if available

## Required Production-Grade Solution

Build a release verification suite and checklist.

Required coverage:
1. Unit tests:
   - tax calculations,
   - dashboard metrics,
   - sale breakdown,
   - cash balances,
   - tax report period filtering,
   - Market Snap estimator edge cases.

2. Integration tests where possible:
   - vehicle creation,
   - expense + cash impact,
   - sale recording,
   - sale void/correction if implemented,
   - archive vehicle,
   - backup generation/verification.

3. Permission tests:
   - owner,
   - admin,
   - member,
   - accountant,
   - viewer.

4. Migration readiness:
   - list all required migrations in order,
   - verify schema dependencies,
   - no destructive migration for production data.

5. Manual browser checklist:
   - login/signup,
   - org create/join,
   - add vehicle,
   - add expense,
   - record sale,
   - cash actions,
   - contacts,
   - attachments,
   - tax export,
   - backup export/verify,
   - mobile nav,
   - refresh/deep link.

6. Deployment checklist:
   - env vars,
   - Supabase RLS,
   - private storage bucket,
   - cron secret,
   - R2 config,
   - Vercel cron,
   - production build.

## Implementation Plan

1. Inspect existing tests and package scripts.
2. Add missing unit tests first.
3. Add integration tests only if repo setup supports it without excessive new infrastructure.
4. Create `docs/release-checklist.md`.
5. Add a clear command sequence for local and CI verification.
6. Ensure tests are deterministic and do not require real production Supabase.
7. Run all verification commands.
8. Report exactly what remains manual-only.

## Required Verification Matrix

Test matrix:
- `npm test` covers financial calculations and critical edge cases.
- `npm run lint` passes.
- `npm run build` passes.
- Release checklist can be followed by a human.
- Manual-only items are clearly separated.
- No test depends on private production credentials.
- CI-ready if GitHub Actions exists or can be added safely.

## Acceptance Criteria

- There is a repeatable release gate.
- Critical financial bugs are covered by tests.
- Manual launch checklist exists.
- Codex cannot claim launch readiness without passing the suite.
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
