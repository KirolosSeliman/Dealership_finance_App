(function (root) {
  const RAW_TEXT_LIMIT = 12000;

  function classifyOpenLanePage(doc = document, href = location.href) {
    return classifyText(visibleText(doc), href, doc);
  }

  function classifyOpenLanePageFromHtml(html, href = "https://www.openlane.ca/") {
    return classifyText(stripTags(html), href, { images: imagePlaceholders(html) });
  }

  function classifyText(text, href, doc = {}) {
    const normalized = normalizeSpace(text).slice(0, RAW_TEXT_LIMIT);
    const evidence = [];
    const warnings = [];
    const url = safeUrl(href);
    const path = `${url.pathname} ${url.search}`.toLowerCase();

    addEvidence(evidence, "openlane_host", /openlane\./i.test(url.hostname), url.hostname);
    addEvidence(evidence, "vehicle_identity", /\bVIN\b|[A-HJ-NPR-Z0-9]{17}/i.test(normalized), snippet(normalized, /\bVIN\b|[A-HJ-NPR-Z0-9]{17}/i));
    addEvidence(evidence, "current_bid", /\b(current bid|bid history|time remaining)\b/i.test(normalized), snippet(normalized, /\b(current bid|bid history|time remaining)\b/i));
    addEvidence(evidence, "vehicle_header", /\b(19|20)\d{2}\b.+\b[A-Z][a-z]+/i.test(normalized), snippet(normalized, /\b(19|20)\d{2}\b[^\n]{0,120}/i));
    addEvidence(evidence, "vehicle_media", Number(doc.images?.length ?? 0) >= 2 || /\b(gallery|photos?|images?)\b/i.test(normalized), "visible gallery/media marker");
    addEvidence(evidence, "purchase_context", /\b(purchases?|open order|order history|purchase info|documents)\b/i.test(`${path} ${normalized}`), snippet(normalized, /\b(purchases?|open order|order history|purchase info|documents)\b/i));
    addEvidence(evidence, "fee_details", /\b(fee details|buy price\s*-\s*auction|transaction fee|vehicle history fee|taxes|total)\b/i.test(normalized), snippet(normalized, /\b(fee details|buy price\s*-\s*auction|transaction fee|vehicle history fee|taxes|total)\b/i));
    addEvidence(evidence, "post_sale", /\b(post sale|sold price|negotiat|counter offer|accepted|rejected)\b/i.test(`${path} ${normalized}`), snippet(normalized, /\b(post sale|sold price|negotiat|counter offer|accepted|rejected)\b/i));
    addEvidence(evidence, "accepted_outcome", /\b(accepted|seller accepted|paid|invoice|finalized)\b/i.test(normalized), snippet(normalized, /\b(accepted|seller accepted|paid|invoice|finalized)\b/i));
    addEvidence(evidence, "pending_outcome", /\b(pending|awaiting|counter offer|submitted|rejected)\b/i.test(normalized), snippet(normalized, /\b(pending|awaiting|counter offer|submitted|rejected)\b/i));

    let pageType = "unknown";
    let captureKind = "observation";
    let outcomeConfidence = "low";

    if (has(evidence, "fee_details")) {
      pageType = "fee_details";
      captureKind = has(evidence, "accepted_outcome") || /\b(total|taxes|buy price\s*-\s*auction)\b/i.test(normalized) ? "verified_outcome" : "candidate_outcome";
      outcomeConfidence = captureKind === "verified_outcome" ? "verified" : "high";
    } else if (has(evidence, "post_sale")) {
      pageType = "post_sale";
      captureKind = has(evidence, "accepted_outcome") ? "verified_outcome" : "candidate_outcome";
      outcomeConfidence = captureKind === "verified_outcome" ? "verified" : "medium";
    } else if (has(evidence, "purchase_context")) {
      pageType = /\b(open order|order history)\b/i.test(normalized)
        ? "purchase_list"
        : /\b(purchase info)\b/i.test(normalized) || /\/purchases?\/[^/\s]+/i.test(path) ? "purchase_detail" : "purchase_list";
      captureKind = "candidate_outcome";
      outcomeConfidence = "medium";
    } else if (has(evidence, "current_bid") && (has(evidence, "vehicle_identity") || has(evidence, "vehicle_header"))) {
      pageType = "active_listing";
      captureKind = "observation";
      outcomeConfidence = "low";
    }

    const confidenceScore = scoreClassification(pageType, evidence);
    if (pageType === "unknown") warnings.push("OpenLane page has not enough OpenLane page markers for automatic capture.");
    if (pageType === "active_listing") warnings.push("Current bid is an observation feature only, not a verified outcome label.");

    return compact({ sourceName: "OpenLane", pageType, captureKind, outcomeConfidence, confidenceScore, evidence, warnings });
  }

  function scoreClassification(pageType, evidence) {
    if (pageType === "unknown") return Math.min(35, evidence.length * 8);
    const base = pageType === "fee_details" ? 62 : pageType === "post_sale" ? 55 : pageType === "purchase_list" || pageType === "purchase_detail" ? 48 : 45;
    return Math.max(10, Math.min(98, base + evidence.length * 5));
  }

  function has(evidence, marker) {
    return evidence.some((item) => item.marker === marker);
  }

  function addEvidence(evidence, marker, present, sourceText) {
    if (!present) return;
    evidence.push(compact({ marker, sourceText: normalizeSpace(sourceText || "").slice(0, 240) }));
  }

  function visibleText(doc) {
    return normalizeSpace(doc.body?.innerText || doc.body?.textContent || "").slice(0, RAW_TEXT_LIMIT);
  }

  function stripTags(html) {
    return normalizeSpace(String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "\n"));
  }

  function imagePlaceholders(html) {
    return Array.from(String(html || "").matchAll(/<img\b/gi)).map(() => ({}));
  }

  function snippet(text, regex) {
    const match = text.match(regex);
    if (!match) return "";
    return text.slice(Math.max(0, match.index ?? 0), Math.max(0, match.index ?? 0) + 180);
  }

  function safeUrl(href) {
    try {
      return new URL(String(href || ""), "https://www.openlane.ca/");
    } catch {
      return new URL("https://www.openlane.ca/");
    }
  }

  function normalizeSpace(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function compact(object) {
    return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)));
  }

  const api = { classifyOpenLanePage, classifyOpenLanePageFromHtml };
  root.DealerFlowOpenLanePageClassifier = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
