(function (root) {
  const MAX_OBSERVATIONS = 10;
  const MAX_STRING = 800;
  const SENSITIVE_KEY = /\b(auth|authorization|cookie|token|secret|credential|session|password|csrf|jwt|bearer)\b/i;
  const DENY_ENDPOINT = /\b(auth|oauth|login|logout|session|profile|account|payment|billing|user|users|me|token|cookie|password)\b/i;
  const ALLOW_ENDPOINT = /\b(vdp|vehicle|vehicles|listing|inventory|purchase|purchases|condition|disclosure|media|photo|image|bid|offer|fee|fees|invoice|post-sale|sale)\b/i;
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
    if (!isAllowedEndpoint(url)) return undefined;
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
      merged.vin = candidates.vinCandidates[0].value || candidates.vinCandidates[0].vin;
      merged.extractedFields.vinEvidence = { matchedLabel: "network_observation", sourceText: candidates.vinCandidates[0].sourceText };
    }
    for (const candidate of candidates.fieldCandidates || []) {
      if (candidate.field && merged[candidate.field] === undefined && !isProtectedVerifiedOutcomeField(candidate.field, merged)) {
        merged[candidate.field] = candidate.value;
      }
    }
    if ((!merged.photos || !merged.photos.length) && candidates.mediaCandidates.length) {
      merged.photos = candidates.mediaCandidates.slice(0, 80).map((item) => ({ url: item.value || item.url, source: "observed_network" }));
      merged.imageCount = Math.max(Number(merged.imageCount || 0), merged.photos.length);
    }
    if (!merged.conditionReportText && candidates.conditionCandidates.length) {
      merged.conditionReportText = candidates.conditionCandidates.map((item) => item.text).join(" | ").slice(0, 4000);
    }
    return merged;
  }

  function extractCandidatesFromNetworkPayload(payload, url = "") {
    const sanitized = sanitizeNetworkPayload(payload);
    const endpoint = endpointPattern(url);
    const capturedAt = new Date().toISOString();
    const fieldCandidates = [];
    const vinCandidates = [];
    const mediaCandidates = [];
    const conditionCandidates = [];
    const priceCandidates = [];
    walk(sanitized, (value, keyPath) => {
      const key = keyPath.join(".");
      if (typeof value === "string") {
        for (const match of value.toUpperCase().matchAll(/\b[A-HJ-NPR-Z0-9]{17}\b/g)) {
          const candidate = candidateRecord("vin", match[0], key, endpoint, /vin/i.test(key) ? 92 : 55, value, capturedAt);
          vinCandidates.push({ ...candidate, vin: match[0] });
          fieldCandidates.push(candidate);
        }
        if (looksLikeVehicleMedia(value)) {
          const candidate = candidateRecord("photos", value, key, endpoint, /photo|image|media/i.test(key) ? 92 : 55, value, capturedAt);
          mediaCandidates.push({ ...candidate, url: value });
        }
        if (/condition|disclosure|damage|mechanical|history|note/i.test(key) && value.length > 2) {
          const candidate = candidateRecord("conditionReportText", value.slice(0, MAX_STRING), key, endpoint, 86, value, capturedAt);
          conditionCandidates.push({ ...candidate, text: candidate.value });
        }
        const parsedMoney = moneyFromText(value);
        const field = inferFieldName(key, value);
        if (parsedMoney !== undefined && field && isMoneyField(field)) {
          const candidate = candidateRecord(field, parsedMoney, key, endpoint, confidenceForKey(key), value, capturedAt);
          priceCandidates.push(candidate);
          fieldCandidates.push(candidate);
        }
      } else if (typeof value === "number") {
        const field = inferFieldName(key, value);
        if (field) {
          const candidate = candidateRecord(field, normalizeNumberForField(field, value), key, endpoint, confidenceForKey(key), String(value), capturedAt);
          if (isMoneyField(field)) priceCandidates.push(candidate);
          fieldCandidates.push(candidate);
        }
      }
    });
    return {
      endpointPattern: endpoint,
      sanitizedKeys: collectVehicleKeys(sanitized),
      fieldCandidates: dedupeCandidates(fieldCandidates).slice(0, 120),
      vinCandidates: dedupeBy(vinCandidates.sort((a, b) => b.confidence - a.confidence), "vin").slice(0, 10),
      mediaCandidates: dedupeBy(mediaCandidates, "url").slice(0, 80),
      conditionCandidates: conditionCandidates.slice(0, 30),
      priceCandidates: dedupeCandidates(priceCandidates).slice(0, 30),
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
      .replace(/\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[redacted_phone]")
      .slice(0, MAX_STRING);
  }

  function injectPageHook() {
    if (root.__dealerFlowOpenLaneNetworkObserverInjected) return;
    if (typeof document === "undefined") return;
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
      fieldCandidates: acc.fieldCandidates.concat(item.candidates?.fieldCandidates || []),
      vinCandidates: acc.vinCandidates.concat(item.candidates?.vinCandidates || []),
      mediaCandidates: acc.mediaCandidates.concat(item.candidates?.mediaCandidates || []),
      conditionCandidates: acc.conditionCandidates.concat(item.candidates?.conditionCandidates || []),
      priceCandidates: acc.priceCandidates.concat(item.candidates?.priceCandidates || []),
    }), { fieldCandidates: [], vinCandidates: [], mediaCandidates: [], conditionCandidates: [], priceCandidates: [] });
  }

  function isRelevantObservation(candidates) {
    return Boolean(candidates.fieldCandidates.length || candidates.vinCandidates.length || candidates.mediaCandidates.length || candidates.conditionCandidates.length || candidates.priceCandidates.length);
  }

  function isAllowedEndpoint(url) {
    let parsed;
    try {
      parsed = new URL(String(url || ""), root.location?.href || "https://app.openlane.ca/");
    } catch {
      return false;
    }
    const target = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    if (!/(^|\.)openlane\.(ca|com)$|kar-media\.com$/i.test(parsed.hostname)) return false;
    if (DENY_ENDPOINT.test(target)) return false;
    return ALLOW_ENDPOINT.test(target);
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

  function candidateRecord(field, value, source, endpoint, confidence, sourceText, capturedAt) {
    return {
      field,
      value,
      source,
      endpointPattern: endpoint,
      confidence,
      sourceText: String(sourceText || "").slice(0, 240),
      capturedAt,
    };
  }

  function inferFieldName(key, value) {
    const normalized = key.toLowerCase().replace(/[_\s-]/g, "");
    if (/vin$|vehiclevin/.test(normalized)) return "vin";
    if (/year|modelyear/.test(normalized)) return "year";
    if (/make|manufacturer/.test(normalized)) return "make";
    if (/model(?!year)/.test(normalized)) return "model";
    if (/trim|series/.test(normalized)) return "trim";
    if (/odometer|mileage|kilometers|kilometres/.test(normalized)) return "mileageKm";
    if (/currentbid|topbid|bidamount|miseactuelle/.test(normalized)) return "currentBid";
    if (/currentoffer|myoffer|bestoffer|offreactuelle|meilleureoffre/.test(normalized)) return /bestoffer|meilleureoffre/.test(normalized) ? "bestOffer" : "currentOffer";
    if (/buynow|buyitnow|instantpurchase/.test(normalized)) return "buyNowPrice";
    if (/reserve/.test(normalized)) return "reservePrice";
    if (/sellingprice|soldprice|hammerprice|finalbid/.test(normalized)) return "soldPriceCandidate";
    if (/buypriceauction|purchaseprice|sellingprice/.test(normalized)) return "buyPriceAuction";
    if (/transactionfee/.test(normalized)) return "transactionFee";
    if (/vehiclehistoryfee|historyfee/.test(normalized)) return "vehicleHistoryFee";
    if (/tax|taxes/.test(normalized)) return "taxes";
    if (/totalinvoice|invoicetotal|totalamount|finalacquisition/.test(normalized)) return "totalInvoiceAmount";
    if (typeof value === "string" && /\b(current bid|buy now|selling price|invoice total)\b/i.test(value)) return value.toLowerCase().includes("buy now") ? "buyNowPrice" : value.toLowerCase().includes("invoice") ? "totalInvoiceAmount" : value.toLowerCase().includes("selling") ? "buyPriceAuction" : "currentBid";
    return "";
  }

  function isMoneyField(field) {
    return /price|bid|offer|fee|tax|total|cost|amount/i.test(field);
  }

  function moneyFromText(value) {
    const match = String(value || "").match(/\$?\s*([0-9][0-9\s,.]{1,12})\s*\$?/);
    if (!match) return undefined;
    const number = Number(match[1].replace(/\s/g, "").replace(/,/g, ""));
    return Number.isFinite(number) ? number : undefined;
  }

  function normalizeNumberForField(field, value) {
    if (field === "year" || field === "mileageKm") return Math.round(Number(value));
    return Number(value);
  }

  function confidenceForKey(key) {
    if (/invoice|fee|total/i.test(key)) return 92;
    if (/vin|bid|offer|price|odometer|mileage|year|make|model|trim/i.test(key)) return 92;
    return 55;
  }

  function isProtectedVerifiedOutcomeField(field, listing) {
    return ["buyPriceAuction", "totalInvoiceAmount", "finalAcquisitionCost", "acceptedAmount", "finalBidAmount"].includes(field)
      && (listing.captureKind === "verified_outcome" || listing.priceSemantics?.[field] === "verified_wholesale_label" || listing.priceSemantics?.[field] === "final_acquisition_cost");
  }

  function dedupeBy(items, key) {
    const seen = new Set();
    return items.filter((item) => {
      if (!item[key] || seen.has(item[key])) return false;
      seen.add(item[key]);
      return true;
    });
  }

  function dedupeCandidates(items) {
    const seen = new Set();
    return items
      .sort((a, b) => b.confidence - a.confidence)
      .filter((item) => {
        const key = `${item.field}:${item.value}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  const api = { startOpenLaneNetworkObserver, stopOpenLaneNetworkObserver, rememberNetworkPayload, getOpenLaneNetworkEvidence, extractCandidatesFromNetworkPayload, sanitizeNetworkPayload, mergeNetworkEvidenceIntoListing };
  root.DealerFlowOpenLaneNetworkObserver = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
