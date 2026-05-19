(function (root) {
  const MAX_OBSERVATIONS = 10;
  const MAX_STRING = 800;
  const SENSITIVE_KEY = /\b(auth|authorization|cookie|token|secret|credential|session|password|csrf|jwt|bearer)\b/i;
  const DENY_ENDPOINT = /\b(auth|oauth|login|logout|session|profile|account|payment|billing|user|users|me|token|cookie|password)\b/i;
  const ALLOW_ENDPOINT = /\b(vdp|vehicle|vehicles|listing|inventory|purchase|purchases|condition|disclosure|media|photo|image|bid|offer|fee|fees|invoice|post-sale|sale)\b/i;
  const VEHICLE_KEY = /\b(vehicle|vin|listing|inventory|vdp|photo|image|media|condition|disclosure|damage|mechanical|history|note|purchase|fee|price)\b/i;
  const TEXT_FIELD = new Set(["make", "model", "trim", "sellerName", "location", "auctionStatus", "saleDate", "runNumber", "lane", "lotNumber", "stockNumber", "titleStatus", "carfaxUrl", "carfaxUrlStatus"]);
  const observations = [];
  const observedEventIds = new Set();
  let observerStatus = initialObserverStatus();

  function startOpenLaneNetworkObserver(settings = {}, context = {}) {
    const activation = isDeepCaptureAllowed(settings, context);
    if (!activation.active) {
      root.removeEventListener?.("message", onPageMessage);
      clearEarlyPageHookQueue();
      observerStatus = {
        ...observerStatus,
        enabled: false,
        reason: activation.reason || "deep_capture_not_allowed",
        activationMode: activation.deepCaptureActivationMode,
        consentMode: activation.consentMode,
        observationCount: observations.length,
      };
      return getOpenLaneNetworkObserverStatus();
    }
    if (activation.observePageNetworkData !== true) {
      root.removeEventListener?.("message", onPageMessage);
      clearEarlyPageHookQueue();
      observerStatus = {
        ...observerStatus,
        enabled: false,
        reason: "disabled",
        activationMode: activation.deepCaptureActivationMode,
        consentMode: activation.consentMode,
        observationCount: observations.length,
      };
      return getOpenLaneNetworkObserverStatus();
    }
    root.addEventListener?.("message", onPageMessage);
    injectPageHook();
    flushEarlyPageHookQueue();
    root.setTimeout?.(flushEarlyPageHookQueue, 0);
    observerStatus = {
      ...observerStatus,
      enabled: true,
      reason: "observing_page_generated_responses",
      activationMode: activation.deepCaptureActivationMode,
      consentMode: activation.consentMode,
      observationCount: observations.length,
    };
    return getOpenLaneNetworkObserverStatus();
  }

  function stopOpenLaneNetworkObserver() {
    root.removeEventListener?.("message", onPageMessage);
    clearEarlyPageHookQueue();
    observerStatus = { ...observerStatus, enabled: false, reason: "stopped", observationCount: observations.length };
  }

  function isDeepCaptureAllowed(settings = {}, context = {}) {
    return root.DealerFlowMarketSnapDeepCaptureActivation?.isDeepCaptureAllowed?.(settings, context) || {
      active: false,
      observePageNetworkData: false,
      deepCaptureActivationMode: "disabled_missing_required_settings",
      reason: "activation_helper_unavailable",
    };
  }

  function initialObserverStatus() {
    return {
      enabled: false,
      reason: "stopped",
      observationCount: 0,
      pageHookInstalled: false,
      earlyHookInstalled: false,
      earlyQueueLength: 0,
      earlyQueueFlushed: false,
      lastPageHookEventAt: "",
      pageHookEventCount: 0,
      allowedEventCount: 0,
      deniedEventCount: 0,
      irrelevantJsonCount: 0,
      duplicateEventCount: 0,
      parseErrorCount: 0,
      lastAllowedEndpointPattern: "",
      lastDeniedEndpointPattern: "",
      lastDeniedEndpointReason: "",
      lastObservedEndpointSample: "",
    };
  }

  function rememberPageHookDiagnostic(data = {}) {
    observerStatus = {
      ...observerStatus,
      pageHookInstalled: Boolean(data.pageHookInstalled || observerStatus.pageHookInstalled),
      earlyHookInstalled: Boolean(data.earlyHookInstalled || observerStatus.earlyHookInstalled),
      earlyQueueLength: Math.max(0, Number(data.earlyQueueLength || 0)),
      earlyQueueFlushed: Boolean(observerStatus.earlyQueueFlushed || data.type === "early_queue_flushed"),
      pageHookEventCount: Number(observerStatus.pageHookEventCount || 0) + 1,
      lastPageHookEventAt: new Date().toISOString(),
    };
  }

  function onPageMessage(event) {
    if (event.source !== root) return;
    if (event.data?.source === "dealer-flow-openlane-network-diagnostics") {
      rememberPageHookDiagnostic(event.data);
      return;
    }
    if (event.data?.source !== "dealer-flow-openlane-network") return;
    rememberNetworkPayload(event.data.body, event.data.url, event.data.contentType, event.data.eventId);
  }

  function rememberNetworkPayload(body, url = "", contentType = "", eventId = "") {
    observerStatus = {
      ...observerStatus,
      pageHookEventCount: Number(observerStatus.pageHookEventCount || 0) + 1,
      lastPageHookEventAt: new Date().toISOString(),
      lastObservedEndpointSample: endpointPattern(url),
    };
    if (eventId && observedEventIds.has(eventId)) {
      observerStatus = {
        ...observerStatus,
        duplicateEventCount: Number(observerStatus.duplicateEventCount || 0) + 1,
      };
      return undefined;
    }
    if (eventId) rememberEventId(eventId);
    const decision = endpointDecision(url);
    if (!decision.allowed) {
      observerStatus = {
        ...observerStatus,
        deniedEventCount: Number(observerStatus.deniedEventCount || 0) + 1,
        lastDeniedEndpointPattern: decision.endpointPattern,
        lastDeniedEndpointReason: decision.reason,
        observationCount: observations.length,
      };
      return undefined;
    }
    observerStatus = {
      ...observerStatus,
      allowedEventCount: Number(observerStatus.allowedEventCount || 0) + 1,
      lastAllowedEndpointPattern: decision.endpointPattern,
      observationCount: observations.length,
    };
    const parsed = parseJsonBody(body);
    if (!parsed) {
      observerStatus = {
        ...observerStatus,
        parseErrorCount: Number(observerStatus.parseErrorCount || 0) + 1,
      };
      return undefined;
    }
    const candidates = extractCandidatesFromNetworkPayload(parsed, url);
    if (!isRelevantObservation(candidates)) {
      observerStatus = {
        ...observerStatus,
        irrelevantJsonCount: Number(observerStatus.irrelevantJsonCount || 0) + 1,
        candidateCounts: candidateCounts(candidates),
      };
      return undefined;
    }
    const observation = {
      capturedAt: new Date().toISOString(),
      endpointPattern: endpointPattern(url),
      contentType: String(contentType || "").slice(0, 80),
      sanitizedKeys: candidates.sanitizedKeys,
      candidates,
    };
    observations.unshift(observation);
    observations.splice(MAX_OBSERVATIONS);
    observerStatus = {
      ...observerStatus,
      observationCount: observations.length,
      candidateCounts: candidateCounts(candidates),
      lastAllowedEndpointPattern: decision.endpointPattern,
    };
    return observation;
  }

  function rememberEventId(eventId) {
    observedEventIds.add(eventId);
    if (observedEventIds.size <= 80) return;
    const first = observedEventIds.values().next().value;
    observedEventIds.delete(first);
  }

  function getOpenLaneNetworkEvidence() {
    return observations.slice();
  }

  function getOpenLaneNetworkObserverStatus() {
    return { ...observerStatus, observationCount: observations.length };
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
            carfax: countCarfaxCandidates(item.candidates?.fieldCandidates || []),
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
    if (candidates.vinCandidates[0] && shouldUseNetworkVin(merged, candidates.vinCandidates[0])) {
      merged.vin = candidates.vinCandidates[0].value || candidates.vinCandidates[0].vin;
      merged.extractedFields.vinEvidence = { matchedLabel: "network_observation", sourceText: candidates.vinCandidates[0].sourceText };
    }
    for (const candidate of candidates.fieldCandidates || []) {
      if (candidate.field && merged[candidate.field] === undefined && !isProtectedVerifiedOutcomeField(candidate.field, merged)) {
        merged[candidate.field] = candidate.value;
      }
    }
    normalizeMergedCarfax(merged, candidates.fieldCandidates || []);
    if ((!merged.photos || !merged.photos.length) && candidates.mediaCandidates.length) {
      merged.photos = candidates.mediaCandidates.slice(0, 80).map((item) => ({ url: item.value || item.url, source: "observed_network" }));
      merged.imageCount = Math.max(Number(merged.imageCount || 0), merged.photos.length);
    }
    if (!merged.conditionReportText && candidates.conditionCandidates.length) {
      merged.conditionReportText = candidates.conditionCandidates.map((item) => item.text).join(" | ").slice(0, 4000);
    }
    if (candidates.transportCandidates.length) {
      merged.openlaneMetadata.transportEvidence = candidates.transportCandidates.slice(0, 12);
    }
    return root.DealerFlowOpenLaneExtractionContract?.applyOpenLaneExtractionContract?.(merged) || merged;
  }

  function normalizeMergedCarfax(merged, fieldCandidates = []) {
    const carfaxUrlCandidate = fieldCandidates.find((candidate) => candidate.field === "carfaxUrl" && candidate.value);
    const carfaxTextCandidate = fieldCandidates.find((candidate) => candidate.field === "carfaxUrlStatus" && candidate.value === "text_only");
    if (!carfaxUrlCandidate && !carfaxTextCandidate && !merged.carfaxUrl && !merged.carfaxUrlStatus) return;

    if (carfaxUrlCandidate && !merged.carfaxUrl) merged.carfaxUrl = carfaxUrlCandidate.value;
    merged.carfaxMentioned = true;
    merged.carfaxAvailable = true;
    merged.carfaxUrlStatus = merged.carfaxUrl ? "url_found" : "text_only";
    merged.openlaneMetadata = {
      ...(merged.openlaneMetadata || {}),
      carfaxDiagnostics: mergeCarfaxDiagnostics(
        merged.openlaneMetadata?.carfaxDiagnostics,
        { carfaxNetworkCandidateCount: fieldCandidates.filter((candidate) => candidate.field === "carfaxUrl" || candidate.field === "carfaxUrlStatus").length },
      ),
      carfaxEvidence: [
        ...(merged.openlaneMetadata?.carfaxEvidence || []),
        ...[carfaxUrlCandidate, carfaxTextCandidate].filter(Boolean).map((candidate) => ({
          source: "network_json",
          endpointPattern: candidate.endpointPattern,
          text: candidate.sourceText,
          url: candidate.field === "carfaxUrl" ? candidate.value : undefined,
          urlStatus: candidate.field === "carfaxUrl" ? "url_found" : "text_only",
          capturedAt: candidate.capturedAt,
          confidenceScore: candidate.confidence,
        })),
      ].slice(0, 12),
    };
  }

  function mergeCarfaxDiagnostics(existing = {}, incoming = {}) {
    return {
      ...existing,
      ...Object.fromEntries(Object.entries(incoming).map(([key, value]) => [key, Number(existing?.[key] || 0) + Number(value || 0)])),
    };
  }

  function countCarfaxCandidates(fieldCandidates = []) {
    return fieldCandidates.filter((candidate) => candidate.field === "carfaxUrl" || candidate.field === "carfaxUrlStatus").length;
  }

  function candidateCounts(candidates = {}) {
    return {
      vin: candidates.vinCandidates?.length || 0,
      carfax: countCarfaxCandidates(candidates.fieldCandidates || []),
      media: candidates.mediaCandidates?.length || 0,
      condition: candidates.conditionCandidates?.length || 0,
      price: candidates.priceCandidates?.length || 0,
      transport: candidates.transportCandidates?.length || 0,
    };
  }

  function shouldUseNetworkVin(listing = {}, candidate = {}) {
    const networkVin = candidate.value || candidate.vin;
    if (!networkVin) return false;
    if (!listing.vin) return true;
    if (String(listing.vin).toUpperCase() === String(networkVin).toUpperCase()) return true;
    return Number(candidate.confidence || 0) >= existingVinConfidence(listing);
  }

  function existingVinConfidence(listing = {}) {
    const evidenceScores = (listing.fieldEvidence?.vin || [])
      .map((item) => Number(item.confidenceScore || 0))
      .filter((score) => Number.isFinite(score));
    if (evidenceScores.length) return Math.max(...evidenceScores);
    if (listing.captureKind === "manual_confirmation") return 98;
    const label = String(listing.extractedFields?.vinEvidence?.matchedLabel || listing.extractedFields?.vinEvidence?.source || "");
    if (/network_observation|network_json/i.test(label)) return 92;
    if (/explicit_dom_attribute|data-vin|dom_attribute|dom_attributes|attribute:/i.test(label)) return 90;
    if (/header_vin_chip/i.test(label)) return 88;
    if (/safe_dom_attribute|safe_dom_attributes|html_attributes|copy_button/i.test(label)) return 86;
    if (/section-map/i.test(label)) return 75;
    if (/url/i.test(label)) return 80;
    return listing.vin ? 55 : 0;
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
    const transportCandidates = [];
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
        const carfaxUrl = carfaxUrlCandidate(value, url);
        if (carfaxUrl) {
          fieldCandidates.push(candidateRecord("carfaxUrl", carfaxUrl, key, endpoint, /carfax|history|report/i.test(key) ? 92 : 70, value, capturedAt));
        } else if (/carfax/i.test(`${key} ${value}`)) {
          fieldCandidates.push(candidateRecord("carfaxUrlStatus", "text_only", key, endpoint, 62, value, capturedAt));
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
        } else if (field && TEXT_FIELD.has(field) && safeTextFieldValue(value)) {
          if (field !== "carfaxUrl") {
            fieldCandidates.push(candidateRecord(field, cleanTextValue(value), key, endpoint, confidenceForKey(key), value, capturedAt));
          }
        }
      } else if (typeof value === "number") {
        const field = inferFieldName(key, value);
        const transportField = inferTransportFieldName(key);
        if (transportField) {
          transportCandidates.push(candidateRecord(transportField, normalizeNumberForField(transportField, value), key, endpoint, confidenceForKey(key), String(value), capturedAt));
        } else if (field) {
          const candidate = candidateRecord(field, normalizeNumberForField(field, value), key, endpoint, confidenceForKey(key), String(value), capturedAt);
          if (isMoneyField(field)) priceCandidates.push(candidate);
          fieldCandidates.push(candidate);
        }
      } else if (typeof value === "boolean") {
        if (value === true && isCarfaxAvailabilityKey(key)) {
          fieldCandidates.push(candidateRecord("carfaxUrlStatus", "text_only", key, endpoint, confidenceForKey(key), String(value), capturedAt));
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
      transportCandidates: dedupeCandidates(transportCandidates).slice(0, 20),
      carfaxDiagnostics: {
        carfaxNetworkCandidateCount: countCarfaxCandidates(fieldCandidates),
      },
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
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[redacted]")
      .replace(/\b(?:auth|authorization|cookie|token|secret|credential|session|password|csrf|jwt)\s*[:=]\s*[^,\s"'<>]+/gi, "[redacted]")
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted_email]")
      .replace(/\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[redacted_phone]")
      .slice(0, MAX_STRING);
  }

  function injectPageHook() {
    if (root.__dealerFlowOpenLaneNetworkObserverInjected) {
      observerStatus = { ...observerStatus, pageHookInstalled: true };
      return;
    }
    if (typeof document === "undefined") return;
    root.__dealerFlowOpenLaneNetworkObserverInjected = true;
    observerStatus = { ...observerStatus, pageHookInstalled: true };
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/openlane-network-page-hook.js");
    script.async = false;
    (document.documentElement || document.head).appendChild(script);
    script.remove();
  }

  function flushEarlyPageHookQueue() {
    postPageHookControl("flush");
  }

  function clearEarlyPageHookQueue() {
    postPageHookControl("clear");
  }

  function postPageHookControl(type) {
    try {
      root.postMessage?.({ source: "dealer-flow-openlane-network-control", type }, root.location?.origin || "*");
    } catch {
      // Passive observation only; never break page runtime.
    }
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
      transportCandidates: acc.transportCandidates.concat(item.candidates?.transportCandidates || []),
    }), { fieldCandidates: [], vinCandidates: [], mediaCandidates: [], conditionCandidates: [], priceCandidates: [], transportCandidates: [] });
  }

  function isRelevantObservation(candidates) {
    return Boolean(candidates.fieldCandidates.length || candidates.vinCandidates.length || candidates.mediaCandidates.length || candidates.conditionCandidates.length || candidates.priceCandidates.length || candidates.transportCandidates.length);
  }

  function endpointDecision(url) {
    let parsed;
    try {
      parsed = new URL(String(url || ""), root.location?.href || "https://app.openlane.ca/");
    } catch {
      return { allowed: false, reason: "invalid_url", endpointPattern: "unknown" };
    }
    const target = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    const pattern = endpointPattern(url);
    if (!/(^|\.)openlane\.(ca|com)$|kar-media\.com$/i.test(parsed.hostname)) return { allowed: false, reason: "unsupported_host", endpointPattern: pattern };
    if (DENY_ENDPOINT.test(target)) return { allowed: false, reason: "denied_sensitive_endpoint", endpointPattern: pattern };
    if (!ALLOW_ENDPOINT.test(target)) return { allowed: false, reason: "not_vehicle_listing_endpoint", endpointPattern: pattern };
    return { allowed: true, reason: "allowed", endpointPattern: pattern };
  }

  function endpointPattern(url) {
    try {
      const parsed = new URL(String(url || ""), root.location?.href || "https://app.openlane.ca/");
      const pathname = parsed.pathname
        .split("/")
        .map((segment) => /\d/.test(segment) && /^[A-Za-z0-9-]{3,}$/.test(segment) ? ":id" : segment)
        .join("/");
      return `${parsed.hostname}${pathname}`;
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
      sourceText: sanitizeString(sourceText || "").slice(0, 240),
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
    if (/seller|consignor|dealername|sellername/.test(normalized)) return "sellerName";
    if (/auctionlocation|location|province|city/.test(normalized)) return "location";
    if (/reserve/.test(normalized)) return "reservePrice";
    if (/carfax|vehiclehistoryreport|historyreport/.test(normalized)) return "carfaxUrl";
    if (/sellingprice|soldprice|hammerprice|finalbid/.test(normalized)) return "soldPriceCandidate";
    if (/buypriceauction|purchaseprice|sellingprice/.test(normalized)) return "buyPriceAuction";
    if (/transactionfee/.test(normalized)) return "transactionFee";
    if (/vehiclehistoryfee|historyfee/.test(normalized)) return "vehicleHistoryFee";
    if (/tax|taxes/.test(normalized)) return "taxes";
    if (/totalinvoice|invoicetotal|totalamount|finalacquisition/.test(normalized)) return "totalInvoiceAmount";
    if (typeof value === "string" && /\b(current bid|buy now|selling price|invoice total)\b/i.test(value)) return value.toLowerCase().includes("buy now") ? "buyNowPrice" : value.toLowerCase().includes("invoice") ? "totalInvoiceAmount" : value.toLowerCase().includes("selling") ? "buyPriceAuction" : "currentBid";
    return "";
  }

  function inferTransportFieldName(key) {
    const normalized = String(key || "").toLowerCase().replace(/[_\s-]/g, "");
    if (!/transport|shipping|delivery|pickup|livraison|ramassage/.test(normalized)) return "";
    if (/distance|kilometer|kilometre|km/.test(normalized)) return "transportDistanceKm";
    if (/cost|estimate|fee|price|cad|amount/.test(normalized)) return "transportCostCad";
    return "";
  }

  function isCarfaxAvailabilityKey(key) {
    const normalized = String(key || "").toLowerCase().replace(/[_\s-]/g, "");
    return /carfax|vehiclehistoryreport|historyreport|historyavailable/.test(normalized);
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
    if (field === "year" || field === "mileageKm" || field === "transportDistanceKm") return Math.round(Number(value));
    return Number(value);
  }

  function confidenceForKey(key) {
    if (/invoice|fee|total/i.test(key)) return 92;
    if (/vin|bid|offer|price|odometer|mileage|year|make|model|trim|seller|location|carfax|history|report/i.test(key)) return 92;
    return 55;
  }

  function carfaxUrlCandidate(value, baseUrl) {
    const raw = String(value || "");
    const absolute = raw.match(/https?:\/\/[^\s"'<>)]*(?:carfax|report|history)[^\s"'<>)]*/i)?.[0];
    const relative = raw.match(/\/[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]*(?:carfax|report|history)[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]*/i)?.[0];
    const candidate = absolute || relative;
    if (!candidate || /\.(?:svg|png|jpe?g|webp|avif|css|js)(?:$|[?#])/i.test(candidate)) return "";
    try {
      const url = new URL(candidate, String(baseUrl || root.location?.href || "https://app.openlane.ca/"));
      if (!/^https?:$/i.test(url.protocol)) return "";
      for (const key of Array.from(url.searchParams.keys())) {
        const paramValue = url.searchParams.get(key) || "";
        if (SENSITIVE_KEY.test(`${key} ${paramValue}`) || /\[redacted/i.test(`${key} ${paramValue}`)) url.searchParams.delete(key);
      }
      return url.href;
    } catch {
      return "";
    }
  }

  function safeTextFieldValue(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 240) return false;
    return !/\[redacted|<script|javascript:/i.test(text);
  }

  function cleanTextValue(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 240);
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

  const api = { startOpenLaneNetworkObserver, stopOpenLaneNetworkObserver, rememberNetworkPayload, getOpenLaneNetworkEvidence, getOpenLaneNetworkObserverStatus, extractCandidatesFromNetworkPayload, sanitizeNetworkPayload, mergeNetworkEvidenceIntoListing };
  root.DealerFlowOpenLaneNetworkObserver = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
