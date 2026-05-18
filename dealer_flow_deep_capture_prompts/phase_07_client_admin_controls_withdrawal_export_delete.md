# Phase 07 — Client/Admin Controls: Withdraw, Export, Delete, and Audit

## Goal

Give organization owners/admins clear control over Deep Capture consent and captured data, including withdrawal, visibility, export, and deletion/retention controls.


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

Act as a senior product engineer. Build the app-side controls that make Deep Capture transparent and manageable.

## Required UI

Find the best existing settings/admin area and add a Market Snap / Deep Capture settings section.

It should show:

- Deep Capture status:
  - Not enabled
  - Active
  - Withdrawn
  - Requires renewal
- Current consent version
- Accepted by / accepted at
- Enabled scopes:
  - visible DOM extraction
  - safe read-only section expansion
  - network response observation
  - fee/outcome capture
  - media URL capture
  - model improvement
- Allowed domains/hosts
- Data categories collected
- Retention policy summary
- Last captures summary
- Link to Terms/Privacy
- Button: Enable Deep Capture
- Button: Withdraw Deep Capture
- Button: Disable Model Improvement
- Button: Export Deep Capture Audit
- Button/request path: delete eligible unsaved capture data

## Required backend/API

Add or reuse endpoints for:

- Get consent status
- Accept consent
- Withdraw consent
- List consent events
- Export consent/capture audit summary
- Delete eligible unsaved captures if allowed by retention/legal requirements

Do not let unauthorized roles change consent.

## Withdrawal behavior

When consent is withdrawn:

- Extension sees withdrawn status on next call.
- Deep Capture stops.
- Network observer stops.
- Future deep payloads are rejected by backend.
- Existing business records remain according to retention policy.
- Eligible temporary unsaved captures can be deleted or scheduled for deletion.
- Audit event is recorded.

## UX copy

Keep copy clear and non-scary:

- “Deep Capture improves accuracy by reading structured vehicle/listing data already loaded in your browser session.”
- “It does not collect passwords, cookies, authorization headers, or unrelated browsing data.”
- “You can turn it off anytime.”
- “Model improvement is separate.”

## Acceptance criteria

- Owner/admin can enable and withdraw consent.
- Non-authorized roles cannot enable/withdraw.
- Status is visible in web app and extension.
- Withdrawal stops future deep captures.
- Audit/export works.
- Model improvement can be disabled separately.
- Basic Market Snap remains usable without Deep Capture.

## Tests

Add tests for:

- role permissions
- consent status endpoint
- enable consent
- withdraw consent
- export audit
- delete eligible captures
- extension reacts to withdrawn consent if touched in this phase

Run:

```bash
npm run lint
npm run build
npm test
```

## Final Codex response format

Return:

1. Summary
2. UI changes
3. API changes
4. Role/security behavior
5. Withdrawal/export/delete behavior
6. Tests run and results
7. Risks/loopholes found and fixed

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
