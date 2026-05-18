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

**Title:** Replace in-memory rate limiting with production-safe persistent rate limiting  
**Severity:** HIGH

## Root Problem

The current server security helper uses an in-memory `Map` for rate limiting. On Vercel/serverless, memory is per instance and resets on cold starts. This is not reliable production protection for mutation, backup, tax export, or cron endpoints.

## Secondary / Tied Problems

- Rate limits can be bypassed across serverless instances.
- Limits reset on cold start.
- High-risk endpoints can be spammed.
- Backup/tax exports can be abused.
- Mutation endpoint can be hammered.
- Security behavior differs between local dev and production.

## Files / Areas Likely Involved

Likely files:
- `src/lib/server/security.ts`
- `src/app/api/mutations/route.ts`
- `src/app/api/taxes/export/route.ts`
- backup API routes
- market-snap API routes
- `.env.example`
- README/deployment security docs
- tests

## Required Production-Grade Solution

Implement production-grade rate limiting.

Preferred solutions:
1. Use Upstash Redis, Vercel KV, Supabase table, or another persistent/distributed store.
2. Keep a safe local fallback only for development/test environments.
3. Add environment variable documentation.
4. Rate-limit by:
   - user ID when authenticated,
   - IP when unauthenticated,
   - endpoint bucket,
   - operation type for high-risk mutations if possible.
5. Ensure response returns 429 with clear message.
6. Do not make the app unusable locally when rate-limit env vars are missing.

If adding a new external dependency is too heavy, use a Supabase-backed `rate_limit_events` or `rate_limit_buckets` table with an RPC that increments and checks atomically.

## Implementation Plan

1. Inspect all calls to `checkRateLimit`.
2. Choose the smallest production-suitable implementation for this repo.
3. Add env variables and docs.
4. Update `checkRateLimit` to async if necessary.
5. Update routes that call it.
6. Add tests for limit behavior, reset window, user ID bucket, and IP bucket.
7. Verify local fallback works in dev/test.
8. Run all verification commands.

## Required Verification Matrix

Test matrix:
- Same user exceeds mutation limit → 429.
- Different users have separate buckets.
- Same IP unauthenticated exceeds limit → 429.
- Window reset allows requests again.
- Missing production config causes clear startup/runtime warning, not silent fake security.
- Local test fallback deterministic.
- Run `npm test`, `npm run lint`, `npm run build`.

## Acceptance Criteria

- Rate limiting works across production instances.
- High-risk endpoints are protected.
- Local dev remains usable.
- Environment docs are updated.
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
