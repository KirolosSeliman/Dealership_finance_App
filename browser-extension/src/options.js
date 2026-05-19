const baseUrlInput = document.getElementById("dealerFlowBaseUrl");
const organizationInput = document.getElementById("organizationId");
const autoAnalyzeInput = document.getElementById("autoAnalyze");
const autoCaptureInput = document.getElementById("autoCapture");
const autoSaveInput = document.getElementById("autoSave");
const deepCaptureEnabledInput = document.getElementById("deepCaptureEnabled");
const modelImprovementOptInInput = document.getElementById("modelImprovementOptIn");
const widgetCollapsedInput = document.getElementById("widgetCollapsed");
const debugModeInput = document.getElementById("debugMode");
const includeMediaUrlsInput = document.getElementById("includeMediaUrls");
const includeRawVisibleTextInput = document.getElementById("includeRawVisibleText");
const observePageNetworkDataInput = document.getElementById("observePageNetworkData");
const deepCaptureStatusBadge = document.getElementById("deepCaptureStatusBadge");
const statusEl = document.getElementById("status");

loadSettings();

async function loadSettings() {
  const settings = await window.DealerFlowMarketSnapApi.getMarketSnapSettings();
  baseUrlInput.value = settings.dealerFlowBaseUrl;
  organizationInput.value = settings.organizationId;
  autoAnalyzeInput.checked = settings.autoAnalyze !== false;
  autoCaptureInput.checked = settings.autoCapture !== false;
  autoSaveInput.checked = Boolean(settings.autoSave);
  deepCaptureEnabledInput.checked = Boolean(settings.deepCaptureEnabled);
  modelImprovementOptInInput.checked = Boolean(settings.modelImprovementOptIn);
  widgetCollapsedInput.checked = Boolean(settings.widgetCollapsed);
  debugModeInput.checked = Boolean(settings.debugMode);
  includeMediaUrlsInput.checked = settings.includeMediaUrls !== false;
  includeRawVisibleTextInput.checked = settings.includeRawVisibleText !== false;
  observePageNetworkDataInput.checked = Boolean(settings.observePageNetworkData);
  updateDeepCaptureStatus(settings.deepCaptureConsentStatus || "off", settings);
  await refreshDeepCaptureConsent({ quiet: true });
}

document.getElementById("saveSettings").addEventListener("click", async () => {
  const dealerFlowBaseUrl = baseUrlInput.value.trim().replace(/\/$/, "");
  if (!dealerFlowBaseUrl) {
    statusEl.textContent = "Dealer Flow URL is required.";
    return;
  }
  try {
    window.DealerFlowMarketSnapApi.buildDealerFlowUrl("/", { dealerFlowBaseUrl });
  } catch (error) {
    statusEl.textContent = window.DealerFlowMarketSnapApi.formatApiError(error);
    return;
  }

  const saved = await window.DealerFlowMarketSnapApi.saveMarketSnapSettings({
    dealerFlowBaseUrl,
    organizationId: organizationInput.value.trim(),
    autoAnalyze: autoAnalyzeInput.checked,
    autoCapture: autoCaptureInput.checked,
    autoSave: autoSaveInput.checked,
    deepCaptureEnabled: deepCaptureEnabledInput.checked,
    modelImprovementOptIn: modelImprovementOptInInput.checked,
    widgetCollapsed: widgetCollapsedInput.checked,
    debugMode: debugModeInput.checked,
    includeMediaUrls: includeMediaUrlsInput.checked,
    includeRawVisibleText: includeRawVisibleTextInput.checked,
    observePageNetworkData: observePageNetworkDataInput.checked,
  });
  statusEl.textContent = saved.organizationId
    ? "Settings saved. Refresh OpenLane tabs to apply changes."
    : "Settings saved without an organization ID. The widget will stay disconnected until one is added.";
  applySettingsToForm(saved);
});

document.getElementById("refreshDeepCaptureConsent").addEventListener("click", () => refreshDeepCaptureConsent({ quiet: false }));
document.getElementById("acceptDeepCaptureConsent").addEventListener("click", acceptDeepCaptureConsent);
document.getElementById("withdrawDeepCaptureConsent").addEventListener("click", withdrawDeepCaptureConsent);

async function refreshDeepCaptureConsent({ quiet } = { quiet: false }) {
  const settings = await window.DealerFlowMarketSnapApi.getMarketSnapSettings();
  if (!settings.organizationId) {
    updateDeepCaptureStatus("off", settings);
    return;
  }
  try {
    const response = await window.DealerFlowMarketSnapApi.getDeepCaptureConsentStatus(settings);
    await saveConsentState(settings, response);
    if (!quiet) statusEl.textContent = "Deep Capture consent status refreshed.";
  } catch (error) {
    await window.DealerFlowMarketSnapApi.saveMarketSnapSettings({
      ...settings,
      deepCaptureEnabled: settings.deepCaptureEnabled !== false,
      deepCaptureConsentStatus: "paused",
      observePageNetworkData: settings.observePageNetworkData !== false,
    });
    updateDeepCaptureStatus("paused", settings);
    if (!quiet) statusEl.textContent = window.DealerFlowMarketSnapApi.formatApiError(error);
  }
}

