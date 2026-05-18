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
    deepCaptureEnabled: false,
    deepCaptureConsentId: "",
    deepCaptureConsentVersion: "",
    deepCaptureConsentAcceptedAt: "",
    deepCaptureConsentStatus: "off",
  };

  async function getSettings() {
    const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
    const extensionInstallationId = await getExtensionInstallationId();
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...stored, extensionInstallationId });
  }

  async function getMarketSnapSettings() {
    return getSettings();
  }

  async function saveSettings(values) {
    const existing = await readStoredSettings();
    const organizationId = String(values.organizationId ?? existing.organizationId ?? "").trim();
    const sameOrganization = !existing.organizationId || existing.organizationId === organizationId;
    const consentBase = sameOrganization ? existing : {
      deepCaptureEnabled: false,
      observePageNetworkData: false,
      deepCaptureConsentId: "",
      deepCaptureConsentVersion: "",
      deepCaptureConsentAcceptedAt: "",
      deepCaptureConsentStatus: "off",
    };
    const normalized = normalizeSettings({
      dealerFlowBaseUrl: String(values.dealerFlowBaseUrl || DEFAULT_SETTINGS.dealerFlowBaseUrl).trim().replace(/\/$/, ""),
      organizationId,
      autoAnalyze: Boolean(values.autoAnalyze),
      autoCapture: values.autoCapture !== false,
      autoSave: Boolean(values.autoSave),
      modelImprovementOptIn: Boolean(values.modelImprovementOptIn),
      widgetCollapsed: Boolean(values.widgetCollapsed),
      debugMode: Boolean(values.debugMode),
      includeMediaUrls: values.includeMediaUrls !== false,
      includeRawVisibleText: values.includeRawVisibleText !== false,
      observePageNetworkData: values.observePageNetworkData ?? consentBase.observePageNetworkData,
      deepCaptureEnabled: values.deepCaptureEnabled ?? consentBase.deepCaptureEnabled,
      deepCaptureConsentId: String(values.deepCaptureConsentId ?? consentBase.deepCaptureConsentId ?? ""),
      deepCaptureConsentVersion: String(values.deepCaptureConsentVersion ?? consentBase.deepCaptureConsentVersion ?? ""),
      deepCaptureConsentAcceptedAt: String(values.deepCaptureConsentAcceptedAt ?? consentBase.deepCaptureConsentAcceptedAt ?? ""),
      deepCaptureConsentStatus: String(values.deepCaptureConsentStatus ?? consentBase.deepCaptureConsentStatus ?? "off"),
      extensionInstallationId: String(values.extensionInstallationId || existing.extensionInstallationId || await getExtensionInstallationId()),
    });
    const syncSettings = { ...normalized };
    delete syncSettings.extensionInstallationId;
    await chrome.storage.sync.set(syncSettings);
    return normalized;
  }

  async function readStoredSettings() {
    const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
    const extensionInstallationId = await getExtensionInstallationId();
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...stored, extensionInstallationId });
  }

  async function saveMarketSnapSettings(settings) {
    return saveSettings(settings);
  }

  function normalizeSettings(settings) {
    const deepCaptureConsentStatus = normalizeConsentStatus(settings.deepCaptureConsentStatus);
    const deepCaptureEnabled = Boolean(settings.organizationId && settings.deepCaptureEnabled && deepCaptureConsentStatus === "active" && settings.deepCaptureConsentId);
    return {
      ...settings,
      deepCaptureConsentStatus,
      deepCaptureEnabled,
      observePageNetworkData: Boolean(settings.observePageNetworkData && deepCaptureEnabled && deepCaptureConsentStatus === "active"),
      modelImprovementOptIn: Boolean(settings.modelImprovementOptIn),
    };
  }

  function normalizeConsentStatus(value) {
    return ["off", "active", "paused", "requires_renewal", "withdrawn"].includes(value) ? value : "off";
  }

  async function getExtensionInstallationId() {
    const stored = await chrome.storage.local.get("extensionInstallationId");
    if (stored?.extensionInstallationId) return stored.extensionInstallationId;
    const id = crypto.randomUUID ? crypto.randomUUID() : `install-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await chrome.storage.local.set({ extensionInstallationId: id });
    return id;
  }

  window.DealerFlowMarketSnapStorage = {
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
    getMarketSnapSettings,
    saveMarketSnapSettings,
  };
})();
