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

    const bidStabilization = await stabilizeCurrentBidIfNeeded(lastResult, doc, href, settings, options, sleepFn);
    if (bidStabilization?.result) lastResult = bidStabilization.result;

    const listing = lastResult?.listing || {};
    const readiness = {
      ...(lastResult?.readiness || evaluateOpenLaneReadiness(listing, lastResult?.classifier || {}, { attempts: attempts.length })),
      attempts: attempts.length,
      networkEvidenceCount: lastResult?.networkEvidenceCount || 0,
      safeExpansionClickedCount: lastResult?.safeExpansionClickedCount || 0,
    };
    return {
      listing: attachStableCaptureMetadata(listing, readiness, lastResult, bidStabilization),
      readiness,
      safeExpansion: lastResult?.safeExpansion || null,
      debug: {
        attempts,
        bestVinEvidence: bestFieldEvidence(listing, "vin"),
        bestCarfaxEvidence: bestFieldEvidence(listing, "carfaxUrl") || bestFieldEvidence(listing, "carfaxUrlStatus"),
        classifier: lastResult?.classifier || null,
        networkObserverStatus: lastResult?.networkObserverStatus || null,
        bidStabilization: bidStabilization?.metadata || null,
      },
    };
  }

  async function stabilizeCurrentBidIfNeeded(initialResult, doc, href, settings, options, sleepFn) {
    if (!initialResult?.listing || !isBidUnstable(initialResult.listing)) return null;
    const delays = Array.isArray(options.bidStabilizationDelaysMs) ? options.bidStabilizationDelaysMs : [500, 1500];
    const maxAttempts = Math.min(2, Number(options.maxBidStabilizationAttempts || 2));
    const initialCurrentBid = initialResult.listing.currentBid;
    let previousBid = initialCurrentBid;
    let finalResult = initialResult;
    let attempts = 0;
    let stoppedReason = "max_attempts_reached";

    for (let index = 0; index < Math.min(maxAttempts, delays.length); index += 1) {
      if (typeof options.isCancelled === "function" && options.isCancelled()) {
        stoppedReason = "cancelled";
        break;
      }
      if (typeof options.getHref === "function" && options.getHref() !== href) {
        stoppedReason = "route_changed";
        break;
      }
      await sleepFn(Number(delays[index] || 0));
      if (typeof options.getHref === "function" && options.getHref() !== href) {
        stoppedReason = "route_changed";
        break;
      }
      clearExtractionCache(doc);
      const attempt = await runStableAttempt(doc, href, settings, {
        ...options,
        attemptNumber: attempts + 1,
        bidOnly: true,
      });
      attempts += 1;
      finalResult = attempt;
      const nextBid = attempt.listing?.currentBid;
      if (nextBid && nextBid === previousBid && !isBidUnstable(attempt.listing)) {
        stoppedReason = "stable_same_value";
        break;
      }
      previousBid = nextBid;
      if (nextBid && nextBid !== initialCurrentBid && !isBidUnstable(attempt.listing)) {
        stoppedReason = "bid_updated_after_stabilization";
        break;
      }
    }

    const finalCurrentBid = finalResult?.listing?.currentBid;
    const metadata = {
      bidState: bidStateFor(finalResult?.listing || initialResult.listing),
      initialCurrentBid,
      finalCurrentBid,
      bidStabilizationAttempts: attempts,
      bidUpdatedAt: finalCurrentBid && finalCurrentBid !== initialCurrentBid ? new Date().toISOString() : undefined,
      stoppedReason,
    };
    return { result: { ...finalResult, bidStabilization: metadata }, metadata };
  }

  async function runStableAttempt(doc, href, settings, options = {}) {
    const classifier = classifyOpenLanePage(doc, href);
    const deepCaptureState = isDeepCaptureAllowed(settings, { href });
    const deepCaptureActive = deepCaptureState.active;
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
    if (isOpenLaneListing(listing, classifier) && vinStatus === "missing") {
      return { ...base, state: "incomplete_identity", blockedReason: "missing_vin_openlane_preview_only" };
    }
    if (!reliableContext) {
      return { ...base, state: "pending_vehicle_data", blockedReason: "missing_reliable_price_mileage_image_or_title_context" };
    }
    if (isOutcomeCapture(listing, pageType) && !hasOutcomePriceEvidence(listing)) {
      return { ...base, state: "pending_vehicle_data", blockedReason: "missing_purchase_outcome_price" };
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

  function isOpenLaneListing(listing = {}, classifier = {}) {
    return /openlane/i.test(String(listing.sourceName || classifier.sourceName || ""));
  }

  function isOutcomeCapture(listing = {}, pageType = "") {
    return /purchase_detail|post_sale|fee_details|purchase_info/i.test(String(pageType || listing.pageType || ""))
      || /candidate_outcome|verified_outcome/i.test(String(listing.captureKind || ""));
  }

  function hasOutcomePriceEvidence(listing = {}) {
    const hasOutcomePrice = [
      listing.soldPriceCandidate,
      listing.buyPriceAuction,
      listing.finalBidAmount,
      listing.acceptedAmount,
      listing.negotiatedAmount,
      listing.totalInvoiceAmount,
      listing.finalAcquisitionCost,
    ].some((value) => value !== undefined && value !== null && value !== "");
    if (!hasOutcomePrice) return false;
    return Boolean(
      listing.outcomeEvidence?.length
        || listing.fieldEvidence?.soldPriceCandidate?.length
        || listing.fieldEvidence?.buyPriceAuction?.length
        || listing.fieldEvidence?.finalBidAmount?.length
        || listing.openlaneMetadata?.purchaseEconomics?.purchaseEvidenceSource
        || listing.priceSemantics?.soldPriceCandidate
        || listing.priceSemantics?.buyPriceAuction
        || listing.priceSemantics?.finalBidAmount,
    );
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

  function isDeepCaptureAllowed(settings = {}, context = {}) {
    return root.DealerFlowMarketSnapDeepCaptureActivation?.isDeepCaptureAllowed?.(settings, context) || {
      active: false,
      deepCaptureActivationMode: "disabled_missing_required_settings",
      reason: "activation_helper_unavailable",
    };
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

  function attachStableCaptureMetadata(listing, readiness, result, bidStabilization) {
    const stabilization = bidStabilization?.metadata || result?.bidStabilization;
    return {
      ...listing,
      openlaneMetadata: {
        ...(listing.openlaneMetadata || {}),
        stableCaptureReadiness: readiness,
        bidStabilization: stabilization || undefined,
        networkObserverStatus: result?.networkObserverStatus || undefined,
      },
    };
  }

  function isBidUnstable(listing = {}) {
    return bidStateFor(listing) !== "stable";
  }

  function bidStateFor(listing = {}) {
    const debug = listing.extractedFields?.debug || {};
    if ((debug.staleCurrentBidCandidates || []).length) return "unstable_candidate_conflict";
    const candidates = debug.priceCandidates || [];
    const accepted = listing.currentBid;
    const active = candidates.find((candidate) => candidate.sourceType === "active_bid_bar" && !candidate.rejectedReason && candidate.value);
    const bidPanel = candidates.find((candidate) => /bidPanel/i.test(String(candidate.sourceName || "")) && !candidate.rejectedReason && candidate.value);
    if (active?.value && bidPanel?.value && Number(active.value) !== Number(bidPanel.value)) return "unstable_candidate_conflict";
    const currentBidText = `${listing.extractedFields?.currentBidEvidence?.sourceText || ""} ${candidates.map((candidate) => candidate.sourceText || "").join(" ")}`;
    if (accepted && /\b(under\s+1\s+min|seconds?\s+ago|just now|updated now)\b/i.test(currentBidText)) return "recent_bid_panel_observed";
    return "stable";
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
