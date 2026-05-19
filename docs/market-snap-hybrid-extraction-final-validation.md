# Market Snap Hybrid Extraction Final Validation

## Summary

The hybrid Market Snap OpenLane extraction pipeline is validated by automated tests for default Deep Capture activation, safe network evidence, VIN recovery, CARFAX truthfulness, widget/debug payload reliability, save-payload null safety, backend validation, and deployment documentation.

Manual live Chrome/OpenLane validation: not completed in this environment. This session does not have a real authenticated OpenLane tab with the unpacked extension loaded, so the final real-browser checklist remains a human release gate.

## Deep Capture Default-On Validation

Automated coverage proves the temporary default-on mode starts only when required settings exist and the page context is OpenLane. Missing organization ID disables default activation. Model improvement remains opt-in and is not silently enabled.

Validated by:

- `tests/deep-capture-extension.test.ts`
- `tests/deep-capture-network-observer.test.ts`
- `tests/market-snap-extension-hybrid.test.ts`
- `tests/browser-extension.test.ts`

## VIN Validation

Automated fixtures cover visible VIN text, header chip VIN, explicit DOM attributes, safe generic attributes, copy controls, URL fallback, network JSON, missing VIN, invalid VINs containing forbidden `I/O/Q`, and false UI token candidates.

Expected behavior remains:

- Valid VIN allows capture.
- Missing VIN keeps OpenLane capture preview-only.
- Invalid or label-only candidates are rejected with evidence/rejection reasons.

## Carfax Validation

CARFAX coverage includes direct DOM links, relative links, `data-href`, `data-url`, safe nearby metadata, network JSON, text-only fallback, and no-CARFAX pages.

Expected behavior remains:

- `url_found` only when a safe URL is present.
- `text_only` only when CARFAX is visible but no URL is exposed.
- The extension does not fetch paid CARFAX content or bypass access controls.

## Network Evidence Validation

The network observer remains allowlisted, capped, sanitized, and candidate-based. Tests prove vehicle/listing JSON can become field candidates while auth, session, profile, account, payment, user, token, cookie, password, and similar endpoints are denied or redacted.

The copy/debug payload includes network evidence summaries and candidate counts, not full unbounded raw response bodies.

## Widget/Button Validation

Automated tests cover:

- Settings save success/failure messaging.
- Null-safe rendering when no extraction exists.
- Wrapped Refresh, Save, Copy JSON, Open Dealer Flow, Hide page, and collapse actions.
- Save disabled while saving and when readiness blocks capture.
- Save payload omits `valuation` when no valuation exists.
- Copy JSON includes normalized extraction, readiness summary, debug evidence, backend response, and capture response.

## Security Validation

Security posture preserved:

- No CAPTCHA bypass.
- No login-wall bypass.
- No anti-bot bypass.
- No cookies, authorization headers, JWTs, session tokens, passwords, CSRF tokens, account/profile/payment data, or service-role secrets are captured.
- Extension permissions remain Manifest V3 scoped to storage/activeTab and OpenLane/Dealer Flow host access.
- Backend origin, auth, organization-role, schema, evidence-size, URL, VIN, mileage, and consent gates remain in place.

## Test Results

Latest automated commands from repository root, rerun on May 19, 2026 after the OpenLane purchased VDP and widget-debug phases:

```powershell
npm.cmd run verify:extension
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Results:

- `npm.cmd run verify:extension`: passed, 85/85 tests.
- `npm.cmd test`: passed, 278/278 tests.
- `npm.cmd run lint`: passed with no warnings.
- `npm.cmd run build`: passed; Next.js production build compiled and generated all app routes.

`vercel build` was not run because the Vercel CLI is not installed in this local environment and the repo is not linked with a `.vercel/project.json`.

## Manual Browser Results

Manual live Chrome/OpenLane validation: not completed in this environment.

Required manual release pass:

1. Open `chrome://extensions`.
2. Reload the unpacked extension from `browser-extension/`.
3. Clear old extension storage if stale settings are suspected.
4. Open Dealer Flow in the same Chrome profile and sign in.
5. Set Dealer Flow URL and Organization ID in extension settings.
6. Confirm Deep Capture default active state is visible.
7. Confirm model improvement opt-in is not silently enabled.
8. Open a real logged-in `https://app.openlane.ca/vdp/...` page.
9. Confirm widget appears on the VDP and not on unsupported pages.
10. Confirm VIN, mileage, CARFAX status, network evidence count, and safe expansion status are truthful.
11. Confirm Copy JSON contains readiness/debug summaries and no secrets.
12. Confirm missing VIN blocks capture and a valid VIN allows Save to Deal Radar.
13. Confirm current bid remains observation-only.
14. Confirm Save to Deal Radar succeeds and the listing appears in Deal Radar.

## Deployment Status

Local deployability is validated by `npm.cmd run build`.

Vercel status from this session:

- Local `vercel` CLI: unavailable.
- `.vercel/project.json`: absent.
- Vercel connector teams visible: `team_F3dOq6TxZUocL6KtF64BTcPh`.
- Vercel connector projects visible: `vistaire`, `trouvable`, `github-readme-stats`, `marc-saad-hadidi`, `givn`, and `stocks`.
- Dealer Flow project: not visible through the connector, so deployment logs could not be inspected.

Before production/private beta, configure `MARKET_SNAP_EXTENSION_ORIGINS` from `docs/market-snap-extension-deployment.md`, redeploy Dealer Flow, and inspect the actual Vercel deployment result.

## Remaining Risks

- Real OpenLane DOM and network payload shapes may differ from fixtures.
- The final live OpenLane account/browser extension pass is still required.
- Vercel project environment variables and deployment logs were not available in this session.
- GitHub reports 2 moderate Dependabot alerts on the default branch.
- Default-on Deep Capture remains a temporary installer/onboarding bridge and should be replaced by the formal consent UI path before broad distribution.

## Rollback Plan

1. Remove the extension origin from `MARKET_SNAP_EXTENSION_ORIGINS`.
2. Redeploy Dealer Flow.
3. In extension settings, turn off Deep Capture and Observe page network data.
4. Withdraw Deep Capture consent for affected organizations if needed.
5. Keep saved business records intact. Do not delete vehicles, sales, cash, tax reports, backups, Deal Radar listings, OpenLane observations, or audit logs.
6. Use reviewed retention/delete controls only for eligible unsaved Deep Capture evidence.

## Final Go/No-Go

GO for automated test coverage, local build readiness, and documentation.

NO-GO for production private beta until live browser validation is completed against a real authenticated `https://app.openlane.ca/vdp/...` page and the deployed Vercel project has the exact extension origin configured.
