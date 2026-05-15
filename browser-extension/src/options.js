const baseUrlInput = document.getElementById("dealerFlowBaseUrl");
const organizationInput = document.getElementById("organizationId");
const autoAnalyzeInput = document.getElementById("autoAnalyze");
const autoCaptureInput = document.getElementById("autoCapture");
const autoSaveInput = document.getElementById("autoSave");
const modelImprovementOptInInput = document.getElementById("modelImprovementOptIn");
const widgetCollapsedInput = document.getElementById("widgetCollapsed");
const debugModeInput = document.getElementById("debugMode");
const includeMediaUrlsInput = document.getElementById("includeMediaUrls");
const includeRawVisibleTextInput = document.getElementById("includeRawVisibleText");
const statusEl = document.getElementById("status");

loadSettings();

async function loadSettings() {
  const settings = await window.DealerFlowMarketSnapApi.getMarketSnapSettings();
  baseUrlInput.value = settings.dealerFlowBaseUrl;
  organizationInput.value = settings.organizationId;
  autoAnalyzeInput.checked = settings.autoAnalyze !== false;
  autoCaptureInput.checked = settings.autoCapture !== false;
  autoSaveInput.checked = Boolean(settings.autoSave);
  modelImprovementOptInInput.checked = Boolean(settings.modelImprovementOptIn);
  widgetCollapsedInput.checked = Boolean(settings.widgetCollapsed);
  debugModeInput.checked = Boolean(settings.debugMode);
  includeMediaUrlsInput.checked = settings.includeMediaUrls !== false;
  includeRawVisibleTextInput.checked = settings.includeRawVisibleText !== false;
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
    modelImprovementOptIn: modelImprovementOptInInput.checked,
    widgetCollapsed: widgetCollapsedInput.checked,
    debugMode: debugModeInput.checked,
    includeMediaUrls: includeMediaUrlsInput.checked,
    includeRawVisibleText: includeRawVisibleTextInput.checked,
  });
  statusEl.textContent = saved.organizationId
    ? "Settings saved. Refresh OpenLane tabs to apply changes."
    : "Settings saved without an organization ID. The widget will stay disconnected until one is added.";
});