async function acceptDeepCaptureConsent() {
  const settings = { ...(await window.DealerFlowMarketSnapApi.getMarketSnapSettings()), ...collectSettingsForConsent() };
  try {
    const response = await window.DealerFlowMarketSnapApi.acceptDeepCaptureConsent(settings, {
      modelImprovementOptIn: modelImprovementOptInInput.checked,
    });
    await saveConsentState(settings, response);
    statusEl.textContent = "Deep Capture consent accepted. OpenLane pages will use Deep Capture by default for this consenting context.";
  } catch (error) {
    updateDeepCaptureStatus("paused", settings);
    statusEl.textContent = window.DealerFlowMarketSnapApi.formatApiError(error);
  }
}

async function withdrawDeepCaptureConsent() {
  const settings = { ...(await window.DealerFlowMarketSnapApi.getMarketSnapSettings()), ...collectSettingsForConsent() };
  try {
    await window.DealerFlowMarketSnapApi.withdrawDeepCaptureConsent(settings);
    const saved = await window.DealerFlowMarketSnapApi.saveMarketSnapSettings({
      ...settings,
      deepCaptureEnabled: false,
      deepCaptureConsentId: "",
      deepCaptureConsentVersion: "",
      deepCaptureConsentAcceptedAt: "",
      deepCaptureConsentStatus: "withdrawn",
      observePageNetworkData: false,
    });
    applySettingsToForm(saved);
    statusEl.textContent = "Deep Capture consent withdrawn. Network/deep capture is off immediately.";
  } catch (error) {
    updateDeepCaptureStatus("paused");
    statusEl.textContent = window.DealerFlowMarketSnapApi.formatApiError(error);
  }
}

function collectSettingsForConsent() {
  return {
    dealerFlowBaseUrl: baseUrlInput.value.trim().replace(/\/$/, ""),
    organizationId: organizationInput.value.trim(),
    modelImprovementOptIn: modelImprovementOptInInput.checked,
  };
}

async function saveConsentState(settings, response) {
  const active = response.consentStatus === "active";
  const saved = await window.DealerFlowMarketSnapApi.saveMarketSnapSettings({
    ...settings,
    autoAnalyze: autoAnalyzeInput.checked,
    autoCapture: autoCaptureInput.checked,
    autoSave: autoSaveInput.checked,
    modelImprovementOptIn: modelImprovementOptInInput.checked,
    widgetCollapsed: widgetCollapsedInput.checked,
    debugMode: debugModeInput.checked,
    includeMediaUrls: includeMediaUrlsInput.checked,
    includeRawVisibleText: includeRawVisibleTextInput.checked,
    deepCaptureEnabled: settings.deepCaptureEnabled !== false,
    deepCaptureConsentId: response.deepCaptureConsentId || "",
    deepCaptureConsentVersion: response.deepCaptureConsentVersion || "",
    deepCaptureConsentAcceptedAt: response.deepCaptureConsentAcceptedAt || "",
    deepCaptureConsentStatus: active ? "active" : response.consentStatus || "off",
    observePageNetworkData: settings.observePageNetworkData !== false,
  });
  applySettingsToForm(saved);
}

function applySettingsToForm(settings) {
  deepCaptureEnabledInput.checked = Boolean(settings.deepCaptureEnabled);
  modelImprovementOptInInput.checked = Boolean(settings.modelImprovementOptIn);
  observePageNetworkDataInput.checked = Boolean(settings.observePageNetworkData);
  updateDeepCaptureStatus(settings.deepCaptureConsentStatus, settings);
}

function updateDeepCaptureStatus(status, settings = {}) {
  const activation = window.DealerFlowMarketSnapDeepCaptureActivation?.isDeepCaptureAllowed?.(settings, { href: "https://app.openlane.ca/" });
  if (activation?.deepCaptureActivationMode === "default_enabled_pending_consent_ui") {
    deepCaptureStatusBadge.textContent = "Active by default - consent UI pending";
    deepCaptureEnabledInput.disabled = false;
    observePageNetworkDataInput.disabled = false;
    return;
  }
  if (activation?.deepCaptureActivationMode === "disabled_missing_required_settings") {
    deepCaptureStatusBadge.textContent = "Off - missing Dealer Flow URL or Organization ID";
    deepCaptureEnabledInput.disabled = false;
    observePageNetworkDataInput.disabled = false;
    return;
  }
  const labels = {
    active: "On - active consent",
    paused: "Paused - backend unreachable",
    requires_renewal: "Requires renewal - consent version changed",
    withdrawn: "Off - consent needed",
    off: "Off - consent needed",
  };
  deepCaptureStatusBadge.textContent = labels[status] || labels.off;
  deepCaptureEnabledInput.disabled = false;
  observePageNetworkDataInput.disabled = false;
}
