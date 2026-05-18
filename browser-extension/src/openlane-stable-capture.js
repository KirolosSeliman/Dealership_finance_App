(function (root) {
  const DEFAULT_DELAYS_MS = [500, 1000, 1800, 3000, 5000];
  const VALID_VIN = /^[A-HJ-NPR-Z0-9]{17}$/i;
  const SENSITIVE_ATTR = /auth|authorization|cookie|token|secret|credential|session|password|csrf|jwt|bearer/i;
  const ATTRIBUTE_SELECTOR = [
    "[data-vin]",
    "[data-href]",
    "[data-url]",
    "[aria-label]",
    "[title]",
    "[data-testid]",
    "button",
    "[role='button']",
  ].join(",");

  async function extractStableOpenLaneListing(doc = document, href = location.href, settings = {}, options = {}) {
    const delays = Array.isArray(options.delaysMs) ? options.delaysMs : DEFAULT_DELAYS_MS;
    const sleepFn = typeof options.sleep === "function" ? options.sleep : sleep;
    const attempts = [];
    let previousSignature = "";
    let stableCount = 0;
    let lastResult = null;

    for (let index = 0; index <= delays.length; index += 1) {
      clearExtractionCache(doc);
      const attempt = await runStableAttempt(doc, href, settings, {
        ...options,
        attemptNumber: index + 1,
        stableAcrossAttempts: stableCount >= 1,
      });
      const signature = readinessSignature(attempt.listing);
      stableCount = signature && signature === previousSignature ? stableCount + 1 : 0;
      previousSignature = signature;

      attempt.readiness = evaluateOpenLaneReadiness(attempt.listing, attempt.classifier, {
        stableAcrossAttempts: stableCount >= 1,
        networkEvidenceCount: attempt.networkEvidenceCount,
        safeExpansionClickedCount: attempt.safeExpansionClickedCount,
        attempts: index + 1,
      });
      attempts.push(attemptSummary(attempt));
      lastResult = attempt;

      if (attempt.readiness.readyToCapture && (attempt.readiness.vinStatus === "found" || stableCount >= 1)) break;
      if (index < delays.length) await sleepFn(Number(delays[index] || 0));
    }

    const listing = lastResult?.listing || {};
    const readiness = {
      ...(lastResult?.readiness || evaluateOpenLaneReadiness(listing, lastResult?.classifier || {}, { attempts: attempts.length })),
      attempts: attempts.length,
      networkEvidenceCount: lastResult?.networkEvidenceCount || 0,
      safeExpansionClickedCount: lastResult?.safeExpansionClickedCount || 0,
    };
    return {
      listing: attachStableCaptureMetadata(listing, readiness, lastResult),
      readiness,
      safeExpansion: lastResult?.safeExpansion || null,
      debug: {
        attempts,
        bestVinEvidence: bestFieldEvidence(listing, "vin"),
        bestCarfaxEvidence: bestFieldEvidence(listing, "carfaxUrl") || bestFieldEvidence(listing, "carfaxUrlStatus"),
        classifier: lastResult?.classifier || null,
        networkObserverStatus: lastResult?.networkObserverStatus || null,
      },
    };
  }

  async function runStableAttempt(doc, href, settings, options = {}) {
    const classifier = classifyOpenLanePage(doc, href);
    const deepCaptureActive = hasActiveDeepCaptureConsent(settings);
    const safeExpansion = deepCaptureActive
      ? await root.DealerFlowOpenLaneSafeExpander?.expandOpenLaneReadOnlySections?.(doc, { maxSteps: 8, waitMs: 120 })
      : null;
    if (safeExpansion && typeof options.onSafeExpansion === "function") options.onSafeExpansion(safeExpansion);
    clearExtractionCache(doc);

    let listing = root.DealerFlowOpenLaneExtractor?.extractOpenLaneListing?.(doc, href, {
      includeMediaUrls: settings?.includeMediaUrls !== false,
      includeRawVisibleText: settings?.includeRawVisibleText !== false,
    }) || {};

    const networkEvidence = deepCaptureActive ? root.DealerFlowOpenLaneNetworkObserver?.getOpenLaneNetworkEvidence?.() || [] : [];
    if (deepCaptureActive && root.DealerFlowOpenLaneNetworkObserver?.mergeNetworkEvidenceIntoListing) {
      listing = root.DealerFlowOpenLaneNetworkObserver.mergeNetworkEvidenceIntoListing(listing, networkEvidence) || listing;
    }

    listing = recoverCriticalFields(listing, doc, href);
    const networkObserverStatus = root.DealerFlowOpenLaneNetworkObserver?.getOpenLaneNetworkObserverStatus?.() || null;
    return {
      listing,
      classifier,
      safeExpansion,
      safeExpansionClickedCount: safeExpansion?.clicked?.length || 0,
      networkEvidenceCount: networkEvidence.length,
      networkObserverStatus,
      readiness: null,
    };
  }

  function evaluateOpenLaneReadiness(listing = {}, classifier = {}, options = {}) {
    const vinStatus = vinStatusFor(listing.vin);
    const carfaxStatus = normalizeCarfaxStatus(listing);
    const pageType = String(classifier.pageType || listing.pageType || "unknown");
    const identityConfidence = identityConfidenceFor(listing, vinStatus);
    const reliableContext = hasReliableCaptureContext(listing);
    const missingData = Array.from(new Set([...(listing.missingData || []), vinStatus === "found" ? "" : "vin", carfaxStatus === "missing" ? "carfax" : ""].filter(Boolean)));
    const base = {
      readyToCapture: false,
      state: "pending_vehicle_data",
      blockedReason: "",
      identityConfidence,
      vinStatus,
      carfaxStatus,
      attempts: Number(options.attempts || 1),
      networkEvidenceCount: Number(options.networkEvidenceCount || 0),
      safeExpansionClickedCount: Number(options.safeExpansionClickedCount || 0),
      missingData,
    };

    if (!pageType || pageType === "unknown") {
      return { ...base, state: "unsupported_page", blockedReason: "classification_unknown" };
    }
    if (vinStatus === "invalid") {
      return { ...base, state: "incomplete_identity", blockedReason: "invalid_vin" };
    }
    if (!reliableContext) {
      return { ...base, state: "pending_vehicle_data", blockedReason: "missing_reliable_price_mileage_image_or_title_context" };
    }
    if (vinStatus === "found") {
      return { ...base, readyToCapture: true, state: "ready_to_capture", blockedReason: "" };
    }
    if (identityConfidence === "low") {
      return { ...base, state: "incomplete_identity", blockedReason: "missing_vin_and_weak_identity" };
    }
    if (options.stableAcrossAttempts === true) {
      return { ...base, readyToCapture: true, state: "ready_to_capture", blockedReason: "" };
    }
    return { ...base, state: "pending_vehicle_data", blockedReason: "waiting_for_stable_identity_or_vin" };
  }

  function normalizeCarfaxStatus(listing = {}) {
    if (listing.carfaxUrl || listing.carfaxUrlStatus === "url_found") return "url_found";
    if (listing.carfaxAvailable || listing.carfaxMentioned || listing.carfaxUrlStatus === "text_only") return "text_only";
    return "missing";
  }

  function recoverVinFromUrl(href = "") {
    for (const match of String(href || "").toUpperCase().matchAll(/\b[A-Z0-9]{17}\b/g)) {
      if (VALID_VIN.test(match[0])) return match[0];
    }
    return undefined;
  }

  function extractSafeDomAttributeText(doc = document) {
    const nodes = Array.from(doc.querySelectorAll?.(ATTRIBUTE_SELECTOR) || []);
    const parts = [];
    for (const node of nodes.slice(0, 250)) {
      for (const attribute of Array.from(node.attributes || [])) {
        if (SENSITIVE_ATTR.test(attribute.name)) continue;
        if (SENSITIVE_ATTR.test(String(attribute.value || ""))) continue;
        parts.push(`${attribute.name}=${String(attribute.value || "").slice(0, 500)}`);
      }
      const text = `${node.innerText || ""} ${node.textContent || ""}`.trim();
      if (text && !SENSITIVE_ATTR.test(text)) parts.push(text.slice(0, 500));
    }
    return parts.join("\n").slice(0, 4000);
  }

  function recoverCriticalFields(listing, doc, href) {
    const recoveredVin = listing.vin || recoverVinFromUrl(href) || recoverVinFromText(extractSafeDomAttributeText(doc));
    const next = { ...listing };
    if (!next.vin && recoveredVin) {
      next.vin = recoveredVin;
      next.extractedFields = {
        ...(next.extractedFields || {}),
        vinEvidence: { matchedLabel: "stable_capture_recovery", sourceText: `Recovered VIN ${recoveredVin}`, score: 72 },
      };
    }
    next.carfaxUrlStatus = normalizeCarfaxStatus(next);
    next.openlaneMetadata = {
      ...(next.openlaneMetadata || {}),
      stableCaptureRecovery: {
        vinRecovered: Boolean(!listing.vin && recoveredVin),
        carfaxStatus: next.carfaxUrlStatus,
      },
    };
    return root.DealerFlowOpenLaneExtractionContract?.applyOpenLaneExtractionContract?.(next) || next;
  }

  function recoverVinFromText(text) {
    for (const match of String(text || "").toUpperCase().matchAll(/\b[A-Z0-9]{17}\b/g)) {
      if (VALID_VIN.test(match[0])) return match[0];
    }
    return undefined;
  }

  function classifyOpenLanePage(doc, href) {
    return root.DealerFlowOpenLanePageClassifier?.classifyOpenLanePage?.(doc, href)
      || root.classifyOpenLanePage?.(doc, href)
      || { pageType: "unknown" };
  }

  function clearExtractionCache(doc) {
    root.DealerFlowOpenLaneSectionMap?.clearOpenLaneExtractionCache?.(doc);
  }

  function hasActiveDeepCaptureConsent(settings = {}) {
    return Boolean(settings.deepCaptureEnabled && settings.deepCaptureConsentStatus === "active" && settings.deepCaptureConsentId);
  }

  function vinStatusFor(vin) {
    if (!vin) return "missing";
    return VALID_VIN.test(String(vin)) ? "found" : "invalid";
  }

  function identityConfidenceFor(listing, vinStatus) {
    if (vinStatus === "found") return "high";
    const identityParts = [listing.year, listing.make, listing.model].filter(Boolean).length;
    if (identityParts >= 3 && (listing.mileageKm || listing.currentBid || listing.listedPrice || listing.buyNowPrice || listing.imageCount)) return "medium";
    return "low";
  }

  function hasReliableCaptureContext(listing) {
    return Boolean(
      listing.title
        || listing.mileageKm
        || listing.currentBid
        || listing.listedPrice
        || listing.buyNowPrice
        || listing.imageCount
        || listing.photos?.length,
    );
  }

  function readinessSignature(listing = {}) {
    return [
      listing.vin || "",
      listing.year || "",
      listing.make || "",
      listing.model || "",
      listing.mileageKm || "",
      listing.currentBid || listing.listedPrice || listing.buyNowPrice || "",
      listing.imageCount || listing.photos?.length || "",
      normalizeCarfaxStatus(listing),
    ].join("|");
  }

  function attemptSummary(attempt) {
    return {
      readiness: attempt.readiness,
      classifier: attempt.classifier,
      vin: attempt.listing?.vin,
      title: attempt.listing?.title,
      carfaxStatus: normalizeCarfaxStatus(attempt.listing),
      networkEvidenceCount: attempt.networkEvidenceCount,
      safeExpansionClickedCount: attempt.safeExpansionClickedCount,
    };
  }

  function attachStableCaptureMetadata(listing, readiness, result) {
    return {
      ...listing,
      openlaneMetadata: {
        ...(listing.openlaneMetadata || {}),
        stableCaptureReadiness: readiness,
        networkObserverStatus: result?.networkObserverStatus || undefined,
      },
    };
  }

  function bestFieldEvidence(listing, field) {
    return listing.fieldEvidence?.[field]?.[0] || listing.extractedFields?.[`${field}Evidence`] || undefined;
  }

  function sleep(ms) {
    return new Promise((resolve) => root.setTimeout ? root.setTimeout(resolve, ms) : setTimeout(resolve, ms));
  }

  const api = {
    extractStableOpenLaneListing,
    evaluateOpenLaneReadiness,
    normalizeCarfaxStatus,
    recoverVinFromUrl,
    extractSafeDomAttributeText,
  };
  root.DealerFlowOpenLaneStableCapture = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
