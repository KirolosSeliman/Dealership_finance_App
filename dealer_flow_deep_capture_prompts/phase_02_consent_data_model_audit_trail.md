# Phase 02 — Consent Data Model, Audit Trail, and Server Enforcement

## Goal

Create a backend data model and authorization enforcement layer so Deep Capture is only accepted by Dealer Flow when the organization/user has an active, versioned consent record.


## Repository context

Repository: KirolosSeliman/Dealership_finance_App

Relevant existing extension files likely include:
- browser-extension/manifest.json
- browser-extension/src/storage.js
- browser-extension/src/api-client.js
- browser-extension/src/openlane-extraction-contract.js
- browser-extension/src/openlane-section-map.js
- browser-extension/src/openlane-page-classifier.js
- browser-extension/src/openlane-network-observer.js
- browser-extension/src/openlane-network-page-hook.js
- browser-extension/src/openlane-safe-expander.js
- browser-extension/src/openlane-extractor.js
- browser-extension/src/market-snap-widget.js
- browser-extension/src/capture-runtime.js
- browser-extension/src/content-script.js
- browser-extension/options.html / options scripts if present
- browser-extension/popup.html / popup scripts if present

Relevant backend files likely include:
- src/lib/server/market-snap-api.ts
- src/lib/market-snap/repository.ts
- src/lib/market-snap/validation.ts
- src/types/market-snap.ts
- src/lib/market-snap/training-export.ts
- src/app/api/market-snap/* routes
- supabase/migrations/*
- tests/fixtures/openlane/*
- tests/*market-snap* or *openlane* test files

You must discover the exact current file names and code before modifying anything.



## Global non-negotiables for every phase

- Do not implement, suggest, or preserve any CAPTCHA bypass, anti-bot bypass, stealth scraping, credential harvesting, cookie extraction, session-token storage, header exfiltration, hidden tracking, or request tampering.
- Deep Capture must mean: collecting vehicle/listing/business data that the authenticated client is already authorized to view in their own browser session.
- Terms/Privacy language does not override third-party platform terms. Add language requiring the client to confirm they are authorized to use Dealer Flow on the relevant platform/account.
- Do not store authorization headers, cookies, session tokens, passwords, CSRF tokens, JWTs, refresh tokens, or unrelated personal data.
- If buyer/client/seller personal information appears in captured content, redact it unless it is strictly necessary for a clearly disclosed Dealer Flow feature.
- Use data minimization: store normalized vehicle fields, evidence snippets, endpoint patterns, confidence/provenance, and capped payloads; avoid raw full responses unless explicitly necessary and retention-limited.
- Keep active bids/current offers as observation features only. They must not become ML training labels unless later connected to a verified outcome, manual confirmation, accepted negotiation, invoice, or Dealer Flow sale.
- Every changed file must be read before editing. Follow existing architecture, naming style, TypeScript strictness, RLS/security patterns, and tests.
- Run lint/build/tests where available. If a command cannot run, explain exactly why and what remains unverified.
- Produce a final implementation report with changed files, behavior before/after, security/privacy notes, tests run, and deployment/migration instructions.


## Specific task

Act as a senior backend/security engineer. Design and implement a consent data model that records exactly who consented, for which organization, to which version of the Deep Capture terms/privacy/consent text, what capture scopes were enabled, and when consent was withdrawn.

## Required data model

Create Supabase migration(s) for one or more tables such as:

- `market_snap_capture_consents`
- `market_snap_capture_consent_events`

Use the existing schema conventions. Do not invent inconsistent naming.

The active consent table should support:

- `id`
- `organization_id`
- `user_id`
- `status`: active / withdrawn / expired / superseded
- `consent_version`
- `terms_version`
- `privacy_version`
- `capture_scopes` JSONB or normalized enum list:
  - `dom_visible`
  - `safe_read_only_expansion`
  - `network_response_observation`
  - `fee_outcome_capture`
  - `post_sale_outcome_capture`
  - `media_url_capture`
  - `model_improvement`
- `allowed_domains` / `allowed_hosts`
- `allowed_data_categories`
- `denied_data_categories`
- `accepted_at`
- `withdrawn_at`
- `accepted_by_user_id`
- `withdrawn_by_user_id`
- `source`: web_app_settings / extension_options / onboarding
- `extension_installation_id` if available, generated randomly by the extension, not fingerprinted
- `created_at`
- `updated_at`

The event table should record an immutable audit trail:

- consent_created
- consent_updated
- consent_withdrawn
- consent_version_superseded
- model_improvement_enabled/disabled
- capture_scope_enabled/disabled

## RLS/security requirements

- Owners/admins can grant/withdraw organization-level Deep Capture consent.
- Members can only use Deep Capture if the organization has active consent and their role is allowed.
- Viewers/accountants should not enable Deep Capture unless existing product roles say otherwise.
- Users must only see consent records for organizations they belong to.
- Use existing helper functions/policies if present, such as `is_org_member` or role checks.
- Keep RLS enabled.
- Do not use service role keys in client code.

## Server enforcement requirements

Update backend Market Snap endpoints so:

- `/api/market-snap/capture-listing` rejects Deep Capture payloads without active consent.
- `/api/market-snap/analyze-listing` may still analyze basic DOM payloads if current app behavior allows it.
- `/api/market-snap/save-listing` can save basic payloads, but must mark/store Deep Capture evidence only when consent exists.
- Network-derived evidence must include `deepCaptureConsentId` or enough server-side context to verify consent.
- If consent is missing, expired, or version-stale:
  - return a clear 403 with a user-facing message
  - do not persist deep payload fields
  - do not silently downgrade without telling the extension

## Implementation details

1. Inspect current organization role model.
2. Inspect `src/lib/server/security.ts` and related auth utilities.
3. Add helper functions:
   - `getActiveMarketSnapCaptureConsent(client, organizationId, userId)`
   - `requireMarketSnapDeepCaptureConsent(client, organizationId, userId, scopes)`
   - `recordMarketSnapConsentEvent(...)`
4. Update validation schemas to include:
   - `captureLevel`
   - `captureScopes`
   - `deepCaptureConsentId`
   - `sourceEvidence[]`
5. Write tests for:
   - no consent -> rejects deep capture
   - active consent -> accepts deep capture
   - withdrawn consent -> rejects
   - stale consent version -> rejects or requires renewal
   - basic DOM capture still works if intended
6. If using migrations, include rollback reasoning or idempotent migration safety where possible.

## Acceptance criteria

- Deep Capture cannot be persisted without active consent.
- Consent records are versioned and auditable.
- Withdrawal stops future deep capture.
- RLS prevents cross-organization access.
- Tests cover consent enforcement.
- Existing Market Snap basic flow remains working.

## Required validation

Run:

```bash
npm run lint
npm run build
npm test
```

If Supabase local tooling exists:

```bash
supabase db reset
supabase test db
```

If those commands are not available, explain what could not be verified.

## Final Codex response format

Return:

1. Summary
2. Migration/schema changes
3. RLS/security changes
4. API enforcement changes
5. Tests run and results
6. Manual Supabase deployment steps
7. Risks/loopholes found and fixed

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
