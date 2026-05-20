(function () {
  function buildCopyPayload(listing = {}, state = {}) {
    const safeListing = listing || {};
    const classification = safeListing.openlaneMetadata?.classification || null;
    const outcomeEvidence = safeListing.outcomeEvidence || classification?.evidence || [];
    const debug = safeListing.extractedFields?.debug || {};
    const normalizedExtraction = {
      pageContext: safeListing.pageContext || null,
      identity: safeListing.identity || null,
      auctionObservation: safeListing.auctionObservation || null,
      purchaseOutcome: safeListing.purchaseOutcome || null,
      condition: safeListing.condition || null,
      media: safeListing.media || null,
      carfax: safeListing.carfax || null,
      debug: safeListing.debug || null,
    };
    const readinessSummary = buildReadinessSummary(safeListing);
    const priceDiagnostics = buildPriceDiagnostics(safeListing);
    const currentBidDebug = buildCurrentBidDebug(safeListing, priceDiagnostics);
    const purchaseOutcomeDebug = buildPurchaseOutcomeDebug(safeListing, priceDiagnostics);
    const conditionCleanupDebug = buildConditionCleanupDebug(safeListing);
    const carfaxDebug = buildCarfaxDebug(safeListing);
    const contradictionDiagnostics = buildContradictionDiagnostics(safeListing, {
      priceDiagnostics,
      currentBidDebug,
      purchaseOutcomeDebug,
      conditionCleanupDebug,
      carfaxDebug,
    });
    const sectionMap = {
      summary: safeListing.openlaneMetadata?.sectionMapSummary || safeListing.debug?.sectionMapSummary || null,
      textRegions: safeListing.openlaneMetadata?.textRegions || null,
      ignoredEvidence: classification?.ignoredEvidence || debug.ignoredEvidence || [],
    };
    return sanitizeDebugValue({
      normalizedExtraction,
      legacyPayload: safeListing,
      valuation: state.valuation || null,
      classification,
      sectionMap,
      candidateScores: debug.candidateScores || debug.titleCandidates || [],
      debugSummary: buildDebugSummary(safeListing),
      safeExpansion: safeListing.openlaneMetadata?.safeExpansion || state.safeExpansion || null,
      networkEvidence: safeListing.openlaneMetadata?.networkEvidence || [],
      readinessSummary,
      priceDiagnostics,
      contradictionDiagnostics,
      currentBidDebug,
      purchaseOutcomeDebug,
      conditionCleanupDebug,
      carfaxDebug,
      outcomeEvidence,
      debug,
      backendResponse: state.backendResponse,
      captureResponse: state.captureResponse,
    });
  }

  function buildReadinessSummary(listing = {}) {
    const safeListing = listing || {};
    const readiness = safeListing.openlaneMetadata?.stableCaptureReadiness || {};
    const runtime = safeListing.openlaneMetadata?.deepCaptureRuntime || {};
    return sanitizeDebugValue({
      pageType: safeListing.pageType,
      captureKind: safeListing.captureKind,
      captureLevel: safeListing.captureLevel,
      readyToCapture: Boolean(readiness.readyToCapture),
      readinessState: readiness.state || "",
      blockedReason: readiness.blockedReason || "",
      vin: safeListing.vin || "",
      vinStatus: readiness.vinStatus || (!safeListing.vin ? "missing" : /^[A-HJ-NPR-Z0-9]{17}$/i.test(String(safeListing.vin)) ? "found" : "invalid"),
      vinEvidenceSource: safeListing.fieldEvidence?.vin?.[0]?.sourceType || safeListing.extractedFields?.vinEvidence?.matchedLabel || "",
      vinCandidateCount: safeListing.extractedFields?.debug?.vinCandidates?.length || 0,
      carfaxStatus: readiness.carfaxStatus || safeListing.carfaxUrlStatus || "missing",
      carfaxUrl: safeListing.carfaxUrl || "",
      carfaxEvidenceSource: safeListing.openlaneMetadata?.carfaxEvidence?.[0]?.source || safeListing.carfax?.evidence?.[0]?.source || "",
      carfaxDiagnostics: safeListing.openlaneMetadata?.carfaxDiagnostics || {},
      networkObserver: runtime.networkObserver || null,
      networkObserverDiagnostics: networkObserverDiagnostics(runtime, safeListing),
      networkEvidenceCount: runtime.networkEvidenceCount ?? safeListing.openlaneMetadata?.networkEvidence?.length ?? 0,
      networkObserverMessage: networkObserverMessage(runtime, safeListing),
      priceState: priceStateLabel(safeListing),
      requiredFieldsForPageType: requiredFieldsForPageType(safeListing),
      listedPriceRequirementReason: listedPriceRequirementReason(safeListing),
      bidStabilization: safeListing.openlaneMetadata?.bidStabilization || null,
      currentBid: safeListing.currentBid ?? null,
      currentBidSource: buildPriceDiagnostics(safeListing).currentBidSource,
      currentBidSourceText: buildPriceDiagnostics(safeListing).currentBidSourceText,
      currentBidConfidence: buildPriceDiagnostics(safeListing).currentBidConfidence,
      rejectedPriceCandidates: buildPriceDiagnostics(safeListing).rejectedPriceCandidates,
      rejectedOutcomePriceCandidates: buildPriceDiagnostics(safeListing).rejectedOutcomePriceCandidates,
      staleCurrentBidCandidates: buildPriceDiagnostics(safeListing).staleCurrentBidCandidates,
      listedPrice: safeListing.listedPrice ?? null,
      listedPriceSource: buildPriceDiagnostics(safeListing).listedPriceSource,
      listedPriceSemantics: buildPriceDiagnostics(safeListing).listedPriceSemantics,
      priceDiagnosticMessages: buildPriceDiagnostics(safeListing).priceDiagnosticMessages,
      soldPriceCandidate: safeListing.soldPriceCandidate ?? null,
      buyPriceAuction: safeListing.buyPriceAuction ?? null,
      finalBidAmount: safeListing.finalBidAmount ?? null,
      outcomeConfidence: safeListing.outcomeConfidence || "",
      purchaseEvidenceSource: purchaseEvidenceSource(safeListing),
      ignoredNoisyZones: ignoredNoisyZones(safeListing),
      rejectedFieldCandidateCount: rejectedFieldCandidateItems(safeListing).length,
      safeExpansion: safeListing.openlaneMetadata?.safeExpansion || null,
      missingData: readiness.missingData || safeListing.missingData || [],
      extractionConfidence: safeListing.extractionConfidenceScore,
    });
  }

  function buildDebugSummary(listing = {}) {
    const safeListing = listing || {};
    const runtime = safeListing.openlaneMetadata?.deepCaptureRuntime || {};
    return {
      pageType: safeListing.pageType || "",
      captureKind: safeListing.captureKind || "",
      outcomeConfidence: safeListing.outcomeConfidence || "",
      priceState: priceStateLabel(safeListing),
      currentBid: safeListing.currentBid ?? null,
      ...buildPriceDiagnostics(safeListing),
      soldPriceCandidate: safeListing.soldPriceCandidate ?? null,
      buyPriceAuction: safeListing.buyPriceAuction ?? null,
      finalBidAmount: safeListing.finalBidAmount ?? null,
      purchaseEvidenceSource: purchaseEvidenceSource(safeListing),
      deepCaptureActive: Boolean(runtime.active || safeListing.captureLevel === "deep_capture"),
      networkObserverEnabled: Boolean(runtime.networkObserver?.enabled),
      networkObserverDiagnostics: networkObserverDiagnostics(runtime, safeListing),
      networkEvidenceCount: runtime.networkEvidenceCount ?? safeListing.openlaneMetadata?.networkEvidence?.length ?? 0,
      networkObserverMessage: networkObserverMessage(runtime, safeListing),
      carfaxStatus: safeListing.carfaxUrlStatus || "missing",
      carfaxDiagnostics: safeListing.openlaneMetadata?.carfaxDiagnostics || {},
      contradictionDiagnostics: buildContradictionDiagnostics(safeListing),
      currentBidDebug: buildCurrentBidDebug(safeListing),
      purchaseOutcomeDebug: buildPurchaseOutcomeDebug(safeListing),
      conditionCleanupDebug: buildConditionCleanupDebug(safeListing),
      carfaxDebug: buildCarfaxDebug(safeListing),
      vinStatus: !safeListing.vin ? "missing" : /^[A-HJ-NPR-Z0-9]{17}$/i.test(String(safeListing.vin)) ? "found" : "invalid",
      vinEvidenceSource: safeListing.fieldEvidence?.vin?.[0]?.sourceType || safeListing.extractedFields?.vinEvidence?.matchedLabel || "",
      ignoredNoisyZones: ignoredNoisyZones(safeListing),
      rejectedFieldCandidates: rejectedFieldCandidateItems(safeListing),
      diagnosticMessages: diagnosticMessages(safeListing),
    };
  }

  function networkObserverMessage(runtime = {}, listing = {}) {
    const observer = runtime.networkObserver || {};
    const count = Number(runtime.networkEvidenceCount ?? observer.observationCount ?? listing.openlaneMetadata?.networkEvidence?.length ?? 0);
    if (observer.enabled && count === 0) {
      if (Number(observer.deniedEventCount || 0) > 0 && Number(observer.allowedEventCount || 0) === 0) {
        return "Network events observed but denied by allowlist/denylist.";
      }
      if (Number(observer.irrelevantJsonCount || 0) > 0) {
        return "Network JSON observed but no vehicle/carfax/price candidates found.";
      }
      return "Network observer is enabled but no OpenLane vehicle JSON has been observed yet. Reload the VDP or check early hook/endpoint allowlist.";
    }
    return "";
  }

  function networkObserverDiagnostics(runtime = {}, listing = {}) {
    const observer = runtime.networkObserver || {};
    return sanitizeDebugValue({
      pageHookInstalled: Boolean(observer.pageHookInstalled),
      earlyHookInstalled: Boolean(observer.earlyHookInstalled),
      earlyQueueLength: Number(observer.earlyQueueLength || 0),
      earlyQueueFlushed: Boolean(observer.earlyQueueFlushed),
      lastPageHookEventAt: observer.lastPageHookEventAt || "",
      pageHookEventCount: Number(observer.pageHookEventCount || 0),
      allowedEventCount: Number(observer.allowedEventCount || 0),
      deniedEventCount: Number(observer.deniedEventCount || 0),
      irrelevantJsonCount: Number(observer.irrelevantJsonCount || 0),
      duplicateEventCount: Number(observer.duplicateEventCount || 0),
      parseErrorCount: Number(observer.parseErrorCount || 0),
      lastAllowedEndpointPattern: observer.lastAllowedEndpointPattern || "",
      lastDeniedEndpointPattern: observer.lastDeniedEndpointPattern || "",
      lastDeniedEndpointReason: observer.lastDeniedEndpointReason || "",
      lastObservedEndpointSample: observer.lastObservedEndpointSample || "",
      networkObserverMessage: networkObserverMessage(runtime, listing),
    });
  }

  function buildPriceDiagnostics(listing = {}) {
    const debug = listing.extractedFields?.debug || {};
    const currentBidEvidence = listing.extractedFields?.currentBidEvidence
      || listing.fieldEvidence?.currentBid?.[0]
      || {};
    const rejectedPriceCandidates = (debug.priceCandidates || [])
      .filter((candidate) => candidate.rejectedReason || candidate.rejectionReason)
      .map((candidate) => ({
        field: candidate.field || candidate.label || "price",
        value: candidate.value ?? null,
        sourceType: candidate.sourceType || candidate.source || "",
        sourceName: candidate.sourceName || candidate.label || "",
        sourceText: sanitizeText(candidate.sourceText || ""),
        rejectionReason: candidate.rejectedReason || candidate.rejectionReason,
      }))
      .slice(0, 8);
    const lowerBidCandidates = (debug.lowerBidCandidates || [])
      .map((candidate) => ({
        field: candidate.field || "currentBid",
        value: candidate.value ?? null,
        sourceType: candidate.sourceType || "",
        sourceName: candidate.sourceName || "",
        sourceText: sanitizeText(candidate.sourceText || ""),
        rejectionReason: candidate.rejectedReason || candidate.rejectionReason || "lower_bid_candidate",
      }))
      .slice(0, 6);
    const staleCurrentBidCandidates = (debug.staleCurrentBidCandidates || [])
      .map((candidate) => ({
        field: candidate.field || "currentBid",
        value: candidate.value ?? null,
        sourceType: candidate.sourceType || "",
        sourceName: candidate.sourceName || "",
        sourceText: sanitizeText(candidate.sourceText || ""),
        recencyText: sanitizeText(candidate.recencyText || ""),
        freshnessScore: candidate.freshnessScore ?? null,
        rejectionReason: candidate.rejectedReason || candidate.rejectionReason || "stale_current_bid_candidate",
      }))
      .slice(0, 6);
    return sanitizeDebugValue({
      currentBid: listing.currentBid ?? null,
      currentBidSource: currentBidEvidence.sourceType || currentBidEvidence.matchedLabel || "",
      currentBidSourceText: currentBidEvidence.sourceText || "",
      currentBidConfidence: currentBidEvidence.confidenceScore ?? null,
      rejectedPriceCandidates,
      rejectedOutcomePriceCandidates: rejectedOutcomePriceCandidates(listing, rejectedPriceCandidates),
      lowerBidCandidates,
      staleCurrentBidCandidates,
      listedPrice: listing.listedPrice ?? null,
      listedPriceSource: debug.listedPriceDecision?.source || "",
      listedPriceSemantics: listing.priceSemantics?.listedPrice || debug.listedPriceDecision?.semantics || "",
      priceDiagnosticMessages: priceDiagnosticMessages(listing, rejectedPriceCandidates, lowerBidCandidates, staleCurrentBidCandidates),
    });
  }

  function buildCurrentBidDebug(listing = {}, priceDiagnostics = buildPriceDiagnostics(listing)) {
    const debug = listing.extractedFields?.debug || {};
    const bidStabilization = listing.openlaneMetadata?.bidStabilization || {};
    const bidLiveMonitor = listing.openlaneMetadata?.bidLiveMonitor || null;
    const priceCandidates = Array.isArray(debug.priceCandidates) ? debug.priceCandidates : [];
    const currentBidEvidence = listing.extractedFields?.currentBidEvidence
      || listing.fieldEvidence?.currentBid?.[0]
      || {};
    const bidPanelTopCandidate = priceCandidates.find((candidate) => /bid_panel|top_row|bid_history/i.test(`${candidate.sourceType || ""} ${candidate.sourceName || ""} ${candidate.label || ""}`) && !candidate.rejectedReason && !candidate.rejectionReason);
    const winningSource = currentBidEvidence.sourceType || currentBidEvidence.matchedLabel || priceDiagnostics.currentBidSource || "";
    return sanitizeDebugValue({
      winningCurrentBid: listing.currentBid ?? null,
      winningCurrentBidSource: winningSource,
      winningSource,
      sourceText: currentBidEvidence.sourceText || priceDiagnostics.currentBidSourceText || "",
      staleActiveBidBarCandidate: priceDiagnostics.staleCurrentBidCandidates?.find((candidate) => /active_bid_bar/i.test(candidate.sourceType || candidate.sourceName || "")) || priceDiagnostics.staleCurrentBidCandidates?.[0] || null,
      bidPanelTopCandidate: bidPanelTopCandidate ? compactPriceCandidate(bidPanelTopCandidate) : null,
      freshBidPanelCandidates: priceCandidates
        .filter((candidate) => /bid_panel|top_row|current_bid|bid_history/i.test(`${candidate.sourceType || ""} ${candidate.sourceName || ""} ${candidate.label || ""}`) && !candidate.rejectedReason && !candidate.rejectionReason)
        .map(compactPriceCandidate)
        .slice(0, 5),
      rejectedPriceCandidates: priceDiagnostics.rejectedPriceCandidates || [],
      lowerBidCandidates: priceDiagnostics.lowerBidCandidates || [],
      bidMonitorStatus: bidLiveMonitor,
      lastBidUpdatedAt: bidLiveMonitor?.updatedAt || bidStabilization.bidUpdatedAt || currentBidEvidence.capturedAt || "",
      bidStabilizationAttempts: Number(bidStabilization.bidStabilizationAttempts || 0),
      bidStabilization,
    });
  }

  function buildPurchaseOutcomeDebug(listing = {}, priceDiagnostics = buildPriceDiagnostics(listing)) {
    const rejectedMarkers = purchaseMarkerRejectedEvidence(listing);
    return sanitizeDebugValue({
      soldPriceCandidate: listing.soldPriceCandidate ?? null,
      buyPriceAuction: listing.buyPriceAuction ?? null,
      finalBidAmount: listing.finalBidAmount ?? null,
      purchaseEvidenceSource: purchaseEvidenceSource(listing),
      soldPriceParserStatus: soldPriceParserStatus(listing, priceDiagnostics),
      purchaseMarkerRejectedReasons: [...new Set(rejectedMarkers.map((item) => item.rejectedReason || item.rejectionReason).filter(Boolean))].slice(0, 8),
      purchaseMarkerSourceZones: [...new Set(rejectedMarkers.map((item) => item.zone || item.sourceZone || item.marker).filter(Boolean))].slice(0, 8),
      rejectedOutcomePriceCandidates: priceDiagnostics.rejectedOutcomePriceCandidates || [],
    });
  }

  function buildConditionCleanupDebug(listing = {}) {
    const debug = listing.extractedFields?.debug || {};
    const diagnostics = debug.conditionDiagnostics || listing.openlaneMetadata?.conditionDetails?.conditionDiagnostics || {};
    return sanitizeDebugValue({
      ignoredNoisyZones: ignoredNoisyZones(listing),
      rejectedConditionLines: (diagnostics.rejectedConditionLines || []).map((item) => ({
        sourceZone: item.sourceZone || item.zone || "",
        sourceText: sanitizeText(item.sourceText || item.text || ""),
        rejectionReason: item.rejectionReason || item.reason || "condition_noise_line",
      })).slice(0, 12),
      sectionBoundaryDecisions: (diagnostics.sectionBoundaryDecisions || []).map((item) => ({
        sourceZone: item.sourceZone || item.zone || "",
        startHeading: item.startHeading || item.heading || "",
        stopHeading: item.stopHeading || item.nextHeading || "",
      })).slice(0, 8),
    });
  }

  function buildCarfaxDebug(listing = {}) {
    const debug = listing.extractedFields?.debug || {};
    const carfaxCandidates = Array.isArray(debug.carfaxCandidates) ? debug.carfaxCandidates : [];
    return sanitizeDebugValue({
      carfaxUrlStatus: listing.carfaxUrlStatus || "missing",
      carfaxUrl: listing.carfaxUrl || "",
      carfaxCandidateCounts: listing.openlaneMetadata?.carfaxDiagnostics || {},
      carfaxRejectedReasons: carfaxCandidates
        .map((candidate) => candidate.rejectedReason || candidate.rejectionReason)
        .filter(Boolean)
        .slice(0, 8),
      networkObserverMessage: networkObserverMessage(listing.openlaneMetadata?.deepCaptureRuntime || {}, listing),
    });
  }

  function buildContradictionDiagnostics(listing = {}, parts = {}) {
    const priceDiagnostics = parts.priceDiagnostics || buildPriceDiagnostics(listing);
    const purchaseOutcomeDebug = parts.purchaseOutcomeDebug || buildPurchaseOutcomeDebug(listing, priceDiagnostics);
    const conditionCleanupDebug = parts.conditionCleanupDebug || buildConditionCleanupDebug(listing);
    const carfaxDebug = parts.carfaxDebug || buildCarfaxDebug(listing);
    const networkMessage = networkObserverMessage(listing.openlaneMetadata?.deepCaptureRuntime || {}, listing);
    return sanitizeDebugValue({
      classificationContradictions: purchaseMarkerRejectedEvidence(listing).map((item) => ({
        marker: item.marker || "",
        sourceZone: item.zone || item.sourceZone || "",
        sourceText: sanitizeText(item.sourceText || ""),
        rejectionReason: item.rejectedReason || item.rejectionReason || "rejected_purchase_marker",
      })).slice(0, 8),
      priceContradictions: [
        ...(priceDiagnostics.staleCurrentBidCandidates || []),
        ...(priceDiagnostics.lowerBidCandidates || []),
        ...(priceDiagnostics.rejectedOutcomePriceCandidates || []),
      ].slice(0, 12),
      conditionContradictions: conditionCleanupDebug.rejectedConditionLines || [],
      carfaxContradictions: [
        listing.carfaxUrlStatus === "text_only" ? { carfaxUrlStatus: "text_only", reason: "carfax_text_visible_without_safe_url" } : null,
        ...(carfaxDebug.carfaxRejectedReasons || []).map((reason) => ({ reason })),
      ].filter(Boolean).slice(0, 8),
      networkContradictions: networkMessage ? [{ message: networkMessage }] : [],
      purchaseMarkerRejectedReasons: purchaseOutcomeDebug.purchaseMarkerRejectedReasons || [],
    });
  }

  function purchaseMarkerRejectedEvidence(listing = {}) {
    const classification = listing.openlaneMetadata?.classification || listing.extractedFields?.debug?.classifierDecision || {};
    return (classification.ignoredEvidence || [])
      .filter((item) => item?.rejectedReason || item?.rejectionReason || /purchase|pickup|paid|outcome|sold/i.test(`${item?.marker || ""} ${item?.sourceText || ""}`))
      .slice(0, 12);
  }

  function compactPriceCandidate(candidate = {}) {
    return {
      field: candidate.field || candidate.label || "price",
      value: candidate.value ?? null,
      sourceType: candidate.sourceType || candidate.source || "",
      sourceName: candidate.sourceName || candidate.label || "",
      sourceText: sanitizeText(candidate.sourceText || ""),
      confidenceScore: candidate.confidenceScore ?? null,
      rejectionReason: candidate.rejectedReason || candidate.rejectionReason || "",
    };
  }

  function rejectedOutcomePriceCandidates(listing = {}, rejectedPriceCandidates = []) {
    const debug = listing.extractedFields?.debug || {};
    const explicit = Array.isArray(debug.rejectedPurchaseOutcomeCandidates) ? debug.rejectedPurchaseOutcomeCandidates : [];
    const fallback = rejectedPriceCandidates.filter((candidate) => /outcome|purchase|transport_estimate|active_current_bid|bid_count/i.test(candidate.rejectionReason || ""));
    return [...explicit, ...fallback]
      .map((candidate) => ({
        field: candidate.field || "soldPriceCandidate",
        value: candidate.value ?? null,
        sourceType: candidate.sourceType || candidate.source || "",
        sourceName: candidate.sourceName || candidate.label || "",
        sourceText: sanitizeText(candidate.sourceText || ""),
        rejectionReason: candidate.rejectedReason || candidate.rejectionReason || "not_purchase_outcome_price",
      }))
      .slice(0, 8);
  }

  function priceDiagnosticMessages(listing = {}, rejectedPriceCandidates = [], lowerBidCandidates = [], staleCurrentBidCandidates = []) {
    return [
      listing.currentBid ? `Current bid selected: ${moneyLabel(listing.currentBid)}.` : "Current bid not found. Active listing remains observation-only.",
      ...rejectedPriceCandidates
        .filter((candidate) => /bid_count_not_money/i.test(candidate.rejectionReason || ""))
        .map((candidate) => `Rejected bid count as price: ${candidate.sourceText || candidate.value}`),
      ...lowerBidCandidates
        .map((candidate) => `Lower bid candidate ignored: ${moneyLabel(candidate.value) || candidate.sourceText}`),
      ...staleCurrentBidCandidates
        .map((candidate) => `Stale current bid candidate ignored: ${moneyLabel(candidate.value) || candidate.sourceText}`),
      listing.priceSemantics?.listedPrice === "observation_alias_current_bid" ? "Listed price is an observation alias of current bid, not a final sale label." : "",
    ].filter(Boolean);
  }

  function moneyLabel(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return `$${Math.round(number).toLocaleString("en-CA")}`;
  }

  function priceStateLabel(listing = {}) {
    const semantics = listing.priceSemantics || {};
    if (semantics.finalBidAmount || semantics.acceptedAmount || semantics.buyPriceAuction || semantics.totalInvoiceAmount) return "verified outcome";
    if (semantics.soldPriceCandidate || listing.captureKind === "candidate_outcome") return "candidate outcome";
    if (semantics.currentBid || listing.captureKind === "observation") return "observation";
    return "unknown";
  }

  function isPurchaseOutcomeContext(listing = {}) {
    return /purchase_detail|post_sale|fee_details|purchase_info/i.test(String(listing.pageType || ""))
      || /candidate_outcome|verified_outcome/i.test(String(listing.captureKind || ""));
  }

  function requiredFieldsForPageType(listing = {}) {
    if (isPurchaseOutcomeContext(listing)) return ["vin", "soldPriceCandidate", "purchaseEvidence"];
    return ["vin"];
  }

  function listedPriceRequirementReason(listing = {}) {
    if (isPurchaseOutcomeContext(listing)) {
      return "listedPrice is not required on purchase/outcome pages; sold/acquisition outcome price is required.";
    }
    return "listedPrice is not required for active listing readiness; current bid is observation-only.";
  }

  function soldPriceParserStatus(listing = {}, priceDiagnostics = buildPriceDiagnostics(listing)) {
    if (!isPurchaseOutcomeContext(listing)) return "not_purchase_context";
    if (listing.soldPriceCandidate || listing.buyPriceAuction || listing.finalBidAmount) return "price_found";
    if ((priceDiagnostics.rejectedOutcomePriceCandidates || []).length) return "rejected_candidates_only";
    return "missing_sold_price";
  }

  function purchaseEvidenceSource(listing = {}) {
    const explicit = listing.openlaneMetadata?.purchaseEconomics?.purchaseEvidenceSource
      || listing.extractedFields?.debug?.purchaseEvidenceSource;
    if (explicit) return explicit;
    const evidence = listing.outcomeEvidence || listing.openlaneMetadata?.classification?.evidence || [];
    const first = evidence.find((item) => item.sourceText || item.marker || item.evidenceType) || {};
    if (first.sourceText) return first.sourceText;
    if (first.marker) return first.marker;
    if (first.evidenceType) return first.evidenceType;
    if (listing.buyPriceAuction || listing.soldPriceCandidate) return "purchase panel";
    return "";
  }

  function ignoredNoisyZones(listing = {}) {
    const summary = listing.openlaneMetadata?.sectionMapSummary?.summary || {};
    const fromSummary = Object.entries(summary)
      .filter(([, value]) => value?.ignored && Number(value.textLength || 0) > 0)
      .map(([name]) => name);
    const fromEvidence = (listing.openlaneMetadata?.classification?.ignoredEvidence || [])
      .map((item) => item.zone || String(item.marker || "").replace(/_text$/, ""))
      .filter(Boolean);
    return [...new Set([...fromSummary, ...fromEvidence])].slice(0, 8);
  }

  function rejectedFieldCandidateItems(listing = {}) {
    const debug = listing.extractedFields?.debug || {};
    const items = [];
    for (const [field, candidates] of Object.entries({
      vin: debug.vinCandidates || [],
      mileage: debug.mileageCandidates || [],
      title: debug.titleCandidates || [],
      carfax: debug.carfaxCandidates || [],
    })) {
      for (const candidate of candidates || []) {
        const reason = candidate.rejectedReason || candidate.rejectionReason;
        if (reason) items.push({ field, rejectionReason: reason, sourceType: candidate.source || candidate.sourceType || "" });
      }
    }
    for (const item of debug.mediaRejected || []) {
      if (item.reason || item.rejectedReason) items.push({ field: "media", rejectionReason: item.reason || item.rejectedReason, sourceType: item.source || "" });
    }
    return items.slice(0, 12);
  }

  function diagnosticMessages(listing = {}) {
    return [
      classificationMessage(listing),
      priceDiagnosticMessage(listing),
      bidStabilizationMessage(listing),
      transportIgnoredMessage(listing),
      listing.carfaxUrlStatus === "text_only" ? "Carfax text found, but no URL is exposed." : "",
      networkObserverMessage(listing.openlaneMetadata?.deepCaptureRuntime || {}, listing),
      ignoredNoisyZones(listing).length ? "Q&A/sidebar/market-guide text ignored for canonical fields." : "",
    ].filter(Boolean);
  }

  function classificationMessage(listing = {}) {
    if (listing.pageType === "purchase_detail" || listing.captureKind === "verified_outcome") {
      return `Purchased VDP detected from ${purchaseEvidenceSource(listing) || "classification evidence"}.`;
    }
    if (listing.pageType === "active_listing" || listing.captureKind === "observation") {
      return "Active listing detected. Current bid is observation-only.";
    }
    return "";
  }

  function priceDiagnosticMessage(listing = {}) {
    if (listing.soldPriceCandidate || listing.buyPriceAuction) return "Sold price extracted from purchase panel.";
    if (listing.currentBid && !listing.soldPriceCandidate) return "Current bid is observation-only and is not saved as a final sale label.";
    return "";
  }

  function bidStabilizationMessage(listing = {}) {
    const state = listing.openlaneMetadata?.bidStabilization || {};
    if (!state.bidStabilizationAttempts) return "";
    if (state.initialCurrentBid && state.finalCurrentBid && state.initialCurrentBid !== state.finalCurrentBid) {
      return `Current bid updated from ${moneyLabel(state.initialCurrentBid)} to ${moneyLabel(state.finalCurrentBid)} after bid panel stabilization.`;
    }
    if (state.bidState && state.bidState !== "stable") return `Bid panel stabilization checked ${state.bidStabilizationAttempts} time(s); state: ${state.bidState}.`;
    return "";
  }

  function transportIgnoredMessage(listing = {}) {
    const debug = listing.extractedFields?.debug || {};
    const rejectedMileage = (debug.mileageCandidates || []).some((candidate) => /transport|distance|rate|delivery|pickup/i.test(candidate.rejectedReason || candidate.sourceText || ""));
    const visibleTransport = /\btransport\b[\s\S]{0,80}\b(CAD|\$|km)\b/i.test(String(listing.rawVisibleText || listing.openlaneMetadata?.textRegions?.mainTextSample || ""));
    if ((rejectedMileage || visibleTransport) && !listing.buyNowPrice && !listing.soldPriceCandidate) return "Transport estimate ignored as listing price.";
    return "";
  }

  function sanitizeDebugValue(value) {
    if (typeof value === "string") return sanitizeText(value);
    if (Array.isArray(value)) return value.map(sanitizeDebugValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /auth|authorization|cookie|token|secret|credential|session|password|csrf|jwt|bearer/i.test(key) ? "[redacted]" : sanitizeDebugValue(item),
    ]));
  }

  function sanitizeText(value) {
    return String(value || "")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
      .replace(/\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
      .replace(/\b(authorization|cookie|token|secret|credential|session|password|csrf|jwt)\b\s*[:=]\s*[^,\s;]+/gi, "$1=[redacted]")
      .slice(0, 1000);
  }

  const api = { buildCopyPayload, buildReadinessSummary, sanitizeDebugValue };
  if (typeof window !== "undefined") window.DealerFlowMarketSnapCopyPayload = api;
  if (typeof module !== "undefined") module.exports = api;
})();
