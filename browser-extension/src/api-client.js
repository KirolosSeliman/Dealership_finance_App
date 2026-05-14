(function () {
  function validateSettings(settings) {
    if (!settings.dealerFlowBaseUrl) throw new Error("Dealer Flow base URL is missing. Open Market Snap settings.");
    let url;
    try {
      url = new URL(settings.dealerFlowBaseUrl);
    } catch {
      throw new Error("Dealer Flow base URL is invalid.");
    }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Dealer Flow base URL must use http or https.");
    if (!settings.organizationId) throw new Error("Organization ID is missing. Open Market Snap settings.");
    return url.origin;
  }

  async function requestJson(settings, path, body) {
    const baseUrl = validateSettings(settings);
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    }).catch((error) => {
      throw new Error(error?.message || "Dealer Flow API is unreachable.");
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(apiErrorMessage(response.status, payload));
    }
    return payload;
  }

  function apiErrorMessage(status, payload) {
    const message = String(payload?.message || payload?.error || "Market Snap API failed.");
    if (status === 401) return "Dealer Flow needs you signed in on the same browser profile.";
    if (status === 403) return "Dealer Flow rejected this organization or extension origin.";
    if (status === 429) return "Market Snap API is rate limited. Wait a moment before refreshing.";
    if (message.includes("Invalid request origin")) return "Dealer Flow blocked the extension origin. Add this extension ID to MARKET_SNAP_EXTENSION_ORIGINS.";
    return message;
  }

  async function analyzeListing(settings, listing) {
    return requestJson(settings, "/api/market-snap/analyze-listing", {
      ...listing,
      organizationId: settings.organizationId,
    });
  }

  async function saveListing(settings, listing, valuation) {
    return requestJson(settings, "/api/market-snap/save-listing", {
      organizationId: settings.organizationId,
      listing,
      valuation,
    });
  }

  function dealerFlowMarketSnapUrl(settings) {
    const baseUrl = validateSettings(settings);
    return `${baseUrl}/market-snap`;
  }

  window.DealerFlowMarketSnapApi = {
    analyzeListing,
    saveListing,
    dealerFlowMarketSnapUrl,
    validateSettings,
  };
})();
