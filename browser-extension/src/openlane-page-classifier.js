(function (root) {
  const RAW_TEXT_LIMIT = 12000;

  function classifyOpenLanePage(doc = document, href = location.href) {
    return classifyText(extractDocumentRegions(doc), href, doc);
  }

  function classifyOpenLanePageFromHtml(html, href = "https://www.openlane.ca/") {
    return classifyText(extractHtmlRegions(html), href, { images: imagePlaceholders(html) });
  }

  function classifyText(input, href, doc = {}) {
    const regions = typeof input === "string" ? { allText: normalizeSpace(input), mainText: normalizeSpace(input), sidebarText: "", footerText: "", ignoredEvidence: [] } : input;
    const mainText = normalizeSpace(regions.mainText || regions.allText).slice(0, RAW_TEXT_LIMIT);
    const sidebarText = normalizeSpace(regions.sidebarText || "");
    const evidence = [];
    const ignoredEvidence = [...(regions.ignoredEvidence || [])];
    const warnings = [];
    const url = safeUrl(href);
    const path = `${url.pathname} ${url.search}`.toLowerCase();
    const isVdpUrl = /\/vdp(?:\/|$)/i.test(url.pathname);

    addEvidence(evidence, "openlane_host", /openlane\./i.test(url.hostname), url.hostname);
    addEvidence(evidence, "vdp_url", isVdpUrl, url.pathname);
    addEvidence(evidence, "vehicle_identity", /\bVIN\b|[A-HJ-NPR-Z0-9]{17}/i.test(mainText), snippet(mainText, /\bVIN\b|[A-HJ-NPR-Z0-9]{17}/i));
    addEvidence(evidence, "current_bid", /\b(current bid|current offer|best offer|my offer|top bid|bid history|time remaining|offre actuelle|meilleure offre|mise actuelle)\b/i.test(mainText), snippet(mainText, /\b(current bid|current offer|best offer|my offer|top bid|bid history|time remaining|offre actuelle|meilleure offre|mise actuelle)\b/i));
    addEvidence(evidence, "vehicle_header", /\b(19|20)\d{2}\b.+\b[A-Z][a-z]+/i.test(mainText), snippet(mainText, /\b(19|20)\d{2}\b[^\n]{0,120}/i));
    addEvidence(evidence, "vehicle_media", Number(doc.images?.length ?? 0) >= 2 || /\b(gallery|photos?|images?|\d{1,3}\s+total)\b/i.test(mainText), "visible gallery/media marker");
    addEvidence(evidence, "purchase_context", /\b(purchases?|open order|order history|purchase info|documents)\b/i.test(mainText), snippet(mainText, /\b(purchases?|open order|order history|purchase info|documents)\b/i));
    addEvidence(evidence, "vdp_selling_price", isVdpUrl && /\border history\b[\s\S]{0,300}\bselling price\b/i.test(mainText), snippet(mainText, /\border history\b[\s\S]{0,300}\bselling price\b/i));
    addEvidence(evidence, "fee_details", /\b(fee details|buy price\s*-\s*auction|transaction fee|vehicle history fee|tax(?:es)?)\b/i.test(mainText), snippet(mainText, /\b(fee details|buy price\s*-\s*auction|transaction fee|vehicle history fee|tax(?:es)?)\b/i));
    addEvidence(evidence, "post_sale", /\b(post sale|sold price|negotiat|counter offer|accepted|rejected)\b/i.test(`${path} ${mainText}`), snippet(mainText, /\b(post sale|sold price|negotiat|counter offer|accepted|rejected)\b/i));
    addEvidence(evidence, "accepted_outcome", hasAcceptedOutcomeEvidence(mainText), snippet(mainText, /\b(status\s+accepted|accepted amount|seller accepted|paid|invoice|finalized|completed|purchase confirmed|retrieved)\b/i));
    addEvidence(evidence, "pending_outcome", /\b(pending|awaiting|counter offer|submitted|rejected)\b/i.test(mainText), snippet(mainText, /\b(pending|awaiting|counter offer|submitted|rejected)\b/i));

    if (/\bPURCHASE\b[\s\S]{0,120}\b(Browse|On hold|Closing|Purchases)\b/i.test(sidebarText)) {
      ignoredEvidence.push({ marker: "sidebar_purchase_navigation", sourceText: snippet(sidebarText, /\bPURCHASE\b[\s\S]{0,160}/i) || sidebarText.slice(0, 180) });
    }

    let pageType = "unknown";
    let captureKind = "observation";
    let outcomeConfidence = "low";
    let decisiveEvidence = [];

    if (has(evidence, "fee_details")) {
      pageType = "fee_details";
      captureKind = has(evidence, "accepted_outcome") || /\b(total|taxes|buy price\s*-\s*auction)\b/i.test(mainText) ? "verified_outcome" : "candidate_outcome";
      outcomeConfidence = captureKind === "verified_outcome" ? "verified" : "high";
      decisiveEvidence = evidence.filter((item) => ["fee_details", "accepted_outcome"].includes(item.marker));
    } else if (has(evidence, "post_sale") && !has(evidence, "vdp_selling_price")) {
      pageType = "post_sale";
      captureKind = has(evidence, "accepted_outcome") ? "verified_outcome" : "candidate_outcome";
      outcomeConfidence = captureKind === "verified_outcome" ? "verified" : "medium";
      decisiveEvidence = evidence.filter((item) => ["post_sale", "accepted_outcome", "pending_outcome"].includes(item.marker));
    } else if (has(evidence, "vdp_selling_price")) {
      pageType = "purchase_detail";
      captureKind = has(evidence, "accepted_outcome") ? "verified_outcome" : "candidate_outcome";
      outcomeConfidence = has(evidence, "accepted_outcome") ? "verified" : "high";
      decisiveEvidence = evidence.filter((item) => ["vdp_url", "vdp_selling_price", "accepted_outcome", "vehicle_identity", "vehicle_header"].includes(item.marker));
    } else if (isVdpUrl && (has(evidence, "current_bid") || has(evidence, "vehicle_identity") || has(evidence, "vehicle_header"))) {
      pageType = "active_listing";
      captureKind = "observation";
      outcomeConfidence = "low";
      decisiveEvidence = evidence.filter((item) => ["vdp_url", "current_bid", "vehicle_identity", "vehicle_header"].includes(item.marker));
    } else if (isPurchaseList(path, mainText)) {
      pageType = /\/purchases?(?:$|\s|[?#])/i.test(path) ? "purchase_list" : /\/purchases?\/[^/\s]+/i.test(path) || /\b(order details)\b/i.test(mainText) ? "purchase_detail" : "purchase_list";
      captureKind = "candidate_outcome";
      outcomeConfidence = "medium";
      decisiveEvidence = evidence.filter((item) => item.marker === "purchase_context");
    } else if (has(evidence, "current_bid") && (has(evidence, "vehicle_identity") || has(evidence, "vehicle_header"))) {
      pageType = "active_listing";
      captureKind = "observation";
      outcomeConfidence = "low";
      decisiveEvidence = evidence.filter((item) => ["current_bid", "vehicle_identity", "vehicle_header"].includes(item.marker));
    }

    const confidenceScore = scoreClassification(pageType, evidence, Boolean(decisiveEvidence.length));
    if (pageType === "unknown") warnings.push("OpenLane page has not enough OpenLane page markers for automatic capture.");
    if (pageType === "active_listing") warnings.push("Current bid is an observation feature only, not a verified outcome label.");

    return compact({
      sourceName: "OpenLane",
      pageType,
      captureKind,
      outcomeConfidence,
      confidenceScore,
      evidence,
      decisiveEvidence,
      ignoredEvidence,
      mainTextSample: mainText.slice(0, 800),
      warnings,
    });
  }

  function isPurchaseList(path, mainText) {
    if (/\/purchases?(?:\/?$|[?#])/i.test(path)) return true;
    if (/\b(purchases|order history)\b/i.test(mainText) && /\b(vehicle|vin|year|make|model|selling price|status)\b/i.test(mainText)) return true;
    return false;
  }

  function scoreClassification(pageType, evidence, hasDecisiveEvidence) {
    if (pageType === "unknown") return Math.min(35, evidence.length * 8);
    const base = pageType === "fee_details" ? 62 : pageType === "post_sale" ? 55 : pageType === "purchase_list" || pageType === "purchase_detail" ? 52 : 45;
    return Math.max(10, Math.min(98, base + evidence.length * 5 + (hasDecisiveEvidence ? 8 : 0)));
  }

  function hasAcceptedOutcomeEvidence(text) {
    if (/\b(no|not|without)\s+accepted\b/i.test(text)) return false;
    return /\b(status\s+accepted|accepted amount|seller accepted|paid|invoice|finalized|completed|purchase confirmed|retrieved)\b/i.test(text);
  }

  function extractDocumentRegions(doc) {
    if (doc.__openlaneTextRegions) return doc.__openlaneTextRegions;
    const sectionMap = root.DealerFlowOpenLaneSectionMap?.buildOpenLaneSectionMap?.(doc);
    if (sectionMap) return root.DealerFlowOpenLaneSectionMap.regionsFromMap(sectionMap);
    const sidebarText = textFromNodes(doc.querySelectorAll?.("aside, nav, [class*='sidebar' i], [class*='navigation' i]") || []);
    const footerText = textFromNodes(doc.querySelectorAll?.("footer, [class*='footer' i], [class*='legal' i]") || []);
    const marketGuideText = textFromNodes(doc.querySelectorAll?.("[class*='market' i], [class*='sales-history' i], [data-testid*='sales-history' i]") || []);
    const mainNodes = doc.querySelectorAll?.("main, [data-testid*='vehicle' i], [class*='vdp' i], [class*='vehicle' i]") || [];
    const mainText = textFromNodes(mainNodes) || visibleText(doc);
    const allText = visibleText(doc);
    const ignoredEvidence = [];
    if (sidebarText) ignoredEvidence.push({ marker: "sidebar_text", sourceText: sidebarText.slice(0, 240) });
    if (footerText) ignoredEvidence.push({ marker: "footer_text", sourceText: footerText.slice(0, 240) });
    if (marketGuideText) ignoredEvidence.push({ marker: "market_guide_text", sourceText: marketGuideText.slice(0, 240) });
    return { allText, mainText: removeKnownNoise(mainText, [sidebarText, footerText]), sidebarText, footerText, marketGuideText, ignoredEvidence };
  }

  function extractHtmlRegions(html) {
    const sectionMap = root.DealerFlowOpenLaneSectionMap?.buildOpenLaneSectionMapFromHtml?.(html);
    if (sectionMap) return root.DealerFlowOpenLaneSectionMap.regionsFromMap(sectionMap);
    const source = String(html || "");
    const sidebarText = stripTags(matchesHtml(source, /<(aside|nav)\b[\s\S]*?<\/\1>/gi).join("\n"));
    const footerText = stripTags(matchesHtml(source, /<footer\b[\s\S]*?<\/footer>/gi).join("\n"));
    const marketGuideText = stripTags(matchesHtml(source, /<section\b[^>]*(?:market-guide|sales-history)[^>]*>[\s\S]*?<\/section>/gi).join("\n"));
    const mainHtml = matchesHtml(source, /<main\b[\s\S]*?<\/main>/gi).join("\n") || source;
    const allText = `${stripTags(source)}\n${extractAttributeText(source)}`;
    const mainText = `${stripTags(removeHtmlBlocks(mainHtml, [/<section\b[^>]*(?:market-guide|sales-history)[^>]*>[\s\S]*?<\/section>/gi]))}\n${extractAttributeText(mainHtml)}`;
    const ignoredEvidence = [];
    if (sidebarText) ignoredEvidence.push({ marker: "sidebar_text", sourceText: sidebarText.slice(0, 240) });
    if (footerText) ignoredEvidence.push({ marker: "footer_text", sourceText: footerText.slice(0, 240) });
    if (marketGuideText) ignoredEvidence.push({ marker: "market_guide_text", sourceText: marketGuideText.slice(0, 240) });
    return { allText, mainText, sidebarText, footerText, marketGuideText, ignoredEvidence };
  }

  function textFromNodes(nodes) {
    return normalizeSpace(Array.from(nodes || []).map((node) => node.innerText || node.textContent || "").join("\n"));
  }

  function removeKnownNoise(text, snippets) {
    let result = String(text || "");
    for (const snippetText of snippets.filter(Boolean)) {
      result = result.replace(snippetText, " ");
    }
    return normalizeSpace(result);
  }

  function removeHtmlBlocks(html, patterns) {
    return patterns.reduce((result, pattern) => result.replace(pattern, " "), String(html || ""));
  }

  function matchesHtml(html, regex) {
    return Array.from(String(html || "").matchAll(regex)).map((match) => match[0]);
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

  function extractAttributeText(html) {
    return Array.from(String(html || "").matchAll(/\s(?:aria-label|data-[a-z0-9_-]+|title|alt)=["']([^"']+)["']/gi))
      .map((match) => match[1])
      .join("\n");
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

  const api = { classifyOpenLanePage, classifyOpenLanePageFromHtml, extractDocumentRegions, extractHtmlRegions };
  root.DealerFlowOpenLanePageClassifier = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
