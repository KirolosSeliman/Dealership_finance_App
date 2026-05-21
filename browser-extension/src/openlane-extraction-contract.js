(function (root) {
  const SENSITIVE_KEY_PATTERN = [
    ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_"),
    ["service", "role", "key"].join("_"),
    ["session", "token"].join("_"),
    ["access", "token"].join("_"),
    ["refresh", "token"].join("_"),
    ["id", "token"].join("_"),
    ["csrf", "token"].join("_"),
    ["jwt", "token"].join("_"),
    "session",
    "token",
    "password",
    "credential",
    "credentials",
    "authorization",
    "cookie",
    "csrf",
    "jwt",
    "bearer",
    "secret",
    "hunter2",
  ].join("|");
  const SECRET_PATTERNS = [
    new RegExp(`\\b(${SENSITIVE_KEY_PATTERN})\\b\\s*[:=]?\\s*[^\\s"'<>]+`, "gi"),
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
    /\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{16,}\b/g,
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ];
  const SENSITIVE_WORD_PATTERN = new RegExp(`\\b(?:${SENSITIVE_KEY_PATTERN})\\b`, "gi");
  const SENSITIVE_KEY_NAME_PATTERN = new RegExp(`\\b(?:${SENSITIVE_KEY_PATTERN})\\b`, "i");

  function applyOpenLaneExtractionContract(listing = {}) {
    const safeListing = sanitizeExtractionValue(listing);
    const structured = buildOpenLaneExtractionContract(safeListing);
    const fieldEvidence = buildFieldEvidence(safeListing, structured);
    const contracted = compact({
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
    const freshContracted = { ...contracted };
    delete freshContracted.openlaneCanonicalState;
    delete freshContracted.canonicalOpenLaneState;
    const canonical = normalizeOpenLaneCanonicalState(freshContracted);
    return canonicalToLegacyPayload(canonical, {
      ...contracted,
      openlaneCanonicalState: canonical,
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
        conditionExtractorMode: conditionDetails.conditionExtractorMode,
        conditionDiagnostics: conditionDetails.conditionDiagnostics,
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

    for (const [field, items] of Object.entries(listing.fieldEvidence || {})) {
      if (!Array.isArray(items)) continue;
      for (const item of items.slice(0, 20)) {
        addFieldEvidence(evidence, field, item.value, {
          sourceType: item.sourceType,
          sourceName: item.sourceName,
          sourceText: item.sourceText,
          endpointPattern: item.endpointPattern,
          pageType: item.pageType || pageType,
          captureKind: item.captureKind || captureKind,
          confidenceScore: item.confidenceScore,
          capturedAt: item.capturedAt || capturedAt,
          consentId: item.consentId || consentId,
        });
      }
    }

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

  function createCanonicalOpenLaneState(overrides = {}) {
    return normalizeOpenLaneCanonicalState(overrides);
  }

  function normalizeOpenLaneCanonicalState(raw = {}) {
    const listing = raw || {};
    const source = raw?.openlaneCanonicalState || raw?.canonicalOpenLaneState || raw || {};
    const pageContextSource = source.pageContext || listing.pageContext || {};
    const identitySource = source.identity || listing.identity || {};
    const activeAuctionSource = source.activeAuction || source.auctionObservation || listing.activeAuction || listing.auctionObservation || {};
    const purchaseOutcomeSource = source.purchaseOutcome || listing.purchaseOutcome || {};
    const carfaxSource = source.carfax || listing.carfax || {};
    const conditionSource = source.condition || listing.condition || {};
    const mediaSource = source.media || listing.media || {};
    const networkSource = source.network || listing.network || {};
    const readinessSource = source.readiness || listing.readiness || {};
    const diagnosticsSource = source.diagnostics || listing.diagnostics || {};
    const stableReadiness = listing.openlaneMetadata?.stableCaptureReadiness || {};
    const debug = listing.extractedFields?.debug || {};
    const carfaxUrl = firstDefined(carfaxSource.url, listing.carfaxUrl);
    const carfaxMentioned = Boolean(firstDefined(carfaxSource.mentioned, listing.carfaxMentioned, listing.carfaxAvailableLegacy, listing.carfaxAvailable, carfaxSource.available));
    const carfaxVisible = Boolean(firstDefined(carfaxSource.visible, carfaxSource.mentioned, listing.carfaxMentioned, listing.carfaxAvailableLegacy, listing.carfaxAvailable, carfaxSource.available));
    const carfaxStatus = normalizeCarfaxUrlStatus(firstDefined(carfaxSource.urlStatus, carfaxSource.status, listing.carfaxUrlStatus), carfaxUrl, carfaxMentioned || carfaxVisible);
    const carfaxActionable = Boolean(carfaxUrl) && carfaxStatus === "resolved_url";
    const canonical = {
      schemaVersion: firstDefined(source.schemaVersion, listing.schemaVersion, "openlane-canonical-v2"),
      capturedAt: firstDefined(source.capturedAt, listing.capturedAt, new Date().toISOString()),
      source: compact({
        name: "OpenLane",
        marketType: "auction_market",
        listingUrl: firstDefined(source.source?.listingUrl, listing.listingUrl),
        urlPattern: firstDefined(source.source?.urlPattern, pageContextSource.urlPattern, urlPattern(listing.listingUrl)),
      }),
      identity: compact({
        vin: firstDefined(identitySource.vin, listing.vin),
        year: firstDefined(identitySource.year, listing.year),
        make: firstDefined(identitySource.make, listing.make),
        model: firstDefined(identitySource.model, listing.model),
        trim: firstDefined(identitySource.trim, listing.trim),
        mileageKm: firstDefined(identitySource.mileageKm, listing.mileageKm),
        evidence: cappedArray(firstDefined(identitySource.evidence, [
          ...(listing.fieldEvidence?.vin || []),
          ...(listing.fieldEvidence?.mileageKm || []),
          listing.extractedFields?.vinEvidence,
          listing.extractedFields?.mileageEvidence,
        ].filter(Boolean))),
      }),
      pageContext: compact({
        pageType: firstDefined(pageContextSource.pageType, listing.pageType),
        captureKind: firstDefined(pageContextSource.captureKind, listing.captureKind),
        outcomeConfidence: firstDefined(pageContextSource.outcomeConfidence, listing.outcomeConfidence),
        evidence: cappedArray(firstDefined(pageContextSource.evidence, listing.outcomeEvidence, listing.openlaneMetadata?.classification?.evidence)),
        ignoredEvidence: cappedArray(firstDefined(pageContextSource.ignoredEvidence, listing.openlaneMetadata?.classification?.ignoredEvidence, debug.ignoredEvidence)),
      }),
      activeAuction: compact({
        currentBid: firstDefined(activeAuctionSource.currentBid, listing.currentBid),
        currentOffer: firstDefined(activeAuctionSource.currentOffer, listing.currentOffer),
        bestOffer: firstDefined(activeAuctionSource.bestOffer, listing.bestOffer),
        buyNowPrice: firstDefined(activeAuctionSource.buyNowPrice, listing.buyNowPrice),
        evidence: cappedArray(firstDefined(activeAuctionSource.evidence, listing.fieldEvidence?.currentBid, listing.extractedFields?.currentBidEvidence)),
        rejectedCandidates: cappedArray(firstDefined(activeAuctionSource.rejectedCandidates, debug.priceCandidates?.filter((candidate) => candidate?.rejectedReason || candidate?.rejectionReason))),
        staleCandidates: cappedArray(firstDefined(activeAuctionSource.staleCandidates, debug.staleCurrentBidCandidates)),
      }),
      purchaseOutcome: compact({
        soldPriceCandidate: firstDefined(purchaseOutcomeSource.soldPriceCandidate, listing.soldPriceCandidate),
        buyPriceAuction: firstDefined(purchaseOutcomeSource.buyPriceAuction, listing.buyPriceAuction),
        finalBidAmount: firstDefined(purchaseOutcomeSource.finalBidAmount, listing.finalBidAmount),
        acceptedAmount: firstDefined(purchaseOutcomeSource.acceptedAmount, listing.acceptedAmount),
        negotiatedAmount: firstDefined(purchaseOutcomeSource.negotiatedAmount, listing.negotiatedAmount),
        totalInvoiceAmount: firstDefined(purchaseOutcomeSource.totalInvoiceAmount, listing.totalInvoiceAmount),
        finalAcquisitionCost: firstDefined(purchaseOutcomeSource.finalAcquisitionCost, listing.finalAcquisitionCost),
        evidence: cappedArray(firstDefined(purchaseOutcomeSource.evidence, listing.outcomeEvidence, listing.fieldEvidence?.soldPriceCandidate)),
        rejectedCandidates: cappedArray(firstDefined(purchaseOutcomeSource.rejectedCandidates, debug.rejectedPurchaseOutcomeCandidates, debug.rejectedOutcomePriceCandidates)),
      }),
      carfax: compact({
        status: carfaxStatus,
        urlStatus: carfaxStatus,
        legacyUrlStatus: legacyCarfaxUrlStatus(carfaxStatus),
        url: carfaxUrl,
        mentioned: carfaxMentioned,
        visible: carfaxVisible,
        urlResolved: carfaxActionable,
        actionable: carfaxActionable,
        available: carfaxActionable,
        availableLegacy: carfaxMentioned || carfaxVisible,
        source: firstDefined(carfaxSource.source, sourceForCarfaxEvidence(carfaxSource.evidence || listing.openlaneMetadata?.carfaxEvidence || listing.extractedFields?.carfaxEvidence || [], carfaxStatus)),
        evidence: cappedArray(firstDefined(carfaxSource.evidence, listing.openlaneMetadata?.carfaxEvidence, listing.extractedFields?.carfaxEvidence)),
        candidateCounts: firstDefined(carfaxSource.candidateCounts, listing.openlaneMetadata?.carfaxDiagnostics),
        rejectedCandidates: cappedArray(firstDefined(carfaxSource.rejectedCandidates, listing.openlaneMetadata?.carfaxDiagnostics?.rejectedCandidates)),
        rejectedReasons: cappedArray(firstDefined(carfaxSource.rejectedReasons, (debug.carfaxCandidates || []).map((candidate) => candidate?.rejectedReason || candidate?.rejectionReason).filter(Boolean))),
      }),
      condition: compact({
        knownHistory: firstDefined(conditionSource.knownHistory, conditionSource.knownHistoryItems, listing.declarations),
        mechanical: firstDefined(conditionSource.mechanical, conditionSource.mechanicalDisclosures, listing.mechanicalAnnouncements),
        exterior: firstDefined(conditionSource.exterior, conditionSource.exteriorDisclosures, listing.damageAnnouncements),
        interior: firstDefined(conditionSource.interior, conditionSource.interiorDisclosures, listing.interiorAnnouncements),
        tireWheel: firstDefined(conditionSource.tireWheel, conditionSource.tireWheelDisclosures, listing.tireCondition),
        obd2: firstDefined(conditionSource.obd2, conditionSource.obd2Status, listing.diagnosticFeatures?.diagnosticCodesAvailable),
        notes: firstDefined(conditionSource.notes, conditionSource.dealerNotes, listing.openlaneMetadata?.dealerNotes),
        conditionReportText: firstDefined(listing.conditionReportText, conditionSource.conditionReportText),
        evidence: cappedArray(firstDefined(conditionSource.evidence, listing.condition?.evidence)),
      }),
      media: compact({
        photos: cappedArray(firstDefined(mediaSource.photos, listing.photos), 40),
        videos: cappedArray(firstDefined(mediaSource.videos, listing.videos), 20),
        photoCountVisible: firstDefined(mediaSource.photoCountVisible, mediaSource.imageCount, listing.imageCount),
        videoCountVisible: firstDefined(mediaSource.videoCountVisible, mediaSource.videoCount, listing.videoCount),
        evidence: cappedArray(firstDefined(mediaSource.evidence, listing.openlaneMetadata?.mediaCountEvidence)),
      }),
      network: compact({
        observerStatus: firstDefined(networkSource.observerStatus, listing.openlaneMetadata?.deepCaptureRuntime?.networkObserver),
        evidence: cappedArray(firstDefined(networkSource.evidence, listing.openlaneMetadata?.networkEvidence), 20),
        diagnostics: firstDefined(networkSource.diagnostics, listing.openlaneMetadata?.deepCaptureRuntime),
      }),
      readiness: compact({
        ready: firstDefined(readinessSource.ready, readinessSource.readyToCapture, stableReadiness.readyToCapture),
        readyToCapture: firstDefined(readinessSource.readyToCapture, readinessSource.ready, stableReadiness.readyToCapture),
        state: firstDefined(readinessSource.state, stableReadiness.state),
        missingData: cappedArray(firstDefined(readinessSource.missingData, stableReadiness.missingData, listing.missingData)),
        blockedReason: firstDefined(readinessSource.blockedReason, stableReadiness.blockedReason),
      }),
      diagnostics: compact({
        contradictions: cappedArray(firstDefined(diagnosticsSource.contradictions, listing.debug?.contradictions)),
        sourcePriorities: firstDefined(diagnosticsSource.sourcePriorities, listing.debug?.fieldEvidenceSummary),
        debugMessages: cappedArray(firstDefined(diagnosticsSource.debugMessages, listing.warnings)),
        conditionRejectedLines: cappedArray(firstDefined(diagnosticsSource.conditionRejectedLines, conditionSource.rejectedLines, debug.conditionDiagnostics?.rejectedConditionLines, listing.openlaneMetadata?.conditionDetails?.conditionDiagnostics?.rejectedConditionLines)),
      }),
    };

    canonical.condition = cleanCanonicalConditionState(canonical.condition || {}, listing);
    if (!canonical.condition.obd2) {
      const fallbackObd2 = normalizeCanonicalObd2(listing.openlaneMetadata?.conditionDetails?.obd2Status, listing.openlaneMetadata?.conditionDetails || {}, listing);
      if (fallbackObd2) canonical.condition.obd2 = fallbackObd2;
    }
    canonical.rejectedEvidence = buildRejectedEvidence(canonical, debug);
    canonical.mlFeatures = buildOpenLaneMlFeatures(canonical);
    if (canonical.readiness.ready === undefined && canonical.readiness.readyToCapture !== undefined) {
      canonical.readiness.ready = canonical.readiness.readyToCapture;
    }
    if (canonical.readiness.readyToCapture === undefined && canonical.readiness.ready !== undefined) {
      canonical.readiness.readyToCapture = canonical.readiness.ready;
    }
    const explicitMissingData = firstDefined(readinessSource.missingData, stableReadiness.missingData, listing.missingData);
    if (explicitMissingData !== undefined) canonical.readiness.missingData = cappedArray(explicitMissingData);
    if (!canonical.carfax.status && canonical.carfax.urlStatus) canonical.carfax.status = canonical.carfax.urlStatus;
    if (canonical.carfax.urlStatus !== "resolved_url") {
      canonical.carfax.urlResolved = false;
      canonical.carfax.actionable = false;
      canonical.carfax.available = false;
    }
    return sanitizeExtractionValue(canonical);
  }

  function buildOpenLaneMlFeatures(canonical = {}) {
    const identity = canonical.identity || {};
    const activeAuction = canonical.activeAuction || {};
    const purchaseOutcome = canonical.purchaseOutcome || {};
    const condition = canonical.condition || {};
    const carfax = canonical.carfax || {};
    const media = canonical.media || {};
    const conditionText = JSON.stringify(condition);
    return compact({
      year: identity.year,
      make: identity.make,
      model: identity.model,
      trim: identity.trim,
      mileageKm: identity.mileageKm,
      photoCountVisible: media.photoCountVisible,
      videoCountVisible: media.videoCountVisible,
      hasCarfaxMention: Boolean(carfax.mentioned),
      hasCarfaxResolvedUrl: Boolean(carfax.urlResolved),
      carfaxActionable: Boolean(carfax.actionable),
      hasAccidentHistory: /\b(accident|collision)\b/i.test(conditionText),
      hasDamageOver3000: /\b(?:damage|dommage)[^\d]{0,20}(?:3000|3,000|3 000|\$3k)\b/i.test(conditionText),
      hasRust: /\b(rust|corrosion|rouille)\b/i.test(conditionText),
      hasMechanicalDisclosure: cappedArray(condition.mechanical).length > 0,
      hasExteriorDisclosure: cappedArray(condition.exterior).length > 0,
      hasInteriorDisclosure: cappedArray(condition.interior).length > 0,
      hasTireWheelDisclosure: cappedArray(condition.tireWheel).length > 0,
      obd2Scanned: condition.obd2 !== undefined && !/not_visible|not_scanned|unknown/i.test(String(condition.obd2)),
      obd2Status: normalizeObd2Status(condition.obd2),
      activeCurrentBid: activeAuction.currentBid,
      verifiedSoldPrice: purchaseOutcome.soldPriceCandidate,
      verifiedBuyPriceAuction: purchaseOutcome.buyPriceAuction,
    });
  }

  function normalizeCarfaxUrlStatus(status, url, mentioned) {
    const text = String(status || "").trim();
    if (url || /^(resolved_url|url_found)$/i.test(text)) return "resolved_url";
    if (/^text_only$/i.test(text) || mentioned) return "text_only";
    if (/^blocked$/i.test(text)) return "blocked";
    if (/^(missing|not_found)$/i.test(text)) return "not_found";
    return "unknown";
  }

  function legacyCarfaxUrlStatus(status) {
    const normalized = normalizeCarfaxUrlStatus(status, undefined, false);
    if (normalized === "resolved_url") return "url_found";
    if (normalized === "not_found") return "missing";
    return normalized;
  }

  function sourceForCarfaxEvidence(evidence = [], status = "") {
    const items = cappedArray(evidence, 8);
    const source = String(items.find((item) => item?.url)?.source || items[0]?.source || "");
    if (/network/i.test(source)) return "network";
    if (/link_href|href\b/i.test(source)) return "dom_link";
    if (/data_href|data_url|data_report_url|safe_dom_attributes/i.test(source)) return "data_attribute";
    if (/hydration_json|html_carfax_zone|html_node|html_attributes|router/i.test(source)) return "router_or_hydration";
    if (status === "text_only") return "visible_text";
    return "none";
  }

  function normalizeObd2Status(value) {
    const text = String(value && typeof value === "object"
      ? firstDefined(value.status, value.obd2Status, value.value, value.rawText)
      : value || "");
    if (!text) return "unknown";
    if (/not_visible|not available|not_scanned|nothing_reported/i.test(text)) return "not_scanned";
    return "scanned";
  }

  function cleanCanonicalConditionState(condition = {}, rawListing = {}) {
    const knownHistory = cleanCanonicalConditionItems(condition.knownHistory);
    const mechanical = cleanCanonicalConditionItems(condition.mechanical);
    const exterior = cleanCanonicalConditionItems(condition.exterior);
    const interior = cleanCanonicalConditionItems(condition.interior);
    const tireWheel = cleanCanonicalConditionItems(condition.tireWheel);
    const notes = cleanCanonicalConditionItems(condition.notes);
    const reportTextItems = cleanCanonicalConditionItems(splitConditionText(condition.conditionReportText));
    const obd2 = normalizeCanonicalObd2(condition.obd2, condition, rawListing);
    const reportParts = [
      knownHistory.length ? `Known history: ${knownHistory.join(" | ")}` : "",
      mechanical.length ? `Mechanical: ${mechanical.join(" | ")}` : "",
      exterior.length ? `Exterior: ${exterior.join(" | ")}` : "",
      interior.length ? `Interior: ${interior.join(" | ")}` : "",
      tireWheel.length ? `Tires and wheels: ${tireWheel.join(" | ")}` : "",
      notes.length ? `Notes: ${notes.join(" | ")}` : "",
      reportTextItems.length ? reportTextItems.join(" | ") : "",
    ].filter(Boolean);
    return compact({
      knownHistory,
      mechanical,
      exterior,
      interior,
      tireWheel,
      obd2,
      notes,
      highRiskTerms: cleanCanonicalConditionItems(condition.highRiskTerms),
      conditionReportText: reportParts.join(" | ") || undefined,
      cleanConditionSummary: reportParts.join(" | ") || undefined,
      conditionExtractorMode: condition.conditionExtractorMode,
      conditionDiagnostics: condition.conditionDiagnostics ? compact({
        rejectedConditionLineCount: cappedArray(condition.conditionDiagnostics.rejectedConditionLines).length,
        sectionBoundaryDecisionCount: cappedArray(condition.conditionDiagnostics.sectionBoundaryDecisions).length,
        ignoredNoisyZoneCount: Number(condition.conditionDiagnostics.ignoredNoisyZoneCount || 0),
      }) : undefined,
      evidence: cappedArray(condition.evidence).map((item) => compact({
        source: item?.source,
        sourceType: item?.sourceType,
        confidenceScore: item?.confidenceScore,
      })),
    });
  }

  function cleanCanonicalConditionItems(value) {
    return Array.from(new Set(cappedArray(value, 40)
      .map((item) => normalizeConditionFeatureText(item))
      .filter((item) => item && !isCanonicalConditionNoise(item))))
      .slice(0, 20);
  }

  function normalizeCanonicalObd2(value, condition = {}, rawListing = {}) {
    if (value && typeof value === "object") {
      const statusText = String(firstDefined(value.status, value.obd2Status, value.value, value.rawText) || "");
      if (/not_visible|not available|not[_\s-]scanned|nothing[_\s-]reported/i.test(statusText)) return { status: "not_scanned" };
      if (/\b(scanned|visible_text|available|code|codes|dtc)\b/i.test(statusText)) {
        return compact({
          status: "scanned",
          rawText: value.rawText ? cleanCanonicalConditionItems([value.rawText])[0] : undefined,
        });
      }
    }
    const text = `${normalizeConditionFeatureText(value)} ${JSON.stringify(condition.evidence || [])} ${condition.conditionReportText || ""} ${JSON.stringify(rawListing.openlaneMetadata?.conditionDetails || {})} ${rawListing.rawVisibleText || ""}`;
    if (/\b(this vehicle was not scanned|not[_\s-]scanned|was not scanned|not available|nothing reported|rien n.a ete signale|rien n.a été signalé)\b/i.test(text)) {
      return { status: "not_scanned" };
    }
    if (/\b(obd2|obdii|diagnostic)\b/i.test(text) && /\b(scanned|code|codes|dtc)\b/i.test(text)) {
      return { status: "scanned", rawText: cleanCanonicalConditionItems([text])[0] };
    }
    return undefined;
  }

  function splitConditionText(value) {
    return String(value || "")
      .split(/\s+\|\s+|[\n\r•]+/g)
      .map((item) => item.replace(/^(known history|mechanical|exterior|interior|tires? and wheels|notes|condition report)\s*:\s*/i, "").trim())
      .filter(Boolean);
  }

  function normalizeConditionFeatureText(value) {
    if (Array.isArray(value)) return value.map(normalizeConditionFeatureText).filter(Boolean).join(" ");
    if (value && typeof value === "object") return normalizeConditionFeatureText(value.sourceText || value.text || value.value || "");
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isCanonicalConditionNoise(value) {
    const text = String(value || "").trim();
    if (!text || text.length < 3) return true;
    if (/^[a-z]{1,2}$/i.test(text)) return true;
    if (/\b(condition,\s*or\s*safety\s*of\s*any\s*vehicle|openlane\s+does\s+not\s+guarantee|privacy\s+policy|terms\s*&?\s*conditions?)\b/i.test(text)) return true;
    if (/\b(home|buying|selling|purchase|browse|closing|on hold|vehicle media|copy vin|order-history|live-offer-row|bid-panel-current|notes from the seller|seller notes?)\b/i.test(text)) return true;
    if (/\b(carfax|transport estimate|vehicle location|current bid|full bid history|bids?|bidder|watchlist|outbid|obd2 reader|obd2 scan)\b/i.test(text)) return true;
    if (/^expected\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},\s+\d{4}$/i.test(text)) return true;
    if (/\b(?:CAD|CA\$|\$)\s*\$?\s*\d[\d,.\s]*\s*\/\s*\d+\s*km\b/i.test(text)) return true;
    if (/\b[A-HJ-NPR-Z0-9]{17}\b/i.test(text)) return true;
    if (/^\d{1,3}(?:,\d{3})?\s*km$/i.test(text)) return true;
    if (/\b\d{4}\s+[A-Za-z][A-Za-z-]+\s+[A-Za-z0-9-]+/i.test(text)) return true;
    if (/\b[A-Z][A-Z0-9&.' -]+\s+(?:MOTORS|AUTO|AUTOS|DEALER|CARS|MOTORCARS)\b/.test(text)) return true;
    if (/\b(thumbnail|gallery)\b/i.test(text)) return true;
    return false;
  }

  function buildRejectedEvidence(canonical = {}, debug = {}) {
    return [
      ...(canonical.activeAuction?.rejectedCandidates || []),
      ...(canonical.activeAuction?.staleCandidates || []),
      ...(canonical.purchaseOutcome?.rejectedCandidates || []),
      ...(canonical.diagnostics?.conditionRejectedLines || []),
      ...((debug.titleCandidates || []).filter((candidate) => candidate?.rejectedReason)),
      ...(debug.mediaRejected || []),
    ].map((item) => redactEvidence({
      field: item.field,
      value: item.value,
      sourceType: item.sourceType || item.sourceZone,
      sourceName: item.sourceName || item.label,
      sourceText: item.sourceText,
      confidenceScore: item.confidenceScore,
      rejectionReason: item.rejectedReason || item.rejectionReason,
    })).slice(0, 80);
  }

  function canonicalToLegacyPayload(canonicalOrListing = {}, legacy = {}) {
    const canonical = normalizeOpenLaneCanonicalState(canonicalOrListing);
    const next = { ...(legacy || {}) };
    const identity = canonical.identity || {};
    const pageContext = canonical.pageContext || {};
    const activeAuction = canonical.activeAuction || {};
    const purchaseOutcome = canonical.purchaseOutcome || {};
    const carfax = canonical.carfax || {};
    const condition = canonical.condition || {};
    const media = canonical.media || {};
    const network = canonical.network || {};
    const readiness = canonical.readiness || {};

    setCanonical(next, "vin", identity.vin);
    setCanonical(next, "year", identity.year);
    setCanonical(next, "make", identity.make);
    setCanonical(next, "model", identity.model);
    setCanonical(next, "trim", identity.trim);
    setCanonical(next, "mileageKm", identity.mileageKm);
    setCanonical(next, "pageType", pageContext.pageType);
    setCanonical(next, "captureKind", pageContext.captureKind);
    setCanonical(next, "outcomeConfidence", pageContext.outcomeConfidence);
    setCanonical(next, "currentBid", activeAuction.currentBid);
    setCanonical(next, "currentOffer", activeAuction.currentOffer);
    setCanonical(next, "bestOffer", activeAuction.bestOffer);
    setCanonical(next, "buyNowPrice", activeAuction.buyNowPrice);
    setCanonical(next, "soldPriceCandidate", purchaseOutcome.soldPriceCandidate);
    setCanonical(next, "buyPriceAuction", purchaseOutcome.buyPriceAuction);
    setCanonical(next, "finalBidAmount", purchaseOutcome.finalBidAmount);
    setCanonical(next, "acceptedAmount", purchaseOutcome.acceptedAmount);
    setCanonical(next, "negotiatedAmount", purchaseOutcome.negotiatedAmount);
    setCanonical(next, "totalInvoiceAmount", purchaseOutcome.totalInvoiceAmount);
    setCanonical(next, "finalAcquisitionCost", purchaseOutcome.finalAcquisitionCost);
    setCanonical(next, "carfaxUrlStatus", legacyCarfaxUrlStatus(carfax.urlStatus || carfax.status));
    setCanonical(next, "carfaxUrl", carfax.url);
    setCanonical(next, "carfaxAvailable", Boolean(carfax.actionable));
    setCanonical(next, "carfaxMentioned", Boolean(carfax.mentioned));
    setCanonical(next, "carfaxActionable", Boolean(carfax.actionable));
    setCanonical(next, "carfaxAvailableLegacy", Boolean(carfax.availableLegacy || carfax.mentioned || carfax.visible));
    setCanonical(next, "photos", media.photos);
    setCanonical(next, "videos", media.videos);
    setCanonical(next, "imageCount", media.photoCountVisible);
    setCanonical(next, "videoCount", media.videoCountVisible);
    setCanonical(next, "conditionReportText", condition.conditionReportText);
    setCanonical(next, "missingData", readiness.missingData);

    const previousPriceSemantics = next.priceSemantics || {};
    next.priceSemantics = compact({
      soldPriceCandidate: purchaseOutcome.soldPriceCandidate !== undefined ? "candidate_wholesale_label" : undefined,
      finalBidAmount: purchaseOutcome.finalBidAmount !== undefined ? "wholesale_label" : undefined,
      acceptedAmount: purchaseOutcome.acceptedAmount !== undefined ? "wholesale_label" : undefined,
      buyPriceAuction: purchaseOutcome.buyPriceAuction !== undefined ? "acquisition_cost" : undefined,
      totalInvoiceAmount: purchaseOutcome.totalInvoiceAmount !== undefined ? "acquisition_cost" : undefined,
      finalAcquisitionCost: purchaseOutcome.finalAcquisitionCost !== undefined ? "acquisition_cost" : undefined,
      ...previousPriceSemantics,
      currentBid: activeAuction.currentBid !== undefined ? "observation" : previousPriceSemantics.currentBid,
      currentOffer: activeAuction.currentOffer !== undefined ? "observation" : previousPriceSemantics.currentOffer,
      bestOffer: activeAuction.bestOffer !== undefined ? "observation" : previousPriceSemantics.bestOffer,
      buyNowPrice: activeAuction.buyNowPrice !== undefined ? "observation" : previousPriceSemantics.buyNowPrice,
    });

    next.pageContext = compact({ ...(next.pageContext || {}), ...pageContext });
    next.identity = compact({ ...(next.identity || {}), ...identity });
    next.auctionObservation = compact({ ...(next.auctionObservation || {}), ...activeAuction });
    next.activeAuction = compact({ ...(next.activeAuction || {}), ...activeAuction });
    next.purchaseOutcome = compact({ ...(next.purchaseOutcome || {}), ...purchaseOutcome });
    next.carfax = compact({ ...(next.carfax || {}), ...carfax });
    next.condition = compact({ ...(next.condition || {}), ...condition });
    next.media = compact({ ...(next.media || {}), ...media });
    next.openlaneMetadata = {
      ...(next.openlaneMetadata || {}),
      ...(network.evidence || network.observerStatus || network.diagnostics ? {
        networkEvidence: network.evidence || next.openlaneMetadata?.networkEvidence,
        deepCaptureRuntime: network.diagnostics || next.openlaneMetadata?.deepCaptureRuntime,
      } : {}),
      ...(carfax.candidateCounts ? { carfaxDiagnostics: carfax.candidateCounts } : {}),
      stableCaptureReadiness: compact({
        ...(next.openlaneMetadata?.stableCaptureReadiness || {}),
        readyToCapture: firstDefined(readiness.readyToCapture, readiness.ready),
        ready: firstDefined(readiness.ready, readiness.readyToCapture),
        state: readiness.state,
        blockedReason: readiness.blockedReason,
        missingData: readiness.missingData,
      }),
    };
    next.openlaneCanonicalState = canonical;
    const sanitized = sanitizeExtractionValue(compact(next));
    if (readiness.missingData !== undefined) {
      sanitized.missingData = cappedArray(readiness.missingData);
      sanitized.openlaneMetadata = sanitized.openlaneMetadata || {};
      sanitized.openlaneMetadata.stableCaptureReadiness = sanitized.openlaneMetadata.stableCaptureReadiness || {};
      sanitized.openlaneMetadata.stableCaptureReadiness.missingData = cappedArray(readiness.missingData);
    }
    return sanitized;
  }

  function setCanonical(target, field, value) {
    if (value !== undefined && value !== "") target[field] = value;
  }

  function firstDefined(...values) {
    return values.find((value) => value !== undefined);
  }

  function cappedArray(value, limit = 20) {
    if (value === undefined || value === null) return [];
    const array = Array.isArray(value) ? value : [value];
    return array.filter((item) => item !== undefined && item !== "").slice(0, limit);
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
      explicit_dom_attribute: 90,
      header_chip: 88,
      safe_dom_attribute: 86,
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
      network_json: 8,
      explicit_dom_attribute: 7,
      header_chip: 6,
      safe_dom_attribute: 5,
      dom_label: 4,
      safe_expansion: 3,
      section_map: 2,
      fallback_regex: 1,
    }[sourceType] ?? 0;
  }

  function sourceTypeForFlatField(field, listing) {
    const vinSource = String(listing.extractedFields?.vinEvidence?.matchedLabel || listing.extractedFields?.vinEvidence?.source || "");
    if (field === "vin" && /explicit_dom_attribute|data-vin|dom_attributes|attribute:/i.test(vinSource)) return "explicit_dom_attribute";
    if (field === "vin" && /header_vin_chip/i.test(vinSource)) return "header_chip";
    if (field === "vin" && /safe_dom_attributes|html_attributes|copy_button/i.test(vinSource)) return "safe_dom_attribute";
    if (field === "vin" && /section-map/i.test(vinSource)) return "section_map";
    if (field === "mileageKm" && listing.extractedFields?.mileageEvidence) return "dom_label";
    if (["buyPriceAuction", "totalInvoiceAmount", "finalAcquisitionCost"].includes(field) && listing.pageType === "fee_details") return "fee_page";
    if (["soldPriceCandidate", "acceptedAmount", "finalBidAmount"].includes(field) && listing.pageType === "post_sale") return "post_sale_page";
    if (field === "carfaxUrl" || field === "carfaxUrlStatus") return listing.carfaxUrl ? "safe_dom_attribute" : "dom_label";
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
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [sanitizeKey(key), sanitizeExtractionValue(item)]));
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
    return SECRET_PATTERNS
      .reduce((text, pattern) => text.replace(pattern, "[redacted]"), String(value || ""))
      .replace(SENSITIVE_WORD_PATTERN, "[redacted]");
  }

  function sanitizeKey(value) {
    const key = String(value || "");
    return SENSITIVE_KEY_NAME_PATTERN.test(key) ? "[redacted_key]" : key;
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
    createCanonicalOpenLaneState,
    normalizeOpenLaneCanonicalState,
    canonicalToLegacyPayload,
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
