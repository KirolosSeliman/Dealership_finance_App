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
    if (status === 403 && message.includes("Deep Capture")) return message;
    if (status === 403) return "Dealer Flow rejected this organization or extension origin.";
    if (status === 429) return "Market Snap API is rate limited. Wait a moment before refreshing.";
    if (message.includes("Invalid request origin")) return "Dealer Flow blocked the extension origin. Add this extension ID to MARKET_SNAP_EXTENSION_ORIGINS.";
    if (message.includes("Failed to fetch")) return "Dealer Flow is unreachable or blocked by extension origin settings.";
    return message;
  }

  async function analyzeListing(first, second) {
    const { settings, listing } = await requestArgs(first, second);
    validateMarketSnapSettings(settings);
    const safeListing = canonicalListing(listing);
    return requestJson(settings, "/api/market-snap/analyze-listing", {
      ...safeListing,
      organizationId: settings.organizationId,
    });
  }

  async function saveListing(first, second, third) {
    const { settings, listing, valuation } = await requestArgs(first, second, third);
    validateMarketSnapSettings(settings);
    const safeListing = canonicalListing(listing);
    const body = {
      organizationId: settings.organizationId,
      listing: safeListing,
    };
    if (valuation && typeof valuation === "object") body.valuation = valuation;
    return requestJson(settings, "/api/market-snap/save-listing", body);
  }

  async function captureListing(first, second) {
    const { settings, listing } = await requestArgs(first, second);
    validateMarketSnapSettings(settings);
    const safeListing = canonicalListing(listing);
    return requestJson(settings, "/api/market-snap/capture-listing", {
      ...safeListing,
      organizationId: settings.organizationId,
    });
  }

  async function getDeepCaptureConsentStatus(first) {
    const settings = first?.dealerFlowBaseUrl || first?.organizationId ? first : await getMarketSnapSettings();
    validateMarketSnapSettings(settings);
    return requestJson(settings, "/api/market-snap/deep-capture-consent", consentPayload(settings, "status"));
  }

  async function acceptDeepCaptureConsent(first, overrides = {}) {
    const settings = first?.dealerFlowBaseUrl || first?.organizationId ? first : await getMarketSnapSettings();
    validateMarketSnapSettings(settings);
    return requestJson(settings, "/api/market-snap/deep-capture-consent", {
      ...consentPayload(settings, "accept"),
      captureScopes: overrides.captureScopes || defaultDeepCaptureScopes(settings),
      modelImprovementOptIn: Boolean(overrides.modelImprovementOptIn ?? settings.modelImprovementOptIn),
    });
  }

  async function withdrawDeepCaptureConsent(first) {
    const settings = first?.dealerFlowBaseUrl || first?.organizationId ? first : await getMarketSnapSettings();
    validateMarketSnapSettings(settings);
    return requestJson(settings, "/api/market-snap/deep-capture-consent", consentPayload(settings, "withdraw"));
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

  function canonicalListing(listing = {}) {
    const safeListing = listing || {};
    const canonical = safeListing.openlaneCanonicalState || safeListing.canonicalOpenLaneState;
    const contract = window.DealerFlowOpenLaneExtractionContract;
    if (canonical && typeof contract?.canonicalToLegacyPayload === "function") {
      return contract.canonicalToLegacyPayload(canonical, safeListing);
    }
    if (/openlane/i.test(String(safeListing.sourceName || "")) && typeof contract?.applyOpenLaneExtractionContract === "function") {
      return contract.applyOpenLaneExtractionContract(safeListing);
    }
    return safeListing;
  }

  function dealerFlowMarketSnapUrl(settings) {
    return buildDealerFlowUrl("/market-snap", settings);
  }

  function consentPayload(settings, action) {
    return {
      action,
      organizationId: settings.organizationId,
      extensionInstallationId: settings.extensionInstallationId || "",
      source: "extension_options",
    };
  }

  function defaultDeepCaptureScopes(settings) {
    const scopes = [
      "dom_visible",
      "safe_read_only_expansion",
      "network_response_observation",
      "fee_outcome_capture",
      "post_sale_outcome_capture",
      "media_url_capture",
    ];
    if (settings.modelImprovementOptIn) scopes.push("model_improvement");
    return scopes;
  }

  window.DealerFlowMarketSnapApi = {
    getMarketSnapSettings,
    saveMarketSnapSettings,
    validateMarketSnapSettings,
    validateSettings: validateMarketSnapSettings,
    analyzeListing,
    saveListing,
    captureListing,
    getDeepCaptureConsentStatus,
    acceptDeepCaptureConsent,
    withdrawDeepCaptureConsent,
    buildDealerFlowUrl,
    dealerFlowMarketSnapUrl,
    formatApiError,
  };
})();
