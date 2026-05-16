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
  ];

  function applyOpenLaneExtractionContract(listing = {}) {
    const safeListing = sanitizeExtractionValue(listing);
    const structured = buildOpenLaneExtractionContract(safeListing);
    return compact({
      ...safeListing,
      ...structured,
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
        sectionMapSummary: listing.openlaneMetadata?.textRegions || classification.mainTextSample ? {
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

  const api = { applyOpenLaneExtractionContract, buildOpenLaneExtractionContract, sanitizeExtractionValue };
  root.DealerFlowOpenLaneExtractionContract = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
