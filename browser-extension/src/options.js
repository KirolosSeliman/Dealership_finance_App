const baseUrlInput = document.getElementById("dealerFlowBaseUrl");
const organizationInput = document.getElementById("organizationId");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(["dealerFlowBaseUrl", "organizationId"]).then((settings) => {
  baseUrlInput.value = settings.dealerFlowBaseUrl || "http://localhost:3000";
  organizationInput.value = settings.organizationId || "";
});

document.getElementById("saveSettings").addEventListener("click", async () => {
  const dealerFlowBaseUrl = baseUrlInput.value.trim().replace(/\/$/, "");
  const organizationId = organizationInput.value.trim();
  if (!dealerFlowBaseUrl || !organizationId) {
    statusEl.textContent = "Dealer Flow URL and organization ID are required.";
    return;
  }
  await chrome.storage.sync.set({ dealerFlowBaseUrl, organizationId });
  statusEl.textContent = "Settings saved.";
});
