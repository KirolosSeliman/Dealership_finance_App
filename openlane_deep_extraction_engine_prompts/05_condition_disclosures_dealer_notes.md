# Dealer Flow — OpenLane Deep Extraction Engine

Repository: `KirolosSeliman/Dealership_finance_App`

Role: You are Codex acting as a senior browser-extension engineer, senior data extraction engineer, senior software engineer, senior data analyst, security reviewer, and production QA lead.

Mission boundary:
- This is a first-party, user-consented, authorized page-capture system.
- Capture only OpenLane data visible to the logged-in user on pages the user opens.
- Do not bypass login, CAPTCHA, paywalls, Carfax access, rate limits, anti-bot systems, or private APIs.
- Do not place bids, submit forms, comment, watch/unwatch, mark retrieved, order services, or trigger destructive actions.
- Do not store credentials, service-role keys, session tokens, or raw secrets.
- Do not weaken validation, RLS, role checks, or financial data integrity.
- Keep the code clean, efficient, deployable, and backward-compatible.

Phase rule:
Work on this phase only. Do not move to the next phase until this one is fully implemented, tested, and verified.


# Phase 05 — Condition, Disclosures, Known History, and Dealer Notes

## Mission

Extract structured condition and dealer information from OpenLane pages.

## Root problem

Critical condition text is visible but remains buried in rawVisibleText.

Examples:
- `Pare-Brise - Fissuré`
- `Moteur Requiert Réparations`
- `Travaux De Peinture Antérieurs`
- `Historique D’accidents Antécédents - Oui`
- `check engine light on`

## Consequences

Second order: risk and reconditioning signals are missed.  
Third order: vehicle can be overvalued.  
Fourth order: users may bid too high and ML learns weak features.

## Required solution

Extract bilingual sections:
- `Known history` / `Antécédents connus`
- `Disclosures and conditions` / `Divulgations et condition`
- `In relation to safety` / `En relation avec la sécurité`
- `Mechanical` / `Mécanique`
- `Exterior` / `Extérieur`
- `Interior` / `Intérieur`
- `Tires and wheels` / `Pneus et roues`
- `OBD2 Reader` / `Lecteur OBD2`
- `Note from selling dealer` / `Note du concessionnaire vendeur`
- `Q and A` / `Q et R`

Output:
```js
condition: {
  knownHistoryItems,
  safetyDisclosures,
  mechanicalDisclosures,
  exteriorDisclosures,
  interiorDisclosures,
  tireWheelDisclosures,
  obd2Status,
  dealerNotes,
  sellerBroadcasts,
  qaSummary,
  conditionReportText,
  evidence
}
```

Rules:
- preserve exact text but normalize whitespace
- keep “Nothing reported/Rien n’a été signalé” as negative evidence
- flag high-risk terms: engine, transmission, accident, cracked windshield, rust, structural, check engine, salvage, rebuilt
- do not invent OBD codes

## Acceptance criteria

- Structured fields include dealer notes and disclosures.
- `conditionReportText` includes useful risk summary.
- No false warning says condition text is missing when structured sections exist.


## Verification required before completion

Run:

```bash
npm run verify:extension
npm run verify:release
```

Both must pass. If not, fix the root cause and rerun.

## Required final report

Report:
1. Root cause fixed.
2. Files changed.
3. Tests and fixtures added/updated.
4. Security/privacy impact.
5. Regression risks checked.
6. Results of `npm run verify:extension`.
7. Results of `npm run verify:release`.
8. Remaining risks.
9. Whether it is safe to move to the next phase.

## Final self-check

Are you 100% confident in this strategy? If not, find all possible loopholes, suggest proper fixes, and run this loop until you are factually 100% confident in the new strategy.
