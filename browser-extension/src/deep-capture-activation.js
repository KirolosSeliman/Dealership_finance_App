(function (root) {
  const MODE_DEFAULT_PENDING = "default_enabled_pending_consent_ui";
  const MODE_EXPLICIT_ACTIVE = "explicit_consent_active";
  const MODE_DISABLED_BY_USER = "disabled_by_user";
  const MODE_DISABLED_MISSING_SETTINGS = "disabled_missing_required_settings";
  const MODE_DISABLED_NON_OPENLANE = "disabled_non_openlane_context";
  const CONSENT_PENDING = "future_download_consent_pending";
  const CONSENT_ACTIVE = "active_backend_consent";

  function isDeepCaptureAllowed(settings = {}, context = {}) {
    const dealerFlowBaseUrl = normalizeRequiredText(settings.dealerFlowBaseUrl);
    const organizationId = normalizeRequiredText(settings.organizationId);
    const openLaneHost = isOpenLaneContext(context);
    const observePageNetworkData = settings.observePageNetworkData !== false;

    if (settings.deepCaptureEnabled === false) {
      return state(false, MODE_DISABLED_BY_USER, "deep_capture_disabled_by_user", openLaneHost, observePageNetworkData, settings);
    }
    if (settings.deepCaptureConsentStatus === "withdrawn") {
      return state(false, MODE_DISABLED_BY_USER, "deep_capture_consent_withdrawn", openLaneHost, observePageNetworkData, settings);
    }
    if (settings.deepCaptureConsentStatus === "paused") {
      return state(false, MODE_DISABLED_BY_USER, "deep_capture_consent_paused", openLaneHost, observePageNetworkData, settings);
    }
    if (settings.deepCaptureConsentStatus === "requires_renewal") {
      return state(false, MODE_DISABLED_BY_USER, "deep_capture_consent_requires_renewal", openLaneHost, observePageNetworkData, settings);
    }
    if (!dealerFlowBaseUrl || !organizationId) {
      return state(false, MODE_DISABLED_MISSING_SETTINGS, !dealerFlowBaseUrl ? "missing_dealer_flow_url" : "missing_organization_id", openLaneHost, observePageNetworkData, settings);
    }
    if (!openLaneHost) {
      return state(false, MODE_DISABLED_NON_OPENLANE, "disabled_non_openlane_context", openLaneHost, observePageNetworkData, settings);
    }
    if (hasExplicitActiveConsent(settings)) {
      return state(true, MODE_EXPLICIT_ACTIVE, "active_backend_consent", openLaneHost, observePageNetworkData, settings, CONSENT_ACTIVE);
    }
    return state(true, MODE_DEFAULT_PENDING, "default_enabled_pending_consent_ui", openLaneHost, observePageNetworkData, settings, CONSENT_PENDING);
  }

  function state(active, mode, reason, openLaneHost, observePageNetworkData, settings, consentMode = CONSENT_PENDING) {
    return {
      active: Boolean(active),
      allowed: Boolean(active),
      deepCaptureActivationMode: mode,
      activationMode: mode,
      consentMode,
      consentStatus: String(settings.deepCaptureConsentStatus || "off"),
      consentIdPresent: Boolean(settings.deepCaptureConsentId),
      observePageNetworkData: Boolean(active && observePageNetworkData),
      reason,
      openLaneHost: Boolean(openLaneHost),
    };
  }

  function hasExplicitActiveConsent(settings = {}) {
    return Boolean(settings.deepCaptureConsentStatus === "active" && settings.deepCaptureConsentId);
  }

  function isOpenLaneContext(context = {}) {
    const hostname = context.hostname || hostnameFromHref(context.href || context.url) || root.location?.hostname || "";
    return /(^|\.)openlane\.(ca|com)$/i.test(String(hostname || ""));
  }

  function hostnameFromHref(href) {
    if (!href) return "";
    try {
      return new URL(String(href), "https://app.openlane.ca/").hostname;
    } catch {
      return "";
    }
  }

  function normalizeRequiredText(value) {
    return String(value || "").trim();
  }

  const api = {
    isDeepCaptureAllowed,
    hasExplicitActiveConsent,
    isOpenLaneContext,
    MODES: {
      MODE_DEFAULT_PENDING,
      MODE_EXPLICIT_ACTIVE,
      MODE_DISABLED_BY_USER,
      MODE_DISABLED_MISSING_SETTINGS,
      MODE_DISABLED_NON_OPENLANE,
    },
  };

  root.DealerFlowMarketSnapDeepCaptureActivation = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
