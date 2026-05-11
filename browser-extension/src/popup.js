const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const saveButton = document.getElementById("save");
const settingsButton = document.getElementById("settings");
let lastListing;
let lastValuation;

settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

document.getElementById("analyze").addEventListener("click", async () => {
  try {
    statusEl.textContent = "Analyzing visible listing data...";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id, { type: "MARKET_SNAP_EXTRACT" });
    if (!response?.ok) throw new Error(response?.message || "Could not extract listing.");
    lastListing = response.listing;
    const settings = await chrome.storage.sync.get(["dealerFlowBaseUrl", "organizationId"]);
    if (!settings.dealerFlowBaseUrl || !settings.organizationId) {
      renderResult({ recommendationBadge: "Negotiate", dealScore: 0, profitScore: 0, riskScore: 0, confidenceScore: 0, explanation: "Set dealerFlowBaseUrl and organizationId in extension storage before calling Dealer Flow." });
      statusEl.textContent = "Listing extracted locally. Open Settings to connect Dealer Flow.";
      return;
    }
    const apiResponse = await fetch(`${settings.dealerFlowBaseUrl}/api/market-snap/analyze-listing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...lastListing, organizationId: settings.organizationId }),
    });
    const payload = await apiResponse.json();
    if (!apiResponse.ok || !payload.ok) throw new Error(payload.message || "Market Snap API failed.");
    lastValuation = payload.valuation;
    renderResult(lastValuation);
    statusEl.textContent = "Analysis complete.";
  } catch (error) {
    statusEl.textContent = error.message || "Analysis failed.";
  }
});

saveButton.addEventListener("click", async () => {
  try {
    if (!lastListing) throw new Error("Analyze a listing first.");
    const settings = await chrome.storage.sync.get(["dealerFlowBaseUrl", "organizationId"]);
    if (!settings.dealerFlowBaseUrl || !settings.organizationId) throw new Error("Open Settings and connect Dealer Flow first.");
    const response = await fetch(`${settings.dealerFlowBaseUrl}/api/market-snap/save-listing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ organizationId: settings.organizationId, listing: lastListing, valuation: lastValuation }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Could not save listing.");
    statusEl.textContent = "Saved to Deal Radar.";
  } catch (error) {
    statusEl.textContent = error.message || "Save failed.";
  }
});

function renderResult(valuation) {
  resultEl.className = "";
  resultEl.innerHTML = `
    <div class="badge">${valuation.recommendationBadge}</div>
    <div class="scores">
      <span>Deal ${valuation.dealScore}</span>
      <span>Profit ${valuation.profitScore}</span>
      <span>Risk ${valuation.riskScore}</span>
    </div>
    <dl>
      <dt>Retail</dt><dd>${money(valuation.estimatedRetailMarketValue)}</dd>
      <dt>Wholesale buy</dt><dd>${money(valuation.estimatedWholesaleBuyValue)}</dd>
      <dt>Max bid</dt><dd>${money(valuation.maxRecommendedBid)}</dd>
      <dt>Profit</dt><dd>${money(valuation.potentialNetProfit)}</dd>
      <dt>Confidence</dt><dd>${valuation.confidenceScore}</dd>
    </dl>
    <p>${valuation.explanation || ""}</p>
  `;
}

function money(value) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value || 0);
}
