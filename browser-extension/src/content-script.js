(function () {
  if (window.__dealerFlowMarketSnapRuntime) return;
  window.__dealerFlowMarketSnapRuntime = true;

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
    saveResult: null,
    safeExpansion: null,
    hiddenPageUrl: "",
    lastSignature: "",
    currentUrl: location.href,
    running: false,
    saving: false,
    timer: 0,
    observer: null,
    bidLiveMonitor: null,
    readyRetries: 0,
    pendingRun: null,
    settingsRefreshTimer: 0,
    settingsRefreshing: false,
    networkObserverStatus: null,
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
    observeSettingsChanges();
    await runRuntime({ force: false, reason: "boot" });
  }

  async function runRuntime({ force, reason }) {
    if (STATE.running) {
      STATE.pendingRun = { force: Boolean(force), reason };
      return;
    }
    if (force) clearExtractionCache();
    if (!force && STATE.hiddenPageUrl === location.href) return;
    if (!isOpenLaneHost()) {
      removeWidget();
      return;
    }

    ensureWidget();
    STATE.widget.setCollapsed(Boolean(STATE.settings?.widgetCollapsed));
    STATE.widget.render({ status: "detecting", listing: STATE.listing, message: "Checking OpenLane page readiness." });
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

  function isOpenLaneHost() {
    return /(^|\.)openlane\./i.test(location.hostname || "");
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
        scheduleRuntime(0, "settings-saved");
      },
      onSettingsError: (message) => {
        STATE.widget?.render({ status: "warning", listing: STATE.listing, valuation: STATE.valuation, message: sanitizeErrorMessage(message) });
      },
      onActionError: (message) => {
        STATE.widget?.render({ status: "error", listing: STATE.listing, valuation: STATE.valuation, message: sanitizeErrorMessage(message) });
      },
      onHidePage: () => hideCurrentPage(),
    });
    return STATE.widget;
  }

  function removeWidget() {
    stopBidLiveMonitor("widget_removed");
    STATE.widget?.destroy?.();
    STATE.widget = null;
    STATE.listing = null;
    STATE.valuation = null;
    STATE.backendResponse = null;
    STATE.captureResponse = null;
    STATE.saveResult = null;
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
    window.addEventListener("beforeunload", () => stopBidLiveMonitor("page_unload"));
  }

  function observeSettingsChanges() {
    if (!chrome.storage?.onChanged?.addListener) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      if (!Object.keys(changes || {}).some((key) => key in window.DealerFlowMarketSnapStorage.DEFAULT_SETTINGS)) return;
      clearTimeout(STATE.settingsRefreshTimer);
      STATE.settingsRefreshTimer = setTimeout(() => refreshRuntimeSettings("settings-change"), 250);
    });
  }

  async function refreshRuntimeSettings(reason = "settings-change") {
    if (STATE.settingsRefreshing) return;
    STATE.settingsRefreshing = true;
    try {
      STATE.settings = await refreshDeepCaptureConsentState(await window.DealerFlowMarketSnapStorage.getSettings());
      syncDeepCaptureObserver();
      STATE.lastSignature = "";
      clearExtractionCache();
      STATE.widget?.render({
        status: "detecting",
        listing: STATE.listing,
        valuation: STATE.valuation,
        message: deepCaptureRuntimeMessage(),
      });
      scheduleRuntime(0, reason);
    } catch (error) {
      STATE.widget?.render({ status: "warning", listing: STATE.listing, valuation: STATE.valuation, message: formatError(error) });
    } finally {
      STATE.settingsRefreshing = false;
    }
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
    stopBidLiveMonitor("route_changed");
    STATE.currentUrl = location.href;
    clearExtractionCache();
    STATE.lastSignature = "";
    STATE.valuation = null;
    STATE.backendResponse = null;
    STATE.captureResponse = null;
    STATE.saveResult = null;
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

    try {
      if (!STATE.settings?.autoAnalyze && !force) {
        await updateListingOnly();
        return;
      }

      const stableCapture = await extractStableListing({ force });
      const listing = stableCapture.listing;
      STATE.listing = listing;
      STATE.safeExpansion = stableCapture.safeExpansion || null;
      syncBidLiveMonitor(listing);
      if (!stableCapture.readiness.readyToCapture || !isVehicleListing(listing)) {
        STATE.widget?.render({ status: "warning", listing, message: readinessMessage(stableCapture.readiness) });
        return;
      }

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
    } catch (error) {
      STATE.phase = "error";
      STATE.widget?.render({ status: "error", listing: STATE.listing, valuation: STATE.valuation, message: formatError(error) });
      return;
    }

    const listing = STATE.listing;

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

  async function updateListingOnly() {
    try {
      const stableCapture = await extractStableListing({ force: false });
      const listing = stableCapture.listing;
      STATE.phase = "idle";
      STATE.listing = listing;
      STATE.safeExpansion = stableCapture.safeExpansion || null;
      syncBidLiveMonitor(listing);
      STATE.widget?.render({
        status: stableCapture.readiness.readyToCapture ? "idle" : "warning",
        listing,
        message: stableCapture.readiness.readyToCapture ? "Auto-analyze is off. Use Refresh to analyze this page." : readinessMessage(stableCapture.readiness),
      });
    } catch (error) {
      STATE.phase = "error";
      STATE.widget?.render({ status: "error", listing: STATE.listing, valuation: STATE.valuation, message: formatError(error) });
    }
  }

  async function extractStableListing({ force = false } = {}) {
    if (force) clearExtractionCache();
    const stableCapture = await window.DealerFlowOpenLaneStableCapture.extractStableOpenLaneListing(document, location.href, STATE.settings, {
      onSafeExpansion: (safeExpansion) => {
        STATE.safeExpansion = safeExpansion;
      },
    });
    const gated = applyConsentGateToListing(stableCapture.listing || {});
    if (STATE.settings?.debugMode) logExtractionDebug(gated);
    return { ...stableCapture, listing: gated };
  }

  async function refreshDeepCaptureConsentState(settings) {
    const activation = isDeepCaptureAllowed(settings);
    if (activation.deepCaptureActivationMode === "disabled_missing_required_settings" || activation.deepCaptureActivationMode === "disabled_by_user") {
      return window.DealerFlowMarketSnapStorage.saveSettings({
        ...settings,
        deepCaptureConsentStatus: settings?.deepCaptureConsentStatus === "withdrawn" ? "withdrawn" : "off",
      });
    }
    try {
      const response = await window.DealerFlowMarketSnapApi.getDeepCaptureConsentStatus(settings);
      const active = response.consentStatus === "active";
      return window.DealerFlowMarketSnapStorage.saveSettings({
        ...settings,
        deepCaptureEnabled: settings.deepCaptureEnabled !== false,
        observePageNetworkData: settings.observePageNetworkData !== false,
        deepCaptureConsentId: response.deepCaptureConsentId || "",
        deepCaptureConsentVersion: response.deepCaptureConsentVersion || "",
        deepCaptureConsentAcceptedAt: response.deepCaptureConsentAcceptedAt || "",
        deepCaptureConsentStatus: active ? "active" : response.consentStatus || "off",
      });
    } catch (error) {
      if (settings.debugMode) console.warn("Deep Capture consent status check failed", error);
      return window.DealerFlowMarketSnapStorage.saveSettings({
        ...settings,
        deepCaptureEnabled: settings.deepCaptureEnabled !== false,
        observePageNetworkData: settings.observePageNetworkData !== false,
        deepCaptureConsentStatus: "paused",
      });
    }
  }

  function syncDeepCaptureObserver() {
    const activation = isDeepCaptureAllowed();
    if (activation.active) {
      STATE.networkObserverStatus = window.DealerFlowOpenLaneNetworkObserver?.startOpenLaneNetworkObserver?.(STATE.settings, runtimeContext()) || { enabled: false, reason: "network_observer_unavailable" };
      return;
    }
    window.DealerFlowOpenLaneNetworkObserver?.stopOpenLaneNetworkObserver?.();
    STATE.networkObserverStatus = { enabled: false, reason: activation.reason || "deep_capture_inactive", activationMode: activation.deepCaptureActivationMode };
  }

  function isDeepCaptureAllowed(settings = STATE.settings) {
    return window.DealerFlowMarketSnapDeepCaptureActivation?.isDeepCaptureAllowed?.(settings || {}, runtimeContext()) || {
      active: false,
      deepCaptureActivationMode: "disabled_missing_required_settings",
      consentMode: "future_download_consent_pending",
      observePageNetworkData: false,
      reason: "activation_helper_unavailable",
    };
  }

  function runtimeContext() {
    return { href: location.href, hostname: location.hostname };
  }

  function applyConsentGateToListing(listing) {
    const activation = isDeepCaptureAllowed();
    if (activation.active) {
      return {
        ...listing,
        captureLevel: "deep_capture",
        captureScopes: deepCaptureScopes(),
        ...(STATE.settings.deepCaptureConsentId ? { deepCaptureConsentId: STATE.settings.deepCaptureConsentId } : {}),
        sourceEvidence: buildSourceEvidence(listing),
        deepCaptureActivationMode: activation.deepCaptureActivationMode,
        consentMode: activation.consentMode,
        openlaneMetadata: {
          ...(listing.openlaneMetadata || {}),
          debugMode: Boolean(STATE.settings?.debugMode),
          deepCaptureActivationMode: activation.deepCaptureActivationMode,
          consentMode: activation.consentMode,
          deepCaptureRuntime: deepCaptureRuntimeState(),
        },
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
      deepCaptureActivationMode: activation.deepCaptureActivationMode,
      consentMode: activation.consentMode,
      openlaneMetadata: { ...metadata, debugMode: Boolean(STATE.settings?.debugMode), deepCaptureRuntime: deepCaptureRuntimeState() },
    };
  }

  function deepCaptureRuntimeState() {
    const networkEvidenceCount = window.DealerFlowOpenLaneNetworkObserver?.getOpenLaneNetworkEvidence?.().length || 0;
    const observerStatus = window.DealerFlowOpenLaneNetworkObserver?.getOpenLaneNetworkObserverStatus?.() || STATE.networkObserverStatus || { enabled: false, reason: "unknown" };
    const activation = isDeepCaptureAllowed();
    return {
      active: activation.active,
      deepCaptureActivationMode: activation.deepCaptureActivationMode,
      activationMode: activation.deepCaptureActivationMode,
      consentMode: activation.consentMode,
      reason: activation.reason,
      consentStatus: STATE.settings?.deepCaptureConsentStatus || "off",
      consentIdPresent: Boolean(STATE.settings?.deepCaptureConsentId),
      observePageNetworkData: activation.observePageNetworkData,
      networkEvidenceCount,
      networkObserver: { ...observerStatus, observationCount: networkEvidenceCount },
    };
  }

  function deepCaptureRuntimeMessage() {
    const state = deepCaptureRuntimeState();
    if (state.deepCaptureActivationMode === "default_enabled_pending_consent_ui") return state.networkObserver.enabled ? "Deep Capture active by default. Future installer consent UI pending. Network observer running." : `Deep Capture active by default. Future installer consent UI pending. Network observer ${state.networkObserver.reason || "off"}.`;
    if (state.deepCaptureActivationMode === "disabled_missing_required_settings") return "Deep Capture disabled: missing Dealer Flow URL or Organization ID.";
    if (state.active) return state.networkObserver.enabled ? "Deep Capture active. Network observer is on." : `Deep Capture active. Network observer ${state.networkObserver.reason || "off"}.`;
    if (state.consentStatus === "paused") return "Deep Capture paused. Check Dealer Flow connection and consent status.";
    return "Deep Capture off: basic DOM extraction may miss VIN/Carfax on dynamic OpenLane pages.";
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

  function clearExtractionCache() {
    window.DealerFlowOpenLaneSectionMap?.clearOpenLaneExtractionCache?.(document);
  }

  function syncBidLiveMonitor(listing) {
    if (!shouldRunBidLiveMonitor(listing)) {
      stopBidLiveMonitor("not_active_bid_page");
      return;
    }
    const existing = STATE.bidLiveMonitor?.getStatus?.();
    if (existing?.active && existing.href === location.href) return;
    stopBidLiveMonitor("replaced");
    STATE.bidLiveMonitor = window.DealerFlowOpenLaneBidLiveMonitor?.startOpenLaneBidLiveMonitor?.({
      doc: document,
      href: location.href,
      getHref: () => location.href,
      getListing: () => STATE.listing,
      onBidUpdate: (nextListing, metadata) => {
        STATE.listing = applyConsentGateToListing(nextListing);
        STATE.lastSignature = listingSignature(STATE.listing);
        STATE.widget?.render({
          status: STATE.phase === "success" ? "ready" : "idle",
          listing: STATE.listing,
          valuation: STATE.valuation,
          message: bidLiveMonitorMessage(metadata),
        });
      },
    }) || null;
  }

  function stopBidLiveMonitor(reason = "stopped") {
    STATE.bidLiveMonitor?.stop?.(reason);
    STATE.bidLiveMonitor = null;
  }

  function shouldRunBidLiveMonitor(listing = STATE.listing) {
    if (!listing || !isOpenLaneHost()) return false;
    if (listing.pageType && listing.pageType !== "active_listing") return false;
    if (listing.captureKind && listing.captureKind !== "observation") return false;
    if (listing.soldPriceCandidate || listing.buyPriceAuction || listing.finalBidAmount) return false;
    return Boolean(window.DealerFlowOpenLaneBidLiveMonitor?.startOpenLaneBidLiveMonitor);
  }

  function bidLiveMonitorMessage(metadata = {}) {
    const previous = moneyLabel(metadata.previousBid);
    const next = moneyLabel(metadata.currentBid);
    return previous && next ? `Current bid updated from ${previous} to ${next}.` : "Current bid updated.";
  }

  function isVehicleListing(listing) {
    return Boolean(listing && (listing.vin || (listing.year && listing.make && listing.model)) && (listing.mileageKm || listing.listedPrice || listing.imageCount));
  }

  async function saveToDealRadar() {
    if (STATE.saving) return;
    STATE.saving = true;
    try {
      const stableCapture = await extractStableListing({ force: true });
      STATE.listing = stableCapture.listing;
      STATE.safeExpansion = stableCapture.safeExpansion || null;
      if (!stableCapture.readiness.readyToCapture) {
        STATE.widget?.render({ status: "warning", listing: STATE.listing, valuation: STATE.valuation, message: readinessMessage(stableCapture.readiness) });
        return;
      }
      const settingsError = settingsProblem(STATE.settings);
      if (settingsError) {
        STATE.widget?.render({ status: "disconnected", listing: STATE.listing, valuation: STATE.valuation, message: settingsError });
        return;
      }
      STATE.saveResult = null;
      STATE.widget?.render({ status: "saving", listing: STATE.listing, valuation: STATE.valuation, message: "Saving to Deal Radar..." });
      const payload = await window.DealerFlowMarketSnapApi.saveListing(STATE.settings, STATE.listing, STATE.valuation);
      STATE.backendResponse = payload;
      STATE.saveResult = payload;
      STATE.valuation = payload.valuation || STATE.valuation;
      STATE.widget?.render({ status: "saved", listing: STATE.listing, valuation: STATE.valuation, saveResult: payload, message: "Saved to Deal Radar." });
    } catch (error) {
      STATE.widget?.render({ status: "error", listing: STATE.listing, valuation: STATE.valuation, message: formatError(error) });
    } finally {
      STATE.saving = false;
    }
  }

  async function copyExtractedJson() {
    try {
      let listing = STATE.listing;
      if (!listing) {
        const stableCapture = await extractStableListing({ force: true });
        listing = stableCapture.listing;
        STATE.listing = listing;
        STATE.safeExpansion = stableCapture.safeExpansion || null;
      }
      await navigator.clipboard.writeText(JSON.stringify(buildCopyPayload(listing), null, 2));
      STATE.widget?.render({ status: "ready", listing, valuation: STATE.valuation, message: "Extracted JSON copied." });
    } catch (error) {
      STATE.widget?.render({ status: "error", listing: STATE.listing, valuation: STATE.valuation, message: formatError(error) });
    }
  }

  function buildCopyPayload(listing) {
    return window.DealerFlowMarketSnapCopyPayload.buildCopyPayload(listing, {
      valuation: STATE.valuation,
      safeExpansion: STATE.safeExpansion,
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

  function readinessMessage(readiness = {}) {
    if (readiness.state === "unsupported_page") return "Vehicle data is still loading.";
    if (readiness.blockedReason === "missing_vin_openlane_preview_only") return "VIN missing. Preview only - capture blocked to avoid bad data.";
    if (readiness.state === "incomplete_identity" && readiness.vinStatus !== "found") return "VIN missing. Capture blocked to avoid bad data.";
    if (readiness.state === "incomplete_identity") return "OpenLane vehicle identity is incomplete. Waiting for stronger vehicle details before capture.";
    if (readiness.state === "pending_vehicle_data") return "Vehicle data is still loading.";
    if (readiness.state === "ready_to_capture") return "Ready to capture.";
    return readiness.blockedReason || "OpenLane vehicle data is incomplete.";
  }

  function listingSignature(listing) {
    return STATE.captureRuntime?.captureSignature(listing) || [listing.vin, listing.listingUrl, listing.currentBid, listing.buyNowPrice, listing.bestOffer, listing.mileageKm, listing.imageCount, listing.videoCount].join("|");
  }

  function moneyLabel(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) && amount > 0 ? `$${amount.toLocaleString("en-CA")}` : "";
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
    if (typeof value === "string") return sanitizeErrorMessage(value);
    if (Array.isArray(value)) return value.map(sanitizeDebugValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|secret|password|credential|authorization|cookie/i.test(key) ? "[redacted]" : sanitizeDebugValue(item)]));
  }

  function sanitizeErrorMessage(message) {
    return String(message || "Market Snap failed.")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
      .replace(/\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
      .replace(/\b(authorization|cookie|token|secret|credential|session|password|csrf|jwt)\b\s*[:=]\s*[^,\s;]+/gi, "$1=[redacted]")
      .slice(0, 500);
  }

  function formatError(error) {
    const message = error?.message || "Market Snap failed.";
    if (message.includes("Failed to fetch")) return "Dealer Flow is unreachable or blocked by extension origin settings.";
    return sanitizeErrorMessage(message);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "MARKET_SNAP_STATUS") {
      sendResponse({ ok: true, supported: Boolean(STATE.widget), phase: STATE.phase, listing: STATE.listing, valuation: STATE.valuation });
      return;
    }
    if (message?.type === "MARKET_SNAP_EXTRACT") {
      extractStableListing({ force: true }).then((stableCapture) => {
        const listing = stableCapture.listing;
        STATE.listing = listing;
        STATE.safeExpansion = stableCapture.safeExpansion || null;
        sendResponse({ ok: true, listing, readiness: stableCapture.readiness, debug: stableCapture.debug });
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
