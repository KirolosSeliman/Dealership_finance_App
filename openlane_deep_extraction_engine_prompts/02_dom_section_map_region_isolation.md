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


# Phase 02 — DOM Section Map and Region Isolation

## Mission

Build a real section map so extraction does not read the entire OpenLane page as one blob.

## Root problem

OpenLane mixes vehicle content with sidebar navigation, footer, market guide, bid history, tabs, legal text, and dynamic panels.

## Consequences

Second order: sidebar caused `purchase_list`; market guide caused wrong title.  
Third order: valuation and capture storage receive wrong data.  
Fourth order: dataset reliability collapses at scale.

## Required solution

Add section mapping helpers:

- `buildOpenLaneSectionMap(doc, href)`
- `buildOpenLaneSectionMapFromHtml(html, href)`

Map zones:
- `vehicleHero`
- `gallery`
- `bidPanel`
- `vehicleSpecs`
- `transportBlock`
- `knownHistory`
- `disclosuresCondition`
- `dealerNotes`
- `qaSection`
- `marketGuide`
- `purchasePanel`
- `feeDetailsPanel`
- `postSalePanel`
- `sidebar`
- `footer`
- `unknownMain`

Use URL and bilingual markers:
- `/vdp/`, `tab=active`
- `Odometer`, `Odomètre`
- `Current bid`, `Offre actuelle`, `Enchère actuelle`
- `Disclosures and conditions`, `Divulgations et condition`
- `Note from selling dealer`, `Note du concessionnaire vendeur`
- `Purchases`, `Achats`
- `Fee details`, `Frais`, `Prix d'achat - enchère`

Sidebar/footer/market guide must be isolated and marked as ignored evidence unless explicitly needed.

## Acceptance criteria

- VDP pages are not classified as purchase pages because sidebar says `Purchases/Achats`.
- Market guide is not used as vehicle title.
- Dealer notes and disclosures are identifiable zones.
- Tests cover English and French VDP pages with noisy sidebars.


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
