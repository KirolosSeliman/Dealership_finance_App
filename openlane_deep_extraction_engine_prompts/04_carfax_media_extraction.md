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


# Phase 04 — Carfax URL and Media Extraction

## Mission

Make Carfax and media extraction truthful and ML-ready.

## Root problem

The widget can say Carfax is visible without extracting a URL, and photos may include icons/logos/placeholders.

## Consequences

Second order: data quality is overstated.  
Third order: image analysis wastes compute on junk assets.  
Fourth order: valuation confidence and future visual ML become unreliable.

## Required solution

Carfax output:
```js
carfax: {
  mentioned,
  available,
  url,
  urlStatus: "url_found" | "text_only" | "missing",
  evidence
}
```

Search for actual URL in:
- `a[href]`
- parent/sibling of CARFAX text
- `data-url`, `data-href`
- `aria-label`, `title`
- safe onclick text only, without execution

Do not fetch/open/pay/bypass Carfax.

Media:
- capture `img.src`, `currentSrc`, `srcset`, `data-src`, `data-original`, picture sources, gallery background images, video/source/iframe
- separate visible badge count from actual URLs
- reject OpenLane logo, `/vdp/null`, Google Translate icon, SVG UI assets, favicon/tiny UI assets
- prefer OpenLane/KAR media CDN vehicle photos
- cap arrays
- no base64 blobs

## Acceptance criteria

- Text-only Carfax yields `carfaxUrlStatus = "text_only"` and no fake URL.
- Real Carfax href yields `url_found`.
- Photos exclude logo/null/translate/icon junk.
- Visible gallery count is preserved even if not all URLs are loaded.


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
