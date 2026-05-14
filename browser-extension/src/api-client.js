(function () {
  function normalizeBaseUrl(settings) {
    if (!settings?.dealerFlowBaseUrl) throw new Error("Dealer Flow base URL is missing. Open Market Snap settings.");
    let url;
    try {
      url = new URL(settings.dealerFlowBaseUrl);
    } catch {
      throw new Error("Dealer Flow base URL is invalid.");
    }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Dealer Flow base URL must use http or https.");
    return url.origin;
  }

  function validateMarketSnapSettings(settings) {
    const origin = normalizeBaseUrl(settings);
    if (!settings.organizationId) throw new Error("Organization ID is missing. Open Market Snap settings.");
    return origin;
  }

  async function getMarketSnapSettings() {
    return window.DealerFlowMarketSnapStorage.getMarketSnapSettings();
  }

  async function saveMarketSnapSettings(settings) {
    return window.DealerFlowMarketSnapStorage.saveMarketSnapSettings(settings);
  }

  async function requestJson(settings, path, body) {
    const response = await fetch(buildDealerFlowUrl(path, settings), {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    }).catch((error) => {
      throw new Error(error?.message || "Dealer Flow API is unreachable.");
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(formatApiError(response.status, payload));
    }
    return payload;
  }

  function formatApiError(error, responsePayload) {
    const status = typeof error === "number" ? error : error?.status;
    const payload = typeof error === "number" ? responsePayload : responsePayload || error?.payload;
    const message = String(payload?.message || payload?.error || error?.message || "Market Snap API failed.");
    if (status === 401) return "Dealer Flow needs you signed in on the same browser profile.";
    if (status === 403) return "Dealer Flow rejected this organization or extension origin.";
    if (status === 429) return "Market Snap API is rate limited. Wait a moment before refreshing.";
    if (message.includes("Invalid request origin")) return "Dealer Flow blocked the extension origin. Add this extension ID to MARKET_SNAP_EXTENSION_ORIGINS.";
    if (message.includes("Failed to fetch")) return "Dealer Flow is unreachable or blocked by extension origin settings.";
    return message;
  }

  async function analyzeListing(first, second) {
    const { settings, listing } = await requestArgs(first, second);
    validateMarketSnapSettings(settings);
    return requestJson(settings, "/api/market-snap/analyze-listing", {
      ...listing,
      organizationId: settings.organizationId,
    });
  }

  async function saveListing(first, second, third) {
    const { settings, listing, valuation } = await requestArgs(first, second, third);
    validateMarketSnapSettings(settings);
    return requestJson(settings, "/api/market-snap/save-listing", {
      organizationId: settings.organizationId,
      listing,
      valuation,
    });
  }

  async function requestArgs(first, second, third) {
    if (first?.dealerFlowBaseUrl || first?.organizationId) {
      return { settings: first, listing: second, valuation: third };
    }
    return { settings: await getMarketSnapSettings(), listing: first, valuation: second };
  }

  function buildDealerFlowUrl(path, settings) {
    const baseUrl = normalizeBaseUrl(settings);
    return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  function dealerFlowMarketSnapUrl(settings) {
    return buildDealerFlowUrl("/market-snap", settings);
  }

  window.DealerFlowMarketSnapApi = {
    getMarketSnapSettings,
    saveMarketSnapSettings,
    validateMarketSnapSettings,
    validateSettings: validateMarketSnapSettings,
    analyzeListing,
    saveListing,
    buildDealerFlowUrl,
    dealerFlowMarketSnapUrl,
    formatApiError,
  };
})();
