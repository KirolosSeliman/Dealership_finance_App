(function (root) {
  const RAW_TEXT_LIMIT = 12000;
  const ZONE_ORDER = [
    "vehicleHero",
    "gallery",
    "bidPanel",
    "vehicleSpecs",
    "transportBlock",
    "knownHistory",
    "disclosuresCondition",
    "dealerNotes",
    "qaSection",
    "purchasePanel",
    "feeDetailsPanel",
    "postSalePanel",
    "unknownMain",
    "marketGuide",
    "sidebar",
    "footer",
  ];

  const ZONES = {
    vehicleHero: {
      selectors: ["[class*='vehicle-hero' i]", "[class*='vehicle-header' i]", "[class*='vdp-hero' i]", "[class*='vdp-header' i]", "[data-testid*='vehicle-hero' i]", "h1"],
      attr: ["vehicle-hero", "vehicle-header", "vehicle-title", "vdp-hero", "vdp-header"],
      markers: [/\b(19|20)\d{2}\b[^\n]{2,100}\b[A-Za-z][A-Za-z-]+/i, /\b(VIN|NIV)\b\s*[A-HJ-NPR-Z0-9]{17}/i],
    },
    gallery: {
      selectors: ["[class*='gallery' i]", "[class*='carousel' i]", "[class*='photo' i]", "[class*='media' i]", "[data-testid*='gallery' i]"],
      attr: ["gallery", "carousel", "photo", "media"],
      markers: [/\b\d{1,3}\s+total\b/i, /\b(photo|photos|video|videos)\b/i],
    },
    bidPanel: {
      selectors: ["[class*='bid' i]", "[class*='offer' i]", "[class*='auction-panel' i]", "[data-testid*='bid' i]", "[data-testid*='offer' i]"],
      attr: ["bid-panel", "auction-panel", "offer-panel", "bid", "offer"],
      markers: [/\b(current bid|current offer|best offer|my offer|top bid|offre actuelle|meilleure offre|mise actuelle|enchere actuelle|ench\u00e8re actuelle)\b/i],
    },
    vehicleSpecs: {
      selectors: ["[class*='spec' i]", "[class*='detail' i]", "[data-testid*='spec' i]"],
      attr: ["vehicle-spec", "specification", "vehicle-detail"],
      markers: [/\b(odometer|odom\u00e8tre|mileage|kilometers|kilometres|transmission|drivetrain|engine|moteur)\b/i],
    },
    transportBlock: {
      selectors: ["[class*='transport' i]", "[data-testid*='transport' i]"],
      attr: ["transport", "pickup", "delivery"],
      markers: [/\b(transport|pickup|delivery|ramassage|livraison)\b/i],
    },
    knownHistory: {
      selectors: ["[class*='history' i]", "[class*='carfax' i]", "[data-testid*='history' i]"],
      attr: ["known-history", "vehicle-history", "carfax"],
      markers: [/\b(known history|vehicle history|historique|carfax)\b/i],
    },
    disclosuresCondition: {
      selectors: ["[class*='disclosure' i]", "[class*='condition' i]", "[class*='announcement' i]", "[data-testid*='condition' i]"],
      attr: ["disclosure", "condition", "announcement", "damage", "mechanical", "structural"],
      markers: [/\b(disclosures? and conditions?|disclosures?|condition report|announcements?|damage|mechanical|structural|divulgations? et condition|divulgations?|rapport de condition)\b/i],
    },
    dealerNotes: {
      selectors: ["[class*='dealer-note' i]", "[class*='seller-note' i]", "[data-testid*='dealer-note' i]"],
      attr: ["dealer-note", "seller-note", "selling-dealer-note"],
      markers: [/\b(note from selling dealer|seller notes?|dealer notes?|note du concessionnaire vendeur|notes? du vendeur)\b/i],
    },
    qaSection: {
      selectors: ["[class*='question' i]", "[class*='answer' i]", "[class*='qa' i]", "[data-testid*='qa' i]"],
      attr: ["question", "answer", "qa-section", "q-and-a"],
      markers: [/\b(questions? and answers?|q&a|questions?|answers?|r\u00e9ponses?)\b/i],
    },
    marketGuide: {
      selectors: ["[class*='market-guide' i]", "[class*='sales-history' i]", "[class*='market-overview' i]", "[data-testid*='sales-history' i]"],
      attr: ["market-guide", "sales-history", "market-overview", "wholesale-sales-data"],
      markers: [/\b(sales history of similar vehicles|market overview|openlane wholesale sales data|subscribe now|historique des ventes|aper\u00e7u du march\u00e9)\b/i],
      ignored: true,
    },
    purchasePanel: {
      selectors: ["[class*='purchase' i]", "[class*='order-history' i]", "[data-testid*='purchase' i]"],
      attr: ["purchase", "order-history", "open-order"],
      markers: [
        /\b(purchases?|order history|selling price|mark retrieved|achats?|historique des commandes|prix de vente)\b/i,
        /\b(order history|purchases?|purchase details?)[\s\S]{0,500}\b(sold price|selling price|mark as picked up|picked up|purchase complete|purchased|paid|invoice|full bid history)\b/i,
        /\b(mark as picked up|picked up|purchase complete|purchase confirmed)\b/i,
      ],
    },
    feeDetailsPanel: {
      selectors: ["[class*='fee' i]", "[class*='invoice' i]", "[data-testid*='fee' i]"],
      attr: ["fee-details", "invoice", "fees"],
      markers: [/\b(fee details|buy price\s*-\s*auction|transaction fee|vehicle history fee|total invoice|frais|prix d'achat\s*-\s*ench\u00e8re)\b/i],
    },
    postSalePanel: {
      selectors: ["[class*='post-sale' i]", "[class*='negotiation' i]", "[data-testid*='post-sale' i]"],
      attr: ["post-sale", "negotiation", "counter-offer"],
      markers: [/\b(post sale|sold price|counter offer|accepted amount|seller accepted|rejected|apr\u00e8s-vente|contre-offre|accept\u00e9)\b/i],
    },
    sidebar: {
      selectors: ["aside", "nav", "[class*='sidebar' i]", "[class*='navigation' i]"],
      attr: ["sidebar", "navigation", "side-nav"],
      markers: [/\b(PURCHASE|ACHATS)\b[\s\S]{0,160}\b(Browse|Parcourir|On hold|En attente|Closing|Fermeture|Purchases|Achats)\b/i],
      ignored: true,
    },
    footer: {
      selectors: ["footer", "[class*='footer' i]", "[class*='legal' i]"],
      attr: ["footer", "legal"],
      markers: [/\b(legal footer|privacy|terms|texte l\u00e9gal|conditions d'utilisation)\b/i],
      ignored: true,
    },
  };

  function buildOpenLaneSectionMap(doc = document, href = safeHref()) {
    if (doc.__openlaneSectionMap) return doc.__openlaneSectionMap;
    const allText = visibleText(doc);
    const mainRaw = textFromNodes(doc.querySelectorAll?.("main, [class*='vdp' i], [data-testid*='vehicle-detail' i]") || []) || allText;
    const zones = {};

    for (const zoneName of ZONE_ORDER.filter((name) => name !== "unknownMain")) {
      const spec = ZONES[zoneName];
      zones[zoneName] = buildDomZone(doc, zoneName, spec, allText);
    }

    const ignoredTexts = ignoredZoneTexts(zones);
    const unknownMain = removeKnownNoise(mainRaw, ignoredTexts).slice(0, RAW_TEXT_LIMIT);
    zones.unknownMain = zone("unknownMain", unknownMain, [], false);
    const mainText = normalizeSpace(unknownMain || nonIgnoredZoneText(zones)).slice(0, RAW_TEXT_LIMIT);
    const map = compactMap({ href, isVdpUrl: isVdpUrl(href), allText, mainText, ignoredEvidence: ignoredEvidence(zones), zones, summary: summarizeZones(zones) });
    doc.__openlaneSectionMap = map;
    doc.__openlaneTextRegions = regionsFromMap(map);
    return map;
  }

  function clearOpenLaneExtractionCache(doc = document) {
    if (!doc || typeof doc !== "object") return;
    try {
      delete doc.__openlaneSectionMap;
      delete doc.__openlaneTextRegions;
      delete doc.__openlaneMediaRejected;
    } catch {
      doc.__openlaneSectionMap = undefined;
      doc.__openlaneTextRegions = undefined;
      doc.__openlaneMediaRejected = undefined;
    }
  }

  function buildOpenLaneSectionMapFromHtml(html = "", href = "https://www.openlane.ca/") {
    const source = String(html || "");
    const allText = normalizeSpace(`${stripTags(source)}\n${extractAttributeText(source)}`).slice(0, RAW_TEXT_LIMIT);
    const mainHtml = matchesHtml(source, /<main\b[\s\S]*?<\/main>/gi).join("\n") || source;
    const zones = {};

    for (const zoneName of ZONE_ORDER.filter((name) => name !== "unknownMain")) {
      const spec = ZONES[zoneName];
      zones[zoneName] = buildHtmlZone(source, zoneName, spec, allText);
    }

    const ignoredBlocks = [
      /<(aside|nav)\b[\s\S]*?<\/\1>/gi,
      /<footer\b[\s\S]*?<\/footer>/gi,
      /<(section|div)\b[^>]*(?:market-guide|sales-history|market-overview)[^>]*>[\s\S]*?<\/\1>/gi,
    ];
    const mainWithoutIgnored = removeHtmlBlocks(mainHtml, ignoredBlocks);
    const mainRaw = normalizeSpace(`${stripTags(mainWithoutIgnored)}\n${extractAttributeText(mainWithoutIgnored)}`);
    const unknownMain = removeKnownNoise(mainRaw, ignoredZoneTexts(zones)).slice(0, RAW_TEXT_LIMIT);
    zones.unknownMain = zone("unknownMain", unknownMain, [], false);
    const mainText = normalizeSpace(unknownMain || nonIgnoredZoneText(zones)).slice(0, RAW_TEXT_LIMIT);

    return compactMap({ href, isVdpUrl: isVdpUrl(href), allText, mainText, ignoredEvidence: ignoredEvidence(zones), zones, summary: summarizeZones(zones) });
  }

  function buildDomZone(doc, zoneName, spec = {}, allText = "") {
    const selectorText = textFromNodes(queryAll(doc, spec.selectors || []));
    const markerText = textAroundMarkers(allText, spec.markers || []);
    const text = combineText([selectorText, markerText]);
    return zone(zoneName, text, evidenceFor(zoneName, text, selectorText ? "selector" : markerText ? "marker" : ""), Boolean(spec.ignored));
  }

  function buildHtmlZone(source, zoneName, spec = {}, allText = "") {
    const attrText = stripTags(blocksByAttr(source, spec.attr || []).join("\n"));
    const markerText = textAroundMarkers(allText, spec.markers || []);
    const text = combineText([attrText, markerText]);
    return zone(zoneName, text, evidenceFor(zoneName, text, attrText ? "attribute" : markerText ? "marker" : ""), Boolean(spec.ignored));
  }

  function zone(name, text, evidence = [], ignored = false) {
    return { name, text: normalizeSpace(text).slice(0, RAW_TEXT_LIMIT), ignored, evidence };
  }

  function queryAll(doc, selectors) {
    const nodes = [];
    for (const selector of selectors || []) {
      try {
        nodes.push(...Array.from(doc.querySelectorAll?.(selector) || []));
      } catch {
        // Ignore unsupported selectors in older browser contexts.
      }
    }
    return dedupeNodes(nodes);
  }

  function blocksByAttr(html, keywords) {
    if (!keywords.length) return [];
    const keywordPattern = keywords.map(escapeRegExp).join("|");
    const regex = new RegExp(`<([a-z][a-z0-9-]*)\\b(?=[^>]*(?:class|id|data-testid|aria-label)=["'][^"']*(?:${keywordPattern})[^"']*["'])[^>]*>[\\s\\S]*?<\\/\\1>`, "gi");
    return matchesHtml(html, regex);
  }

  function textAroundMarkers(text, markers) {
    const snippets = [];
    for (const marker of markers || []) {
      const match = String(text || "").match(marker);
      if (!match) continue;
      const index = Math.max(0, match.index || 0);
      snippets.push(String(text || "").slice(Math.max(0, index - 180), index + 900));
    }
    return normalizeSpace(snippets.join("\n"));
  }

  function ignoredZoneTexts(zones) {
    return Object.values(zones || {}).filter((item) => item?.ignored).map((item) => item.text).filter(Boolean);
  }

  function ignoredEvidence(zones) {
    return Object.values(zones || {})
      .filter((item) => item?.ignored && item.text)
      .map((item) => ({ marker: `${item.name}_text`, zone: item.name, sourceText: item.text.slice(0, 240) }));
  }

  function summarizeZones(zones) {
    return Object.fromEntries(Object.entries(zones || {}).map(([name, item]) => [name, { textLength: item.text?.length || 0, ignored: Boolean(item.ignored) }]));
  }

  function nonIgnoredZoneText(zones) {
    return ZONE_ORDER.map((name) => zones[name]).filter((item) => item && !item.ignored).map((item) => item.text).filter(Boolean).join("\n");
  }

  function evidenceFor(zoneName, text, source) {
    if (!text || !source) return [];
    return [{ marker: `${zoneName}_zone`, source, sourceText: text.slice(0, 240) }];
  }

  function regionsFromMap(map) {
    return {
      allText: map.allText,
      mainText: map.mainText,
      sidebarText: map.zones?.sidebar?.text || "",
      footerText: map.zones?.footer?.text || "",
      marketGuideText: map.zones?.marketGuide?.text || "",
      ignoredEvidence: map.ignoredEvidence || [],
      sectionMap: map,
    };
  }

  function compactMap(map) {
    return {
      ...map,
      zones: Object.fromEntries(ZONE_ORDER.map((name) => [name, map.zones[name] || zone(name, "", [], Boolean(ZONES[name]?.ignored))])),
    };
  }

  function visibleText(doc) {
    return normalizeSpace(doc.body?.innerText || doc.body?.textContent || "").slice(0, RAW_TEXT_LIMIT);
  }

  function textFromNodes(nodes) {
    return normalizeSpace(dedupeNodes(nodes).map((node) => node.innerText || node.textContent || "").join("\n"));
  }

  function dedupeNodes(nodes) {
    return Array.from(new Set(Array.from(nodes || []).filter(Boolean)));
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

  function stripTags(html) {
    return normalizeSpace(String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "\n"));
  }

  function extractAttributeText(html) {
    return Array.from(String(html || "").matchAll(/\s(?:aria-label|data-[a-z0-9_-]+|title|alt)=["']([^"']+)["']/gi))
      .map((match) => match[1])
      .join("\n");
  }

  function combineText(parts) {
    const seen = new Set();
    return normalizeSpace(parts.flatMap((part) => String(part || "").split("\n")).filter((line) => {
      const clean = normalizeSpace(line);
      if (!clean || seen.has(clean)) return false;
      seen.add(clean);
      return true;
    }).join("\n"));
  }

  function isVdpUrl(href) {
    try {
      return /\/vdp(?:\/|$)/i.test(new URL(String(href || ""), "https://www.openlane.ca/").pathname);
    } catch {
      return false;
    }
  }

  function safeHref() {
    return root.location?.href || "https://www.openlane.ca/";
  }

  function normalizeSpace(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const api = { buildOpenLaneSectionMap, buildOpenLaneSectionMapFromHtml, regionsFromMap, clearOpenLaneExtractionCache };
  root.DealerFlowOpenLaneSectionMap = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
