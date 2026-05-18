# Dealer Flow Deep Capture — Phase Prompt Index

This package contains phase-by-phase Codex mega prompts for implementing consent-based Deep Capture in the Dealer Flow Market Snap browser extension and backend.

## Important design decision

The requested “on by default” behavior is implemented safely as:

- Deep Capture is OFF until explicit consent is accepted.
- After an authorized user/admin accepts the current Deep Capture consent, Deep Capture may remain ON by default for that consenting organization/user/browser context until withdrawal.
- This avoids silent collection before consent while still giving the operational default behavior requested after consent.

## Files

1. `phase_01_terms_privacy_consent_policy.md`
2. `phase_02_consent_data_model_audit_trail.md`
3. `phase_03_extension_consent_gate_settings.md`
4. `phase_04_deep_network_capture_engine.md`
5. `phase_05_extraction_evidence_confidence_contract.md`
6. `phase_06_backend_persistence_retention_training_guards.md`
7. `phase_07_client_admin_controls_withdrawal_export_delete.md`
8. `phase_08_testing_security_deployment_release.md`

## Recommended execution order

Run the phases in order. Do not ask Codex to implement all phases in one prompt. Each phase should be its own Codex task/branch/commit or at minimum a separate commit.

## Non-negotiable safety line

Consent can authorize Dealer Flow to process data the client is already authorized to access. It does not authorize bypassing CAPTCHA, anti-bot systems, authentication, access controls, third-party restrictions, or hidden private APIs.
