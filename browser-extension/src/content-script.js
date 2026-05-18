(function () {
  if (window.__dealerFlowMarketSnapRuntime) return;
  window.__dealerFlowMarketSnapRuntime = true;

  const MAX_READY_RETRIES = 8;
  const READY_RETRY_DELAY_MS = 500;
  const AUTO_ANALYZE_DEBOUNCE_MS = 1200;
  const ROUTE_CHANGE_DEBOUNCE_MS = 500;

  const STATE = {
    phase: "idle",
    widget: null,
    settings: null,
    captureRuntime: null,
    listing: null,
    valuation: null,
    backendResponse: null,
    captureResponse: null,
    safeExpansion: null,
    hiddenPageUrl: "",
    lastSignature: "",
    currentUrl: location.href,
    running: false,
    timer: 0,
    observer: null,
    readyRetries: 0,
    pendingRun: null,
  };

  boot();

  async function boot() {
    await waitForBody();
    STATE.settings = await refreshDeepCaptureConsentState(await window.DealerFlowMarketSnapStorage.getSettings());
    syncDeepCaptureObserver();
    STATE.captureRuntime = window.DealerFlowMarketSnapCaptureRuntime.createMarketSnapCaptureRuntime({
      api: window.DealerFlowMarketSnapApi,
      now: () => Date.now(),
    });
    observeDynamicPage();
    await runRuntime({ force: false, reason: "boot" });
  }

  async function runRuntime({ force, reason }) {
    if (STATE.running) {
      STATE.pendingRun = { force: Boolean(force), reason };
      return;
    }
    if (force) clearExtractionCache();
    if (!force && STATE.hiddenPageUrl === location.href) return;
    const supported = await waitForVehiclePage(force ? 1 : MAX_READY_RETRIES);
    if (!supported) {
      if (reason === "route-change") removeWidget();
      return;
    }

    ensureWidget();
    STATE.widget.setCollapsed(Boolean(STATE.settings?.widgetCollapsed));
    STATE.widget.render({ status: "detecting", listing: STATE.listing, message: "Detected OpenLane vehicle page." });
    await runAnalysis({ force });
  }

  async function waitForBody() {
    if (document.body) return;
    await new Promise((resolve) => {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", resolve, { once: true });
      } else {
        resolve();
      }
    });
  }

  async function waitForVehiclePage(maxRetries) {
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      STATE.readyRetries = attempt;
      clearExtractionCache();
      if (isSupportedOpenLaneVehiclePage()) return true;
      await sleep(READY_RETRY_DELAY_MS);
    }
    clearExtractionCache();
    return isSupportedOpenLaneVehiclePage();
  }

  function isSupportedOpenLaneVehiclePage() {
    const classification = classifyOpenLanePage();
    return classification.pageType !== "unknown" && window.DealerFlowOpenLaneExtractor.isOpenLaneVehiclePage(document, location.href);
  }

  function ensureWidget() {
    if (STATE.widget?.host?.isConnected) return STATE.widget;
    STATE.widget = window.DealerFlowMarketSnapWidget.createMarketSnapWidget({
      onRefresh: () => runRuntime({ force: true, reason: "manual-refresh" }),
      onSave: () => saveToDealRadar(),
      onCopy: () => copyExtractedJson(),
      onOpenDealerFlow: () => openDealerFlow(),
      onOpenSettings: () => openSettings(),
      onSettingsSaved: (settings) => {
        STATE.settings = settings;
        syncDeepCaptureObserver();
        STATE.widget?.render({ status: "idle", listing: STATE.listing, valuation: STATE.valuation, message: "Settings saved." });
      },
      onHidePage: () => hideCurrentPage(),
    });
    return STATE.widget;
  }

  function removeWidget() {
    STATE.widget?.destroy?.();
    STATE.widget = null;
    STATE.listing = null;
    STATE.valuation = null;
    STATE.backendResponse = null;
    STATE.captureResponse = null;
    STATE.lastSignature = "";
  }

  function observeDynamicPage() {
    if (STATE.observer) return;
    STATE.observer = new MutationObserver(() => onDomMutation());
    STATE.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    patchHistory("pushState");
    patchHistory("replaceState");
    window.addEventListener("popstate", onRouteChange);
    window.addEventListener("dealerflow:locationchange", onRouteChange);
  }

  function patchHistory(method) {
    const original = history[method];
    if (original.__dealerFlowPatched) return;
    history[method] = function patchedHistoryMethod() {
      const result = original.apply(this, arguments);
      window.dispatchEvent(new Event("dealerflow:locationchange"));
      return result;
    };
    history[method].__dealerFlowPatched = true;
  }

  function onRouteChange() {
    if (STATE.currentUrl === location.href) return;
    STATE.currentUrl = location.href;
    clearExtractionCache();
    STATE.lastSignature = "";
    STATE.valuation = null;
    STATE.backendResponse = null;
    STATE.captureResponse = null;
    scheduleRuntime(ROUTE_CHANGE_DEBOUNCE_MS, "route-change");
  }

  function onDomMutation() {
    clearExtractionCache();
    scheduleRuntime(AUTO_ANALYZE_DEBOUNCE_MS, "mutation");
  }

  function scheduleRuntime(delay, reason) {
    clearTimeout(STATE.timer);
    STATE.timer = setTimeout(() => runRuntime({ force: false, reason }), delay);
  }

  async function runAnalysis({ force }) {
    if (STATE.running) return;
    STATE.phase = "extracting";

    if (!STATE.settings?.autoAnalyze && !force) {
      updateListingOnly();
      return;
    }

    if (hasActiveDeepCaptureConsent()) await expandReadOnlySections();
    else STATE.safeExpansion = null;
    const listing = extractListing({ force });
    if (!isVehicleListing(listing)) {
      STATE.widget?.render({ status: "warning", listing, message: "OpenLane vehicle data is still loading or incomplete." });
      return;
    }

    STATE.listing = listing;
    const settingsError = settingsProblem(STATE.settings);
    if (settingsError) {
      STATE.widget?.render({ status: "disconnected", listing, valuation: STATE.valuation, message: settingsError });
      return;
    }
    queueCapture(listing, { force });

    const signature = listingSignature(listing);
    if (!force && signature === STATE.lastSignature) return;
    STATE.lastSignature = signature;
    STATE.running = true;
    STATE.phase = "analyzing";
    STATE.widget?.render({ status: "analyzing", listing, message: "Analyzing visible OpenLane data..." });

    try {
      const payload = await window.DealerFlowMarketSnapApi.analyzeListing(STATE.settings, listing);
      STATE.backendResponse = payload;
      STATE.valuation = payload.valuation;
      STATE.phase = "success";
      STATE.widget?.render({ status: "ready", listing, valuation: STATE.valuation, message: "" });
      if (STATE.settings.autoSave) await saveToDealRadar();
    } catch (error) {
      STATE.phase = "error";
      STATE.widget?.render({ status: "error", listing, valuation: STATE.valuation, message: formatError(error) });
    } finally {
      STATE.running = false;
      const pendingRun = STATE.pendingRun;
      STATE.pendingRun = null;
      if (pendingRun) setTimeout(() => runRuntime(pendingRun), 0);
    }
  }

  function queueCapture(listing, { force = false } = {}) {
    STATE.captureRuntime?.enqueueCapture(listing, STATE.settings, { force }).then((payload) => {
      STATE.captureResponse = payload;
    }).catch((error) => {
      if (STATE.settings?.debugMode) console.warn("Market Snap capture queue failed", error);
      STATE.widget?.render({ status: "warning", listing, valuation: STATE.valuation, message: formatError(error) });
    });
  }

  function updateListingOnly() {
    const listing = extractListing();
    if (!isVehicleListing(listing)) return;
    STATE.phase = "idle";
    STATE.listing = listing;
    STATE.widget?.render({ status: "idle", listing, message: "Auto-analyze is off. Use Refresh to analyze this page." });
  }

  function extractListing({ force = false } = {}) {
    if (force) clearExtractionCache();
    const classification = classifyOpenLanePage();
    const listing = window.DealerFlowOpenLaneExtractor.extractOpenLaneListing(document, location.href, {
      includeMediaUrls: STATE.settings?.includeMediaUrls !== false,
      includeRawVisibleText: STATE.settings?.includeRawVisibleText !== false,
    });
    const networkEvidence = hasActiveDeepCaptureConsent() ? window.DealerFlowOpenLaneNetworkObserver?.getOpenLaneNetworkEvidence?.() || [] : [];
    const withNetworkEvidence = hasActiveDeepCaptureConsent()
      ? window.DealerFlowOpenLaneNetworkObserver?.mergeNetworkEvidenceIntoListing?.(listing, networkEvidence) || listing
      : listing;
    const merged = {
      ...withNetworkEvidence,
      pageType: classification.pageType,
      captureKind: classification.captureKind,
      outcomeConfidence: classification.outcomeConfidence,
      openlaneMetadata: { ...(withNetworkEvidence.openlaneMetadata || {}), classification },
    };
    if (STATE.safeExpansion) merged.openlaneMetadata.safeExpansion = STATE.safeExpansion;
    const gated = applyConsentGateToListing(merged);
    if (STATE.settings?.debugMode) logExtractionDebug(gated);
    return gated;
  }

  async function expandReadOnlySections() {
    if (!hasActiveDeepCaptureConsent()) {
      STATE.safeExpansion = null;
      return null;
    }
    STATE.safeExpansion = await window.DealerFlowOpenLaneSafeExpander?.expandOpenLaneReadOnlySections?.(document, { maxSteps: 8, waitMs: 120 });
    return STATE.safeExpansion;
  }

  async function refreshDeepCaptureConsentState(settings) {
    if (!settings?.organizationId || !settings.deepCaptureEnabled) {
      return window.DealerFlowMarketSnapStorage.saveSettings({
        ...settings,
        deepCaptureEnabled: false,
        observePageNetworkData: false,
        deepCaptureConsentStatus: settings?.deepCaptureConsentStatus === "withdrawn" ? "withdrawn" : "off",
      });
    }
    try {
      const response = await window.DealerFlowMarketSnapApi.getDeepCaptureConsentStatus(settings);
      const active = response.consentStatus === "active";
      return window.DealerFlowMarketSnapStorage.saveSettings({
        ...settings,
        deepCaptureEnabled: active,
        observePageNetworkData: active,
        deepCaptureConsentId: response.deepCaptureConsentId || "",
        deepCaptureConsentVersion: response.deepCaptureConsentVersion || "",
        deepCaptureConsentAcceptedAt: response.deepCaptureConsentAcceptedAt || "",
        deepCaptureConsentStatus: active ? "active" : response.consentStatus || "off",
      });
    } catch (error) {
      if (settings.debugMode) console.warn("Deep Capture consent status check failed", error);
      return window.DealerFlowMarketSnapStorage.saveSettings({
        ...settings,
        deepCaptureEnabled: false,
        observePageNetworkData: false,
        deepCaptureConsentStatus: "paused",
      });
    }
  }

  function syncDeepCaptureObserver() {
    if (hasActiveDeepCaptureConsent()) {
      window.DealerFlowOpenLaneNetworkObserver?.startOpenLaneNetworkObserver?.(STATE.settings);
      return;
    }
    window.DealerFlowOpenLaneNetworkObserver?.stopOpenLaneNetworkObserver?.();
  }

  function hasActiveDeepCaptureConsent() {
    return Boolean(
      STATE.settings?.deepCaptureEnabled
        && STATE.settings?.deepCaptureConsentStatus === "active"
        && STATE.settings?.deepCaptureConsentId,
    );
  }

  function applyConsentGateToListing(listing) {
    if (hasActiveDeepCaptureConsent()) {
      return {
        ...listing,
        captureLevel: "deep_capture",
        captureScopes: deepCaptureScopes(),
        deepCaptureConsentId: STATE.settings.deepCaptureConsentId,
        sourceEvidence: buildSourceEvidence(listing),
      };
    }
    const basic = { ...listing };
    for (const field of ["pageContext", "identity", "auctionObservation", "purchaseOutcome", "condition", "media", "carfax", "debug", "sourceEvidence", "deepCaptureConsentId"]) {
      delete basic[field];
    }
    const metadata = { ...(basic.openlaneMetadata || {}) };
    delete metadata.networkEvidence;
    delete metadata.safeExpansion;
    return {
      ...basic,
      captureLevel: "basic_dom",
      captureScopes: ["dom_visible"],
      openlaneMetadata: metadata,
    };
  }

  function deepCaptureScopes() {
    const scopes = [
      "dom_visible",
      "safe_read_only_expansion",
      "network_response_observation",
      "fee_outcome_capture",
      "post_sale_outcome_capture",
      "media_url_capture",
    ];
    if (STATE.settings?.modelImprovementOptIn) scopes.push("model_improvement");
    return scopes;
  }

  function buildSourceEvidence(listing) {
    const evidence = [{ scope: "dom_visible", evidenceType: "dom_text", sourceUrl: location.href, capturedAt: new Date().toISOString(), confidenceScore: listing.extractionConfidenceScore }];
    if (STATE.safeExpansion) evidence.push({ scope: "safe_read_only_expansion", evidenceType: "expanded_section", sourceUrl: location.href, capturedAt: new Date().toISOString() });
    for (const item of listing.openlaneMetadata?.networkEvidence || []) {
      evidence.push({ scope: "network_response_observation", evidenceType: "network_response_summary", endpointPattern: item.endpointPattern, capturedAt: item.capturedAt });
    }
    if (listing.photos?.length || listing.videos?.length || listing.imageCount) evidence.push({ scope: "media_url_capture", evidenceType: "media_url", sourceUrl: location.href, capturedAt: new Date().toISOString() });
    if (listing.buyPriceAuction || listing.totalInvoiceAmount || listing.finalAcquisitionCost) evidence.push({ scope: "fee_outcome_capture", evidenceType: "fee_outcome", sourceUrl: location.href, capturedAt: new Date().toISOString() });
    if (listing.captureKind === "candidate_outcome" || listing.captureKind === "verified_outcome") evidence.push({ scope: "post_sale_outcome_capture", evidenceType: "post_sale_outcome", sourceUrl: location.href, capturedAt: new Date().toISOString() });
    return evidence.slice(0, 50);
  }

  function classifyOpenLanePage() {
    return window.DealerFlowOpenLanePageClassifier.classifyOpenLanePage(document, location.href);
  }

  function clearExtractionCache() {
    window.DealerFlowOpenLaneSectionMap?.clearOpenLaneExtractionCache?.(document);
  }

  function isVehicleListing(listing) {
    return Boolean(listing && (listing.vin || (listing.year && listing.make && listing.model)) && (listing.mileageKm || listing.listedPrice || listing.imageCount));
  }

  async function saveToDealRadar() {
    try {
      if (!STATE.listing) STATE.listing = extractListing();
      const settingsError = settingsProblem(STATE.settings);
      if (settingsError) {
        STATE.widget?.render({ status: "disconnected", listing: STATE.listing, valuation: STATE.valuation, message: settingsError });
        return;
      }
      STATE.widget?.render({ status: "analyzing", listing: STATE.listing, valuation: STATE.valuation, message: "Saving to Deal Radar..." });
      const payload = await window.DealerFlowMarketSnapApi.saveListing(STATE.settings, STATE.listing, STATE.valuation);
      STATE.backendResponse = payload;
      STATE.valuation = payload.valuation || STATE.valuation;
      STATE.widget?.render({ status: "saved", listing: STATE.listing, valuation: STATE.valuation, message: "Saved to Deal Radar." });
    } catch (error) {
      STATE.widget?.render({ status: "error", listing: STATE.listing, valuation: STATE.valuation, message: formatError(error) });
    }
  }

  async function copyExtractedJson() {
    const listing = STATE.listing || extractListing();
    await navigator.clipboard.writeText(JSON.stringify(buildCopyPayload(listing), null, 2));
    STATE.widget?.render({ status: "ready", listing, valuation: STATE.valuation, message: "Extracted JSON copied." });
  }

  function buildCopyPayload(listing) {
    const classification = listing.openlaneMetadata?.classification || null;
    const outcomeEvidence = listing.outcomeEvidence || classification?.evidence || [];
    const debug = listing.extractedFields?.debug || {};
    const normalizedExtraction = {
      pageContext: listing.pageContext || null,
      identity: listing.identity || null,
      auctionObservation: listing.auctionObservation || null,
      purchaseOutcome: listing.purchaseOutcome || null,
      condition: listing.condition || null,
      media: listing.media || null,
      carfax: listing.carfax || null,
      debug: listing.debug || null,
    };
    const sectionMap = {
      summary: listing.openlaneMetadata?.sectionMapSummary || listing.debug?.sectionMapSummary || null,
      textRegions: listing.openlaneMetadata?.textRegions || null,
      ignoredEvidence: classification?.ignoredEvidence || debug.ignoredEvidence || [],
    };
    return sanitizeDebugValue({
      normalizedExtraction,
      legacyPayload: listing,
      valuation: STATE.valuation || null,
      classification,
      sectionMap,
      candidateScores: debug.candidateScores || debug.titleCandidates || [],
      safeExpansion: listing.openlaneMetadata?.safeExpansion || STATE.safeExpansion || null,
      networkEvidence: listing.openlaneMetadata?.networkEvidence || [],
      outcomeEvidence,
      debug,
      backendResponse: STATE.backendResponse,
      captureResponse: STATE.captureResponse,
    });
  }

  function hideCurrentPage() {
    STATE.hiddenPageUrl = location.href;
    removeWidget();
  }

  function openDealerFlow() {
    try {
      const settingsError = settingsProblem(STATE.settings);
      if (settingsError) {
        STATE.widget?.render({ status: "disconnected", listing: STATE.listing, valuation: STATE.valuation, message: settingsError });
        return;
      }
      window.open(window.DealerFlowMarketSnapApi.dealerFlowMarketSnapUrl(STATE.settings), "_blank", "noopener,noreferrer");
    } catch (error) {
      STATE.widget?.render({ status: "error", listing: STATE.listing, valuation: STATE.valuation, message: formatError(error) });
    }
  }

  function openSettings() {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }
    window.open(chrome.runtime.getURL("options.html"), "_blank", "noopener,noreferrer");
  }

  function settingsProblem(settings) {
    try {
      window.DealerFlowMarketSnapApi.validateSettings(settings);
      return "";
    } catch (error) {
      return formatError(error);
    }
  }

  function listingSignature(listing) {
    return STATE.captureRuntime?.captureSignature(listing) || [listing.vin, listing.listingUrl, listing.currentBid, listing.buyNowPrice, listing.bestOffer, listing.mileageKm, listing.imageCount, listing.videoCount].join("|");
  }

  function logExtractionDebug(listing) {
    const debug = listing.extractedFields?.debug || {};
    console.groupCollapsed?.("Market Snap OpenLane extraction");
    console.info("URL", location.href);
    console.info("pageType", listing.pageType, "captureKind", listing.captureKind, "outcomeConfidence", listing.outcomeConfidence);
    console.info("evidence markers", listing.openlaneMetadata?.classification?.evidence || []);
    console.info("section map", sanitizeDebugValue(listing.openlaneMetadata?.sectionMapSummary || listing.debug?.sectionMapSummary || listing.openlaneMetadata?.textRegions || {}));
    console.info("main text sample", debug.mainTextSample || listing.openlaneMetadata?.classification?.mainTextSample);
    console.info("ignored evidence", debug.ignoredEvidence || listing.openlaneMetadata?.classification?.ignoredEvidence || []);
    console.info("chosen title evidence", debug.titleCandidates || []);
    console.info("VIN evidence", debug.vinCandidates || []);
    console.info("price evidence", debug.priceCandidates || []);
    console.info("condition evidence", sanitizeDebugValue(listing.condition?.evidence || listing.openlaneMetadata?.conditionDetails?.evidence || []));
    console.info("safe expansion", sanitizeDebugValue(listing.openlaneMetadata?.safeExpansion || STATE.safeExpansion || null));
    console.info("network candidates", sanitizeDebugValue(debug.networkCandidates || listing.openlaneMetadata?.networkEvidence || []));
    console.info("media filtering stats", debug.mediaRejected || []);
    console.groupEnd?.();
  }

  function sanitizeDebugValue(value) {
    if (typeof value === "string") return value.replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted]").replace(/\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{16,}\b/g, "[redacted]");
    if (Array.isArray(value)) return value.map(sanitizeDebugValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|secret|password|credential|authorization|cookie/i.test(key) ? "[redacted]" : sanitizeDebugValue(item)]));
  }

  function formatError(error) {
    const message = error?.message || "Market Snap failed.";
    if (message.includes("Failed to fetch")) return "Dealer Flow is unreachable or blocked by extension origin settings.";
    return message;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "MARKET_SNAP_STATUS") {
      sendResponse({ ok: true, supported: Boolean(STATE.widget), phase: STATE.phase, listing: STATE.listing, valuation: STATE.valuation });
      return;
    }
    if (message?.type === "MARKET_SNAP_EXTRACT") {
      expandReadOnlySections().then(() => {
        const listing = extractListing({ force: true });
        STATE.listing = listing;
        sendResponse({ ok: true, listing });
      }).catch((error) => sendResponse({ ok: false, message: formatError(error) }));
      return true;
    }
    if (message?.type === "MARKET_SNAP_ANALYZE") {
      runRuntime({ force: true, reason: "popup-analyze" }).then(() => sendResponse({ ok: true, listing: STATE.listing, valuation: STATE.valuation })).catch((error) => sendResponse({ ok: false, message: formatError(error) }));
      return true;
    }
    return undefined;
  });
})();
