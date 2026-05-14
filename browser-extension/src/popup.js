const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const settingsButton = document.getElementById("settings");
const analyzeButton = document.getElementById("analyze");
const openDealerFlowButton = document.getElementById("openDealerFlow");

settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
analyzeButton.addEventListener("click", analyzeCurrentPage);
openDealerFlowButton.addEventListener("click", openDealerFlow);

renderStatus();

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  return tab;
}

async function renderStatus() {
  try {
    const tab = await currentTab();
    const response = await chrome.tabs.sendMessage(tab.id, { type: "MARKET_SNAP_STATUS" }).catch(() => null);
    if (!response?.supported) {
      resultEl.className = "empty";
      resultEl.textContent = "Open an OpenLane vehicle page. Market Snap will appear inside the page automatically.";
      statusEl.textContent = "Popup is a status/settings helper; analysis happens in-page.";
      return;
    }
    resultEl.className = "";
    resultEl.innerHTML = `
      <div class="badge">OpenLane supported</div>
      <dl>
        <dt>Vehicle</dt><dd>${escapeHtml(vehicleLabel(response.listing))}</dd>
        <dt>Recommendation</dt><dd>${escapeHtml(response.valuation?.recommendationBadge || "-")}</dd>
        <dt>Confidence</dt><dd>${escapeHtml(response.valuation?.confidenceScore ?? "-")}</dd>
      </dl>
    `;
    statusEl.textContent = "The in-page widget is active.";
  } catch (error) {
    statusEl.textContent = formatExtensionError(error, "Could not read this tab.");
  }
}

async function analyzeCurrentPage() {
  try {
    statusEl.textContent = "Refreshing in-page widget...";
    const tab = await currentTab();
    const response = await chrome.tabs.sendMessage(tab.id, { type: "MARKET_SNAP_ANALYZE" });
    if (!response?.ok) throw new Error(response?.message || "OpenLane page analysis failed.");
    await renderStatus();
  } catch (error) {
    statusEl.textContent = formatExtensionError(error, "Analysis failed.");
  }
}

async function openDealerFlow() {
  const settings = await chrome.storage.sync.get(["dealerFlowBaseUrl"]);
  const url = settings.dealerFlowBaseUrl || "http://localhost:3000";
  chrome.tabs.create({ url: `${url.replace(/\/$/, "")}/market-snap` });
}

function vehicleLabel(listing) {
  if (!listing) return "-";
  return [listing.year, listing.make, listing.model, listing.trim].filter(Boolean).join(" ") || listing.title || "OpenLane vehicle";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function formatExtensionError(error, fallback) {
  const message = error?.message || fallback;
  if (message.includes("Receiving end does not exist") || message.includes("Could not establish connection")) {
    return "This tab is not connected to Market Snap. Open or refresh an OpenLane vehicle page.";
  }
  return message;
}
