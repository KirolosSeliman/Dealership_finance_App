export const DEEP_CAPTURE_CONSENT_VERSION = "deep-capture-consent-2026-05-16";
export const DEEP_CAPTURE_TERMS_VERSION = "deep-capture-terms-2026-05-16";
export const DEEP_CAPTURE_PRIVACY_VERSION = "deep-capture-privacy-2026-05-16";

export const DEEP_CAPTURE_LEGAL_REVIEW_NOTICE =
  "This is a product/legal draft and must be reviewed by qualified legal counsel before production rollout.";

export const authorizedBrowserDataCaptureTerms = {
  title: "Authorized Browser Data Capture",
  version: DEEP_CAPTURE_TERMS_VERSION,
  paragraphs: [
    "Dealer Flow Market Snap may help an authorized dealer capture vehicle, listing, auction, condition, media, pricing, fee, invoice, and provenance data that is visible to that dealer in their own authenticated browser session.",
    "Deep Capture Mode requires affirmative consent before it is enabled for an organization, user, or browser context. Basic visible-page Market Snap extraction may remain available, but Deep Capture must remain off until the current consent text is accepted. Consent can be withdrawn.",
    "Consent to use Dealer Flow does not authorize bypassing third-party platform protections, violating third-party terms, or accessing accounts, pages, reports, or systems the client is not authorized to access.",
    "Dealer Flow does not perform CAPTCHA bypass, anti-bot bypass, login bypass, proxy evasion, hidden request manipulation, credential harvesting, cookie capture, token capture, session token capture, or unauthorized private API access.",
    "The client confirms they are authorized to use Dealer Flow with the relevant third-party account/page and have the right to process the captured vehicle and listing data for business operations, valuation, inventory, Deal Radar, reporting, and separately enabled model improvement.",
  ],
};

export const marketSnapDeepCapturePrivacy = {
  title: "Market Snap and Deep Capture",
  version: DEEP_CAPTURE_PRIVACY_VERSION,
  dataCategories: [
    "Vehicle identity: VIN, year, make, model, trim, mileage, location, seller/source, and related visible identifiers.",
    "Listing economics: current bid, current offer, best offer, buy-now price, reserve, fees, taxes, invoice amounts, final acquisition cost, and post-sale amounts when visible.",
    "Condition: known history, disclosures, mechanical, structural, exterior, interior, tire/wheel, OBD2 status, dealer notes, and condition report text when visible.",
    "Media metadata: visible photo/video URLs, thumbnails, counts, dimensions, and source hints; unnecessary logos, icons, translate assets, data URLs, and unrelated images should be excluded.",
    "Evidence/provenance: source type, page type, capture kind, confidence, capped snippets, endpoint pattern, section map summary, rejected candidates, warning/missing-data lists, and capture timestamps.",
  ],
  paragraphs: [
    "Deep Capture reads visible page DOM, safe expanded read-only sections, visible JSON responses already loaded by the page, media URLs, condition/disclosure details, bid/offer observations, and post-sale or fee/invoice details when those details are visible to the authorized client.",
    "Dealer Flow stores captured data in Dealer Flow/Supabase for the organization and may process it through Dealer Flow services for valuation, reporting, Deal Radar, inventory workflows, and quality checks.",
    "Dealer Flow should not store authorization headers, cookies, passwords, CSRF tokens, JWTs, refresh tokens, session token values, or unrelated personal data. If buyer, client, or seller personal information appears in captured content, it should be redacted unless it is strictly necessary for a clearly disclosed Dealer Flow feature.",
    "Observations and capped evidence should be retention-limited. Saved Deal Radar and inventory records may be retained while the organization keeps those records.",
    "Model improvement is separate from ordinary capture. Active current bids are not training labels. Only verified outcomes, manual confirmations, accepted negotiations, invoices, or Dealer Flow sales should become model-improvement labels when model improvement is separately enabled.",
  ],
};

export const deepCaptureConsentDisclosure = {
  title: "Deep Capture Mode consent",
  version: DEEP_CAPTURE_CONSENT_VERSION,
  bullets: [
    "I confirm that I am authorized to use Dealer Flow with this third-party account, browser session, and page.",
    "I understand Deep Capture may process visible vehicle/listing/business data, safe read-only expanded sections, visible page-loaded JSON responses, media URLs, condition/disclosure details, bid/offer observations, and visible post-sale or fee/invoice details.",
    "I understand Deep Capture does not bypass CAPTCHA, anti-bot systems, login walls, access controls, paywalls, platform restrictions, or Carfax access limits.",
    "I understand Dealer Flow does not collect credentials, cookies, tokens, session token values, passwords, or authorization headers.",
    "I understand ordinary capture, Deep Capture, and model improvement are separate controls. Active current bids are not training labels.",
    "I understand consent can be withdrawn and that withdrawal should stop future Deep Capture after the setting is applied.",
  ],
};

export const captureLevelCopy = [
  {
    name: "Normal capture",
    description: "Reads visible listing fields needed for Market Snap analysis, such as vehicle identity, mileage, visible price fields, Carfax state, media counts, warnings, and missing data.",
  },
  {
    name: "Deep Capture Mode",
    description: "After affirmative consent, may include safe read-only section expansion, visible page-loaded JSON response summaries, richer condition/disclosure evidence, media URL metadata, bid/offer observations, and visible post-sale or fee/invoice details.",
  },
  {
    name: "Model improvement",
    description: "Separate opt-in that allows verified outcomes, manual confirmations, accepted negotiations, invoices, or Dealer Flow sales to help improve valuation quality. Active current bids are not labels.",
  },
];
