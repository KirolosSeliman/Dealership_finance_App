(function () {
  const DEFAULT_SETTINGS = {
    dealerFlowBaseUrl: "http://localhost:3000",
    organizationId: "",
    autoAnalyze: true,
    autoCapture: true,
    autoSave: false,
    modelImprovementOptIn: false,
    widgetCollapsed: false,
    debugMode: false,
    includeMediaUrls: true,
    includeRawVisibleText: true,
    observePageNetworkData: false,
  };

  async function getSettings() {
    const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  async function getMarketSnapSettings() {
    return getSettings();
  }

  async function saveSettings(values) {
    const normalized = {
      dealerFlowBaseUrl: String(values.dealerFlowBaseUrl || DEFAULT_SETTINGS.dealerFlowBaseUrl).trim().replace(/\/$/, ""),
      organizationId: String(values.organizationId || "").trim(),
      autoAnalyze: Boolean(values.autoAnalyze),
      autoCapture: values.autoCapture !== false,
      autoSave: Boolean(values.autoSave),
      modelImprovementOptIn: Boolean(values.modelImprovementOptIn),
      widgetCollapsed: Boolean(values.widgetCollapsed),
      debugMode: Boolean(values.debugMode),
      includeMediaUrls: values.includeMediaUrls !== false,
      includeRawVisibleText: values.includeRawVisibleText !== false,
      observePageNetworkData: Boolean(values.observePageNetworkData),
    };
    await chrome.storage.sync.set(normalized);
    return normalized;
  }

  async function saveMarketSnapSettings(settings) {
    return saveSettings(settings);
  }

  window.DealerFlowMarketSnapStorage = {
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
    getMarketSnapSettings,
    saveMarketSnapSettings,
  };
})();
