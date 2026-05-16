(function (root) {
  const MAX_OBSERVATIONS = 10;
  const MAX_STRING = 800;
  const SENSITIVE_KEY = /\b(auth|authorization|cookie|token|secret|credential|session|password|csrf|jwt|bearer)\b/i;
  const VEHICLE_KEY = /\b(vehicle|vin|listing|inventory|vdp|photo|image|media|condition|disclosure|damage|mechanical|history|note|purchase|fee|price)\b/i;
  const observations = [];

  function startOpenLaneNetworkObserver(settings = {}) {
    if (!hasActiveDeepCaptureConsent(settings)) return { enabled: false, reason: "deep_capture_consent_required" };
    if (settings.observePageNetworkData !== true) return { enabled: false, reason: "disabled" };
    injectPageHook();
    root.addEventListener?.("message", onPageMessage);
    return { enabled: true, reason: "observing_page_generated_responses" };
  }

  function stopOpenLaneNetworkObserver() {
    root.removeEventListener?.("message", onPageMessage);
  }

  function hasActiveDeepCaptureConsent(settings = {}) {
    return Boolean(settings.deepCaptureEnabled && settings.deepCaptureConsentStatus === "active" && settings.deepCaptureConsentId);
  }

  function onPageMessage(event) {
    if (event.source !== root || event.data?.source !== "dealer-flow-openlane-network") return;
    rememberNetworkPayload(event.data.body, event.data.url, event.data.contentType);
  }

  function rememberNetworkPayload(body, url = "", contentType = "") {
    const parsed = parseJsonBody(body);
    if (!parsed) return undefined;
    const candidates = extractCandidatesFromNetworkPayload(parsed, url);
    if (!isRelevantObservation(candidates)) return undefined;
    const observation = {
      capturedAt: new Date().toISOString(),
      endpointPattern: endpointPattern(url),
      contentType: String(contentType || "").slice(0, 80),
      sanitizedKeys: candidates.sanitizedKeys,
      candidates,
    };
    observations.unshift(observation);
    observations.splice(MAX_OBSERVATIONS);
    return observation;
  }

  function getOpenLaneNetworkEvidence() {
    return observations.slice();
  }

  function mergeNetworkEvidenceIntoListing(listing = {}, evidence = getOpenLaneNetworkEvidence()) {
    const candidates = flattenNetworkCandidates(evidence);
    const merged = {
      ...listing,
      openlaneMetadata: {
        ...(listing.openlaneMetadata || {}),
        networkEvidence: evidence.map((item) => ({
          capturedAt: item.capturedAt,
          endpointPattern: item.endpointPattern,
          sanitizedKeys: item.sanitizedKeys,
          candidateCounts: {
            vin: item.candidates?.vinCandidates?.length || 0,
            media: item.candidates?.mediaCandidates?.length || 0,
            condition: item.candidates?.conditionCandidates?.length || 0,
          },
        })),
      },
      extractedFields: {
        ...(listing.extractedFields || {}),
        debug: {
          ...(listing.extractedFields?.debug || {}),
          networkCandidates: candidates,
        },
      },
    };
    if (!merged.vin && candidates.vinCandidates[0]) {
      merged.vin = candidates.vinCandidates[0].vin;
      merged.extractedFields.vinEvidence = { matchedLabel: "network_observation", sourceText: candidates.vinCandidates[0].sourceText };
    }
    if ((!merged.photos || !merged.photos.length) && candidates.mediaCandidates.length) {
      merged.photos = candidates.mediaCandidates.slice(0, 80).map((item) => ({ url: item.url, source: "observed_network" }));
      merged.imageCount = Math.max(Number(merged.imageCount || 0), merged.photos.length);
    }
    if (!merged.conditionReportText && candidates.conditionCandidates.length) {
      merged.conditionReportText = candidates.conditionCandidates.map((item) => item.text).join(" | ").slice(0, 4000);
    }
    return merged;
  }

  function extractCandidatesFromNetworkPayload(payload, url = "") {
    const sanitized = sanitizeNetworkPayload(payload);
    const vinCandidates = [];
    const mediaCandidates = [];
    const conditionCandidates = [];
    walk(sanitized, (value, keyPath) => {
      const key = keyPath.join(".");
      if (typeof value === "string") {
        for (const match of value.toUpperCase().matchAll(/\b[A-HJ-NPR-Z0-9]{17}\b/g)) {
          vinCandidates.push({ vin: match[0], key, sourceText: value.slice(0, 240), score: /vin/i.test(key) ? 90 : 45 });
        }
        if (looksLikeVehicleMedia(value)) mediaCandidates.push({ url: value, key, score: /photo|image|media/i.test(key) ? 80 : 45 });
        if (/condition|disclosure|damage|mechanical|history|note/i.test(key) && value.length > 2) {
          conditionCandidates.push({ key, text: value.slice(0, MAX_STRING), score: 70 });
        }
      }
    });
    return {
      endpointPattern: endpointPattern(url),
      sanitizedKeys: collectVehicleKeys(sanitized),
      vinCandidates: dedupeBy(vinCandidates.sort((a, b) => b.score - a.score), "vin").slice(0, 10),
      mediaCandidates: dedupeBy(mediaCandidates, "url").slice(0, 80),
      conditionCandidates: conditionCandidates.slice(0, 30),
    };
  }

  function sanitizeNetworkPayload(value, depth = 0, key = "") {
    if (depth > 5) return "[depth_capped]";
    if (SENSITIVE_KEY.test(key)) return "[redacted]";
    if (typeof value === "string") return sanitizeString(value);
    if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
    if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeNetworkPayload(item, depth + 1, key));
    if (!value || typeof value !== "object") return undefined;
    return Object.fromEntries(Object.entries(value).slice(0, 80).map(([itemKey, itemValue]) => [itemKey, sanitizeNetworkPayload(itemValue, depth + 1, itemKey)]));
  }

  function sanitizeString(value) {
    return String(value || "")
      .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted_email]")
      .slice(0, MAX_STRING);
  }

  function injectPageHook() {
    if (root.__dealerFlowOpenLaneNetworkObserverInjected) return;
    root.__dealerFlowOpenLaneNetworkObserverInjected = true;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/openlane-network-page-hook.js");
    script.async = false;
    (document.documentElement || document.head).appendChild(script);
    script.remove();
  }

  function parseJsonBody(body) {
    try {
      return typeof body === "string" ? JSON.parse(body) : body;
    } catch {
      return undefined;
    }
  }

  function walk(value, visit, path = []) {
    visit(value, path);
    if (Array.isArray(value)) value.forEach((item, index) => walk(item, visit, path.concat(String(index))));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => walk(item, visit, path.concat(key)));
  }

  function collectVehicleKeys(value) {
    const keys = new Set();
    walk(value, (_value, path) => {
      const key = path.join(".");
      if (VEHICLE_KEY.test(key)) keys.add(key);
    });
    return Array.from(keys).slice(0, 80);
  }

  function flattenNetworkCandidates(evidence) {
    return evidence.reduce((acc, item) => ({
      vinCandidates: acc.vinCandidates.concat(item.candidates?.vinCandidates || []),
      mediaCandidates: acc.mediaCandidates.concat(item.candidates?.mediaCandidates || []),
      conditionCandidates: acc.conditionCandidates.concat(item.candidates?.conditionCandidates || []),
    }), { vinCandidates: [], mediaCandidates: [], conditionCandidates: [] });
  }

  function isRelevantObservation(candidates) {
    return Boolean(candidates.vinCandidates.length || candidates.mediaCandidates.length || candidates.conditionCandidates.length);
  }

  function endpointPattern(url) {
    try {
      const parsed = new URL(String(url || ""), root.location?.href || "https://app.openlane.ca/");
      return `${parsed.hostname}${parsed.pathname.replace(/[0-9a-f-]{8,}/gi, ":id")}`;
    } catch {
      return "unknown";
    }
  }

  function looksLikeVehicleMedia(value) {
    return /^https?:\/\//i.test(value) && /\.(avif|webp|png|jpe?g)(\?|#|$)/i.test(value) && /kar-media|openlane|vehicle|photo|image/i.test(value) && !/logo|icon|favicon|sprite|translate|\.svg/i.test(value);
  }

  function dedupeBy(items, key) {
    const seen = new Set();
    return items.filter((item) => {
      if (!item[key] || seen.has(item[key])) return false;
      seen.add(item[key]);
      return true;
    });
  }

  const api = { startOpenLaneNetworkObserver, stopOpenLaneNetworkObserver, rememberNetworkPayload, getOpenLaneNetworkEvidence, extractCandidatesFromNetworkPayload, sanitizeNetworkPayload, mergeNetworkEvidenceIntoListing };
  root.DealerFlowOpenLaneNetworkObserver = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
