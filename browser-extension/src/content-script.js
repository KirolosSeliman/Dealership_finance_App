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
    hiddenPageUrl: "",
    lastSignature: "",
    currentUrl: location.href,
    running: false,
    timer: 0,
    observer: null,
    readyRetries: 0,
  };

  boot();

  async function boot() {
    await waitForBody();
    STATE.settings = await window.DealerFlowMarketSnapStorage.getSettings();
    STATE.captureRuntime = window.DealerFlowMarketSnapCaptureRuntime.createMarketSnapCaptureRuntime({
      api: window.DealerFlowMarketSnapApi,
      now: () => Date.now(),
    });
    observeDynamicPage();
    await runRuntime({ force: false, reason: "boot" });
  }

  async function runRuntime({ force, reason }) {
    if (STATE.running) return;
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
      if (isSupportedOpenLaneVehiclePage()) return true;
      await sleep(READY_RETRY_DELAY_MS);
    }
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
    STATE.observer = new MutationObserver(() => scheduleRuntime(AUTO_ANALYZE_DEBOUNCE_MS, "mutation"));
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
    STATE.lastSignature = "";
    STATE.valuation = null;
    STATE.backendResponse = null;
    STATE.captureResponse = null;
    scheduleRuntime(ROUTE_CHANGE_DEBOUNCE_MS, "route-change");
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

    const listing = extractListing();
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

  function extractListing() {
    const classification = classifyOpenLanePage();
    const listing = window.DealerFlowOpenLaneExtractor.extractOpenLaneListing(document, location.href, {
      includeMediaUrls: STATE.settings?.includeMediaUrls !== false,
      includeRawVisibleText: STATE.settings?.includeRawVisibleText !== false,
    });
    return {
      ...listing,
      pageType: classification.pageType,
      captureKind: classification.captureKind,
      outcomeConfidence: classification.outcomeConfidence,
      openlaneMetadata: { ...(listing.openlaneMetadata || {}), classification },
    };
  }

  function classifyOpenLanePage() {
    return window.DealerFlowOpenLanePageClassifier.classifyOpenLanePage(document, location.href);
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
    const classification = listing.openlaneMetadata?.classification || null;
    const outcomeEvidence = listing.outcomeEvidence || classification?.evidence || [];
    await navigator.clipboard.writeText(JSON.stringify({ listing, valuation: STATE.valuation || null, classification, outcomeEvidence, backendResponse: STATE.backendResponse, captureResponse: STATE.captureResponse }, null, 2));
    STATE.widget?.render({ status: "ready", listing, valuation: STATE.valuation, message: "Extracted JSON copied." });
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
    return STATE.captureRuntime?.captureSignature(listing) || [listing.vin, listing.listingUrl, listing.currentBid, listing.buyNowPrice, listing.mileageKm, listing.imageCount, listing.videoCount].join("|");
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
      const listing = extractListing();
      STATE.listing = listing;
      sendResponse({ ok: true, listing });
      return;
    }
    if (message?.type === "MARKET_SNAP_ANALYZE") {
      runRuntime({ force: true, reason: "popup-analyze" }).then(() => sendResponse({ ok: true, listing: STATE.listing, valuation: STATE.valuation })).catch((error) => sendResponse({ ok: false, message: formatError(error) }));
      return true;
    }
    return undefined;
  });
})();
