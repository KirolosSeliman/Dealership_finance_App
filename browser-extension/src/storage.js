(function () {
  const DEFAULT_SETTINGS = {
    dealerFlowBaseUrl: "http://localhost:3000",
    organizationId: "",
    autoAnalyze: true,
    autoSave: false,
    widgetCollapsed: false,
    debugMode: false,
    includeMediaUrls: true,
    includeRawVisibleText: true,
  };

  async function getSettings() {
    const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  async function saveSettings(values) {
    const normalized = {
      dealerFlowBaseUrl: String(values.dealerFlowBaseUrl || DEFAULT_SETTINGS.dealerFlowBaseUrl).trim().replace(/\/$/, ""),
      organizationId: String(values.organizationId || "").trim(),
      autoAnalyze: Boolean(values.autoAnalyze),
      autoSave: Boolean(values.autoSave),
      widgetCollapsed: Boolean(values.widgetCollapsed),
      debugMode: Boolean(values.debugMode),
      includeMediaUrls: values.includeMediaUrls !== false,
      includeRawVisibleText: values.includeRawVisibleText !== false,
    };
    await chrome.storage.sync.set(normalized);
    return normalized;
  }

  window.DealerFlowMarketSnapStorage = {
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
  };
})();
