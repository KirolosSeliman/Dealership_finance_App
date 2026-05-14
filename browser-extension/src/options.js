const baseUrlInput = document.getElementById("dealerFlowBaseUrl");
const organizationInput = document.getElementById("organizationId");
const autoAnalyzeInput = document.getElementById("autoAnalyze");
const autoSaveInput = document.getElementById("autoSave");
const widgetCollapsedInput = document.getElementById("widgetCollapsed");
const debugModeInput = document.getElementById("debugMode");
const includeMediaUrlsInput = document.getElementById("includeMediaUrls");
const includeRawVisibleTextInput = document.getElementById("includeRawVisibleText");
const statusEl = document.getElementById("status");

chrome.storage.sync.get([
  "dealerFlowBaseUrl",
  "organizationId",
  "autoAnalyze",
  "autoSave",
  "widgetCollapsed",
  "debugMode",
  "includeMediaUrls",
  "includeRawVisibleText",
]).then((settings) => {
  baseUrlInput.value = settings.dealerFlowBaseUrl || "http://localhost:3000";
  organizationInput.value = settings.organizationId || "";
  autoAnalyzeInput.checked = settings.autoAnalyze !== false;
  autoSaveInput.checked = Boolean(settings.autoSave);
  widgetCollapsedInput.checked = Boolean(settings.widgetCollapsed);
  debugModeInput.checked = Boolean(settings.debugMode);
  includeMediaUrlsInput.checked = settings.includeMediaUrls !== false;
  includeRawVisibleTextInput.checked = settings.includeRawVisibleText !== false;
});

document.getElementById("saveSettings").addEventListener("click", async () => {
  const dealerFlowBaseUrl = baseUrlInput.value.trim().replace(/\/$/, "");
  const organizationId = organizationInput.value.trim();
  if (!dealerFlowBaseUrl || !organizationId) {
    statusEl.textContent = "Dealer Flow URL and organization ID are required.";
    return;
  }
  try {
    new URL(dealerFlowBaseUrl);
  } catch {
    statusEl.textContent = "Dealer Flow URL is invalid.";
    return;
  }
  await chrome.storage.sync.set({
    dealerFlowBaseUrl,
    organizationId,
    autoAnalyze: autoAnalyzeInput.checked,
    autoSave: autoSaveInput.checked,
    widgetCollapsed: widgetCollapsedInput.checked,
    debugMode: debugModeInput.checked,
    includeMediaUrls: includeMediaUrlsInput.checked,
    includeRawVisibleText: includeRawVisibleTextInput.checked,
  });
  statusEl.textContent = "Settings saved. Refresh OpenLane tabs to apply changes.";
});
