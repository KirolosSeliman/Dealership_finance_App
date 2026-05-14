(function () {
  const STATE = {
    widget: null,
    settings: null,
    listing: null,
    valuation: null,
    lastSignature: "",
    running: false,
    timer: 0,
  };

  boot();

  async function boot() {
    STATE.settings = await window.DealerFlowMarketSnapStorage.getSettings();
    if (!window.DealerFlowOpenLaneExtractor.isLikelyOpenLaneVehiclePage(document, location.href)) return;
    STATE.widget = window.DealerFlowMarketSnapWidget.createMarketSnapWidget({
      onRefresh: () => runAnalysis({ force: true }),
      onSave: () => saveToDealRadar(),
      onCopy: () => copyExtractedJson(),
      onOpenDealerFlow: () => openDealerFlow(),
    });
    STATE.widget.setCollapsed(Boolean(STATE.settings.widgetCollapsed));
    STATE.widget.render({ status: "loading", message: "Detected OpenLane page." });
    scheduleAnalysis(250);
    observeDynamicPage();
  }

  function observeDynamicPage() {
    const observer = new MutationObserver(() => scheduleAnalysis(900));
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.addEventListener("popstate", () => scheduleAnalysis(500));
  }

  function scheduleAnalysis(delay) {
    clearTimeout(STATE.timer);
    STATE.timer = setTimeout(() => runAnalysis({ force: false }), delay);
  }

  async function runAnalysis({ force }) {
    if (STATE.running) return;
    if (!STATE.settings?.autoAnalyze && !force) {
      updateListingOnly();
      return;
    }
    const listing = extractListing();
    if (!isVehicleListing(listing)) return;
    const signature = listingSignature(listing);
    if (!force && signature === STATE.lastSignature) return;
    STATE.lastSignature = signature;
    STATE.listing = listing;
    STATE.running = true;
    STATE.widget?.render({ status: "loading", listing, message: "Analyzing visible OpenLane data..." });
    try {
      window.DealerFlowMarketSnapApi.validateSettings(STATE.settings);
      const payload = await window.DealerFlowMarketSnapApi.analyzeListing(STATE.settings, listing);
      STATE.valuation = payload.valuation;
      STATE.widget?.render({ status: "ready", listing, valuation: STATE.valuation, message: "" });
      if (STATE.settings.autoSave) await saveToDealRadar();
    } catch (error) {
      STATE.widget?.render({ status: "error", listing, valuation: STATE.valuation, message: formatError(error) });
    } finally {
      STATE.running = false;
    }
  }

  function updateListingOnly() {
    const listing = extractListing();
    if (!isVehicleListing(listing)) return;
    STATE.listing = listing;
    STATE.widget?.render({ status: "idle", listing, message: "Auto-analyze is off. Use Refresh to analyze this page." });
  }

  function extractListing() {
    return window.DealerFlowOpenLaneExtractor.extractOpenLaneListing(document, location.href, {
      includeMediaUrls: STATE.settings?.includeMediaUrls !== false,
      includeRawVisibleText: STATE.settings?.includeRawVisibleText !== false,
    });
  }

  function isVehicleListing(listing) {
    return Boolean(listing && (listing.vin || (listing.year && listing.make && listing.model)) && (listing.mileageKm || listing.listedPrice || listing.imageCount));
  }

  async function saveToDealRadar() {
    try {
      if (!STATE.listing) STATE.listing = extractListing();
      STATE.widget?.render({ status: "loading", listing: STATE.listing, valuation: STATE.valuation, message: "Saving to Deal Radar..." });
      window.DealerFlowMarketSnapApi.validateSettings(STATE.settings);
      const payload = await window.DealerFlowMarketSnapApi.saveListing(STATE.settings, STATE.listing, STATE.valuation);
      STATE.valuation = payload.valuation || STATE.valuation;
      STATE.widget?.render({ status: "saved", listing: STATE.listing, valuation: STATE.valuation, message: "Saved to Deal Radar." });
    } catch (error) {
      STATE.widget?.render({ status: "error", listing: STATE.listing, valuation: STATE.valuation, message: formatError(error) });
    }
  }

  async function copyExtractedJson() {
    const listing = STATE.listing || extractListing();
    await navigator.clipboard.writeText(JSON.stringify({ listing, valuation: STATE.valuation || null }, null, 2));
    STATE.widget?.render({ status: "ready", listing, valuation: STATE.valuation, message: "Extracted JSON copied." });
  }

  function openDealerFlow() {
    try {
      window.open(window.DealerFlowMarketSnapApi.dealerFlowMarketSnapUrl(STATE.settings), "_blank", "noopener,noreferrer");
    } catch (error) {
      STATE.widget?.render({ status: "error", listing: STATE.listing, valuation: STATE.valuation, message: formatError(error) });
    }
  }

  function listingSignature(listing) {
    return [listing.vin, listing.listingUrl, listing.currentBid, listing.buyNowPrice, listing.mileageKm, listing.imageCount, listing.videoCount].join("|");
  }

  function formatError(error) {
    const message = error?.message || "Market Snap failed.";
    if (message.includes("Failed to fetch")) return "Dealer Flow is unreachable or blocked by extension origin settings.";
    return message;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "MARKET_SNAP_STATUS") {
      sendResponse({ ok: true, supported: Boolean(STATE.widget), listing: STATE.listing, valuation: STATE.valuation });
      return;
    }
    if (message?.type === "MARKET_SNAP_EXTRACT") {
      const listing = extractListing();
      STATE.listing = listing;
      sendResponse({ ok: true, listing });
      return;
    }
    if (message?.type === "MARKET_SNAP_ANALYZE") {
      runAnalysis({ force: true }).then(() => sendResponse({ ok: true, listing: STATE.listing, valuation: STATE.valuation })).catch((error) => sendResponse({ ok: false, message: formatError(error) }));
      return true;
    }
    return undefined;
  });
})();
