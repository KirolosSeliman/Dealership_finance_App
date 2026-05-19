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
      safeExpansion: safeListing.openlaneMetadata?.safeExpansion || state.safeExpansion || null,
      networkEvidence: safeListing.openlaneMetadata?.networkEvidence || [],
      readinessSummary,
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
      networkEvidenceCount: runtime.networkEvidenceCount ?? safeListing.openlaneMetadata?.networkEvidence?.length ?? 0,
      networkObserverMessage: networkObserverMessage(runtime, safeListing),
      safeExpansion: safeListing.openlaneMetadata?.safeExpansion || null,
      missingData: readiness.missingData || safeListing.missingData || [],
      extractionConfidence: safeListing.extractionConfidenceScore,
    });
  }

  function networkObserverMessage(runtime = {}, listing = {}) {
    const observer = runtime.networkObserver || {};
    const count = Number(runtime.networkEvidenceCount ?? observer.observationCount ?? listing.openlaneMetadata?.networkEvidence?.length ?? 0);
    if (observer.enabled && count === 0) {
      return "Network observer is enabled but no OpenLane vehicle JSON has been observed yet. Reload the VDP or check early hook/endpoint allowlist.";
    }
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
