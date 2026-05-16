(function (root) {
  const SENSITIVE_KEY_PATTERN = [
    ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_"),
    ["service", "role", "key"].join("_"),
    ["session", "token"].join("_"),
    ["access", "token"].join("_"),
    ["refresh", "token"].join("_"),
    ["id", "token"].join("_"),
    "password",
    "secret",
  ].join("|");
  const SECRET_PATTERNS = [
    new RegExp(`\\b(${SENSITIVE_KEY_PATTERN})\\b\\s*[:=]?\\s*[^\\s"'<>]+`, "gi"),
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
    /\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{16,}\b/g,
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ];

  function applyOpenLaneExtractionContract(listing = {}) {
    const safeListing = sanitizeExtractionValue(listing);
    const structured = buildOpenLaneExtractionContract(safeListing);
    const fieldEvidence = buildFieldEvidence(safeListing, structured);
    return compact({
      ...safeListing,
      ...structured,
      fieldEvidence,
      debug: compact({
        ...(structured.debug || {}),
        fieldEvidenceSummary: summarizeFieldEvidence(fieldEvidence),
      }),
      openlaneMetadata: {
        ...(safeListing.openlaneMetadata || {}),
        extractionContractVersion: "openlane-deep-v1",
      },
    });
  }

  function buildOpenLaneExtractionContract(listing = {}) {
    const classification = listing.openlaneMetadata?.classification || listing.extractedFields?.classification || {};
    const debug = listing.extractedFields?.debug || {};
    const mediaFiltering = listing.openlaneMetadata?.mediaFiltering || {};
    const conditionDetails = listing.openlaneMetadata?.conditionDetails || {};
    return {
      pageContext: compact({
        pageType: listing.pageType,
        captureKind: listing.captureKind,
        outcomeConfidence: listing.outcomeConfidence,
        language: detectLanguage(listing.rawVisibleText || listing.description || ""),
        urlPattern: urlPattern(listing.listingUrl),
        decisiveEvidence: classification.decisiveEvidence || debug.decisiveEvidence || [],
        ignoredEvidence: classification.ignoredEvidence || debug.ignoredEvidence || [],
        evidence: classification.evidence || [],
      }),
      identity: compact({
        vin: listing.vin,
        year: listing.year,
        make: listing.make,
        model: listing.model,
        trim: listing.trim,
        mileageKm: listing.mileageKm,
        confidence: identityConfidence(listing),
        evidence: [
          listing.extractedFields?.vinEvidence,
          listing.extractedFields?.mileageEvidence,
          ...(debug.titleCandidates || []).slice(0, 4),
        ].filter(Boolean),
      }),
      auctionObservation: compact({
        currentBid: listing.currentBid,
        currentOffer: listing.currentOffer,
        bestOffer: listing.bestOffer,
        buyNowPrice: listing.buyNowPrice,
        bidCount: listing.openlaneMetadata?.bidCount,
        offerCount: listing.openlaneMetadata?.offerCount,
        timeRemaining: listing.openlaneMetadata?.timeRemaining,
        evidence: observationEvidence(listing, debug),
      }),
      purchaseOutcome: compact({
        buyPriceAuction: listing.buyPriceAuction,
        soldPriceCandidate: listing.soldPriceCandidate,
        acceptedAmount: listing.acceptedAmount,
        negotiatedAmount: listing.negotiatedAmount,
        finalBidAmount: listing.finalBidAmount,
        transactionFee: listing.transactionFee,
        taxes: listing.taxes,
        totalInvoiceAmount: listing.totalInvoiceAmount,
        finalAcquisitionCost: listing.finalAcquisitionCost,
        evidence: listing.outcomeEvidence || [],
      }),
      condition: compact({
        knownHistoryItems: conditionDetails.knownHistoryItems || listing.declarations,
        safetyDisclosures: conditionDetails.safetyDisclosures || listing.safetyDisclosures || listing.structuralAnnouncements,
        mechanicalDisclosures: conditionDetails.mechanicalDisclosures || listing.mechanicalAnnouncements,
        exteriorDisclosures: conditionDetails.exteriorDisclosures || listing.damageAnnouncements,
        interiorDisclosures: conditionDetails.interiorDisclosures || listing.interiorAnnouncements,
        tireWheelDisclosures: conditionDetails.tireWheelDisclosures || (listing.tireCondition ? [listing.tireCondition] : undefined),
        obd2Status: conditionDetails.obd2Status || (listing.diagnosticFeatures?.diagnosticCodesAvailable === true ? "available" : listing.diagnosticFeatures?.diagnosticCodesAvailable === false ? "not_visible" : undefined),
        dealerNotes: conditionDetails.dealerNotes || listing.openlaneMetadata?.dealerNotes,
        sellerBroadcasts: conditionDetails.sellerBroadcasts,
        qaSummary: conditionDetails.qaSummary,
        highRiskTerms: conditionDetails.highRiskTerms,
        conditionReportText: conditionDetails.conditionReportText || listing.conditionReportText,
        evidence: conditionDetails.evidence || [
          listing.conditionReportText ? { source: "condition_report_text", sourceText: listing.conditionReportText.slice(0, 1000) } : undefined,
          ...(listing.declarations || []).slice(0, 10).map((item) => ({ source: "declarations", sourceText: item })),
        ].filter(Boolean),
      }),
      media: compact({
        photoCountVisible: listing.imageCount,
        videoCountVisible: listing.videoCount,
        photos: listing.photos || [],
        videos: listing.videos || [],
        rejectedMedia: mediaFiltering.rejected || debug.mediaRejected || [],
        evidence: [listing.openlaneMetadata?.mediaCountEvidence].filter(Boolean),
      }),
      carfax: compact({
        mentioned: listing.carfaxMentioned,
        available: listing.carfaxAvailable,
        url: listing.carfaxUrl,
        urlStatus: listing.carfaxUrlStatus || (listing.carfaxUrl ? "url_found" : listing.carfaxAvailable ? "text_only" : "missing"),
        evidence: carfaxEvidence(listing),
      }),
      debug: compact({
        sectionMapSummary: listing.openlaneMetadata?.sectionMapSummary || listing.openlaneMetadata?.textRegions || classification.mainTextSample ? {
          ...(listing.openlaneMetadata?.sectionMapSummary || {}),
          mainTextSample: listing.openlaneMetadata?.textRegions?.mainTextSample || classification.mainTextSample,
          ignoredSidebarSample: listing.openlaneMetadata?.textRegions?.ignoredSidebarSample,
          ignoredFooterSample: listing.openlaneMetadata?.textRegions?.ignoredFooterSample,
          ignoredMarketGuideSample: listing.openlaneMetadata?.textRegions?.ignoredMarketGuideSample,
        } : undefined,
        candidateScores: debug.candidateScores || [],
        rejectedCandidates: [
          ...(debug.titleCandidates || []).filter((candidate) => candidate.rejectedReason),
          ...(debug.mediaRejected || []),
        ],
        warnings: listing.warnings || [],
      }),
    };
  }

  function buildFieldEvidence(listing, structured) {
    const evidence = {};
    const consentId = listing.deepCaptureConsentId;
    const pageType = listing.pageType;
    const captureKind = listing.captureKind;
    const capturedAt = listing.capturedAt || new Date().toISOString();

    for (const field of [
      "vin",
      "year",
      "make",
      "model",
      "trim",
      "mileageKm",
      "currentBid",
      "currentOffer",
      "bestOffer",
      "buyNowPrice",
      "soldPriceCandidate",
      "acceptedAmount",
      "finalBidAmount",
      "buyPriceAuction",
      "totalInvoiceAmount",
      "finalAcquisitionCost",
      "carfaxUrl",
      "carfaxUrlStatus",
      "imageCount",
      "videoCount",
    ]) {
      if (listing[field] !== undefined && listing[field] !== "") {
        addFieldEvidence(evidence, field, listing[field], {
          sourceType: sourceTypeForFlatField(field, listing),
          sourceName: "OpenLane DOM",
          sourceText: sourceTextForField(field, listing, structured),
          pageType,
          captureKind,
          confidenceScore: scoreEvidence({ field, sourceType: sourceTypeForFlatField(field, listing), pageType, captureKind }),
          capturedAt,
          consentId,
        });
      }
    }

    const networkCandidates = listing.extractedFields?.debug?.networkCandidates?.fieldCandidates || [];
    for (const candidate of networkCandidates) {
      addFieldEvidence(evidence, candidate.field, candidate.value, {
        sourceType: "network_json",
        sourceName: candidate.source,
        sourceText: candidate.sourceText,
        endpointPattern: candidate.endpointPattern,
        pageType,
        captureKind,
        confidenceScore: candidate.confidence || 92,
        capturedAt: candidate.capturedAt || capturedAt,
        consentId,
      });
    }

    return Object.fromEntries(Object.entries(evidence).map(([field, items]) => [
      field,
      items.map(redactEvidence).sort(compareEvidence),
    ]));
  }

  function addFieldEvidence(map, field, value, options = {}) {
    if (!field || value === undefined || value === "") return;
    const item = redactEvidence({
      field,
      value,
      normalizedValue: normalizeEvidenceValue(field, value),
      sourceType: options.sourceType || "fallback_regex",
      sourceName: options.sourceName,
      sourceText: options.sourceText,
      endpointPattern: options.endpointPattern,
      pageType: options.pageType,
      captureKind: options.captureKind,
      confidenceScore: options.confidenceScore ?? scoreEvidence({ field, sourceType: options.sourceType, pageType: options.pageType, captureKind: options.captureKind }),
      capturedAt: options.capturedAt || new Date().toISOString(),
      consentId: options.consentId,
    });
    map[field] = map[field] || [];
    map[field].push(item);
  }

  function chooseBestEvidence(items = []) {
    return items.slice().sort(compareEvidence)[0];
  }

  function normalizeEvidenceValue(field, value) {
    if (value === undefined || value === null) return value;
    if (field === "vin") return String(value).trim().toUpperCase();
    if (/price|bid|offer|fee|tax|total|cost|amount/i.test(field)) return numberFromValue(value);
    if (field === "mileageKm") return numberFromValue(value);
    if (field === "year") return numberFromValue(value);
    if (typeof value === "string") return value.trim();
    return value;
  }

  function redactEvidence(item = {}) {
    const redacted = { ...item };
    if (redacted.sourceText !== undefined) redacted.sourceText = sanitizeText(String(redacted.sourceText)).slice(0, 1000);
    return compact(redacted);
  }

  function scoreEvidence(item = {}) {
    const sourceScore = {
      fee_page: 98,
      manual_confirmation: 98,
      post_sale_page: item.captureKind === "verified_outcome" ? 94 : 78,
      network_json: 92,
      dom_attribute: 90,
      dom_label: 85,
      safe_expansion: 82,
      section_map: 75,
      fallback_regex: 55,
    }[item.sourceType] ?? 55;
    if (["currentBid", "currentOffer", "bestOffer", "buyNowPrice"].includes(item.field) && item.captureKind === "observation") return Math.min(sourceScore, 92);
    if (["buyPriceAuction", "totalInvoiceAmount", "finalAcquisitionCost"].includes(item.field) && item.pageType === "fee_details") return Math.max(sourceScore, 98);
    return sourceScore;
  }

  function summarizeFieldEvidence(fieldEvidence = {}) {
    return Object.fromEntries(Object.entries(fieldEvidence).map(([field, items]) => {
      const best = chooseBestEvidence(items);
      return [field, best ? {
        sourceType: best.sourceType,
        confidenceScore: best.confidenceScore,
        endpointPattern: best.endpointPattern,
        captureKind: best.captureKind,
      } : undefined];
    }).filter(([, value]) => value));
  }

  function compareEvidence(a, b) {
    const confidence = Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0);
    if (confidence !== 0) return confidence;
    const priority = sourcePriority(b.sourceType) - sourcePriority(a.sourceType);
    if (priority !== 0) return priority;
    return String(a.sourceName || a.sourceText || "").localeCompare(String(b.sourceName || b.sourceText || ""));
  }

  function sourcePriority(sourceType) {
    return {
      fee_page: 9,
      manual_confirmation: 9,
      post_sale_page: 8,
      network_json: 7,
      dom_attribute: 6,
      dom_label: 5,
      safe_expansion: 4,
      section_map: 3,
      fallback_regex: 1,
    }[sourceType] ?? 0;
  }

  function sourceTypeForFlatField(field, listing) {
    if (field === "vin" && listing.extractedFields?.vinEvidence?.source === "data-vin") return "dom_attribute";
    if (field === "mileageKm" && listing.extractedFields?.mileageEvidence) return "dom_label";
    if (["buyPriceAuction", "totalInvoiceAmount", "finalAcquisitionCost"].includes(field) && listing.pageType === "fee_details") return "fee_page";
    if (["soldPriceCandidate", "acceptedAmount", "finalBidAmount"].includes(field) && listing.pageType === "post_sale") return "post_sale_page";
    if (field === "carfaxUrl" || field === "carfaxUrlStatus") return listing.carfaxUrl ? "dom_attribute" : "dom_label";
    return "dom_label";
  }

  function sourceTextForField(field, listing, structured) {
    if (field === "vin") return listing.extractedFields?.vinEvidence?.sourceText || structured.identity?.evidence?.[0]?.sourceText;
    if (field === "mileageKm") return listing.extractedFields?.mileageEvidence?.sourceText || structured.identity?.evidence?.[1]?.sourceText;
    if (field === "conditionReportText") return structured.condition?.conditionReportText;
    if (field === "carfaxUrl" || field === "carfaxUrlStatus") return listing.carfax?.evidence?.[0]?.sourceText || listing.carfaxUrl || listing.carfaxUrlStatus;
    return String(listing[field] ?? "");
  }

  function numberFromValue(value) {
    const number = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(number) ? number : value;
  }

  function sanitizeExtractionValue(value) {
    if (typeof value === "string") return sanitizeText(value);
    if (Array.isArray(value)) return value.map(sanitizeExtractionValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeExtractionValue(item)]));
  }

  function observationEvidence(listing, debug) {
    const candidates = (debug.priceCandidates || []).filter((candidate) => /bid|offer|buy now/i.test(String(candidate.label || "")));
    if (candidates.length) return candidates;
    return [
      listing.currentBid ? { label: "currentBid", value: listing.currentBid, source: "legacy_flat_field" } : undefined,
      listing.currentOffer ? { label: "currentOffer", value: listing.currentOffer, source: "legacy_flat_field" } : undefined,
      listing.bestOffer ? { label: "bestOffer", value: listing.bestOffer, source: "legacy_flat_field" } : undefined,
      listing.buyNowPrice ? { label: "buyNowPrice", value: listing.buyNowPrice, source: "legacy_flat_field" } : undefined,
    ].filter(Boolean);
  }

  function carfaxEvidence(listing) {
    const evidence = listing.openlaneMetadata?.carfaxEvidence || listing.extractedFields?.carfaxEvidence || [];
    if (Array.isArray(evidence) && evidence.length) return evidence;
    return [{
      source: "normalized_carfax_status",
      urlStatus: listing.carfaxUrlStatus || (listing.carfaxUrl ? "url_found" : listing.carfaxAvailable ? "text_only" : "missing"),
      available: Boolean(listing.carfaxAvailable),
    }];
  }

  function sanitizeText(value) {
    return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted_secret]"), String(value || ""));
  }

  function identityConfidence(listing) {
    let score = 0;
    if (listing.vin) score += 45;
    if (listing.year) score += 15;
    if (listing.make) score += 15;
    if (listing.model) score += 15;
    if (listing.mileageKm) score += 10;
    return Math.min(100, score);
  }

  function detectLanguage(text) {
    return /\b(offre actuelle|meilleure offre|mise actuelle|kilom[eè]tres|rapport)\b/i.test(String(text || "")) ? "fr" : "en";
  }

  function urlPattern(href) {
    try {
      const url = new URL(String(href || ""), "https://www.openlane.ca/");
      if (/\/vdp(?:\/|$)/i.test(url.pathname)) return "vdp";
      if (/\/purchases?(?:\/|$)/i.test(url.pathname)) return "purchase";
      if (/post-sale/i.test(url.pathname)) return "post_sale";
      return "openlane";
    } catch {
      return "unknown";
    }
  }

  function compact(object) {
    return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)));
  }

  const api = {
    applyOpenLaneExtractionContract,
    buildOpenLaneExtractionContract,
    sanitizeExtractionValue,
    addFieldEvidence,
    chooseBestEvidence,
    normalizeEvidenceValue,
    redactEvidence,
    scoreEvidence,
  };
  root.DealerFlowOpenLaneExtractionContract = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
