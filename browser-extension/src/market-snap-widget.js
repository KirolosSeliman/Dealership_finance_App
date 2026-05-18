(function () {
  const HOST_ID = "dealer-flow-market-snap-widget";

  function createMarketSnapWidget(callbacks = {}) {
    let host = document.getElementById(HOST_ID);
    if (host?.shadowRoot) return host.__dealerFlowWidget;

    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-dealer-flow-widget", "market-snap");
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${widgetCss()}</style>
      <section class="panel" part="panel">
        <header class="drag-handle" title="Drag Market Snap">
          <div>
            <strong>Market Snap</strong>
            <span class="source">OpenLane</span>
          </div>
          <div class="header-actions">
            <button class="icon" type="button" data-action="settings" title="Settings">S</button>
            <button class="icon collapse" type="button" title="Collapse or expand">-</button>
          </div>
        </header>
        <div class="body">
          <p class="status">Detecting OpenLane vehicle...</p>
          <p class="vehicle"></p>
          <div class="metrics"></div>
          <div class="meta"></div>
          <details class="data-quality">
            <summary>Capture debug</summary>
            <div class="quality-body"></div>
          </details>
          <form class="settings-drawer" hidden>
            <label>Dealer Flow URL <input name="dealerFlowBaseUrl" id="dealerFlowBaseUrl" type="url" /></label>
            <label>Organization ID <input name="organizationId" id="organizationId" type="text" /></label>
            <label><input name="autoAnalyze" type="checkbox" /> Auto-analyze</label>
            <label><input name="autoCapture" type="checkbox" /> Capture observations/outcomes</label>
            <label><input name="autoSave" type="checkbox" /> Auto-save to Deal Radar</label>
            <label><input name="deepCaptureEnabled" type="checkbox" /> Deep Capture</label>
            <label><input name="modelImprovementOptIn" type="checkbox" /> Model improvement opt-in</label>
            <label><input name="observePageNetworkData" type="checkbox" /> Observe page network data</label>
            <label><input name="includeMediaUrls" type="checkbox" /> Include media URLs</label>
            <label><input name="includeRawVisibleText" type="checkbox" /> Include raw text</label>
            <label><input name="debugMode" type="checkbox" /> Debug mode</label>
            <button type="submit">Save settings</button>
          </form>
          <div class="messages"></div>
          <div class="actions">
            <button type="button" data-action="refresh">Refresh</button>
            <button type="button" data-action="save">Save</button>
            <button type="button" data-action="copy">Copy JSON</button>
            <button type="button" data-action="open">Open Dealer Flow</button>
            <button type="button" data-action="hide">Hide page</button>
          </div>
        </div>
      </section>
    `;

    const state = { collapsed: false, settingsOpen: false, listing: null, valuation: null, status: "idle", message: "" };
    const api = {
      host,
      render(next) {
        Object.assign(state, next);
        renderState(shadow, state);
      },
      setCollapsed(collapsed) {
        state.collapsed = collapsed;
        renderState(shadow, state);
      },
      getState() {
        return { ...state };
      },
      showLoading(message) {
        api.render({ status: "loading", message });
      },
      showDisconnected(message) {
        api.render({ status: "disconnected", message });
      },
      showExtraction(listing) {
        api.render({ status: "extracting", listing });
      },
      showValuation(listing, valuation) {
        api.render({ status: "ready", listing, valuation });
      },
      showError(message) {
        api.render({ status: "error", message });
      },
      destroy() {
        host.remove();
      },
    };

    shadow.querySelector(".collapse").addEventListener("click", () => api.setCollapsed(!state.collapsed));
    shadow.querySelector("[data-action='refresh']").addEventListener("click", () => callbacks.onRefresh?.());
    shadow.querySelector("[data-action='save']").addEventListener("click", () => callbacks.onSave?.());
    shadow.querySelector("[data-action='copy']").addEventListener("click", () => callbacks.onCopy?.());
    shadow.querySelector("[data-action='open']").addEventListener("click", () => callbacks.onOpenDealerFlow?.());
    shadow.querySelector("[data-action='hide']").addEventListener("click", () => callbacks.onHidePage?.());
    shadow.querySelector("[data-action='settings']").addEventListener("click", () => {
      state.settingsOpen = !state.settingsOpen;
      renderState(shadow, state);
      loadWidgetSettings(shadow);
    });
    shadow.querySelector(".settings-drawer").addEventListener("submit", (event) => saveWidgetSettings(event, callbacks));
    installDrag(shadow);
    restoreWidgetPosition(shadow);

    host.__dealerFlowWidget = api;
    renderState(shadow, state);
    return api;
  }

  function renderState(shadow, state) {
    const panel = shadow.querySelector(".panel");
    panel.classList.toggle("collapsed", Boolean(state.collapsed));
    panel.classList.toggle("error", state.status === "error");
    panel.classList.toggle("warning", state.status === "warning" || state.status === "disconnected");
    panel.classList.toggle("saved", state.status === "saved");
    shadow.querySelector(".collapse").textContent = state.collapsed ? "+" : "-";
    shadow.querySelector(".status").textContent = statusText(state);
    shadow.querySelector(".vehicle").textContent = vehicleLabel(state.listing);
    shadow.querySelector(".metrics").innerHTML = state.valuation ? `${detectedHtml(state.listing)}${metricsHtml(state.valuation)}` : detectedHtml(state.listing);
    shadow.querySelector(".meta").innerHTML = metaHtml(state.listing, state.valuation);
    shadow.querySelector(".quality-body").innerHTML = dataQualityHtml(state.listing, state.valuation);
    shadow.querySelector(".data-quality").open = shouldOpenDebugPanel(state);
    shadow.querySelector(".settings-drawer").hidden = !state.settingsOpen;
    shadow.querySelector(".messages").innerHTML = messagesHtml(state.listing, state.valuation, state.message, state.saveResult);
    const saveButton = shadow.querySelector("[data-action='save']");
    saveButton.disabled = state.status === "saving" || (state.listing && !readinessSummary(state.listing).readyToCapture);
    saveButton.textContent = state.status === "saving" ? "Saving..." : "Save";
  }

  function statusText(state) {
    if (state.status === "detecting") return "OpenLane vehicle detected.";
    if (state.status === "extracting") return "Extracting visible OpenLane data...";
    if (state.status === "saving") return "Saving to Deal Radar...";
    if (state.status === "loading" || state.status === "analyzing") return "Analyzing visible OpenLane page...";
    if (state.status === "disconnected") return state.message || "Connect Dealer Flow in Market Snap settings.";
    if (state.status === "warning") return state.message || "Vehicle data is incomplete.";
    if (state.status === "error") return state.message || "Market Snap could not analyze this page.";
    if (state.status === "saved") return "Saved to Deal Radar.";
    if (state.valuation) return "Analysis ready.";
    if (state.listing && readinessSummary(state.listing).readyToCapture) return "Ready to capture.";
    if (state.listing) return "Vehicle detected. Waiting for analysis.";
    return "Detecting OpenLane vehicle...";
  }

  function metricsHtml(valuation) {
    return [
      metric("Retail", money(valuation.estimatedRetailMarketValue)),
      metric("Wholesale buy", money(valuation.estimatedWholesaleBuyValue)),
      metric("Wholesale sell", money(valuation.estimatedWholesaleSellValue)),
      metric("Max bid", money(valuation.maxRecommendedBid)),
      metric("Total cost", money(valuation.estimatedTotalAcquisitionCost)),
      metric("Auction fees", money(valuation.estimatedAuctionFees)),
      metric("Taxes", money(valuation.estimatedTaxAmount)),
      metric("Recon", money(valuation.estimatedReconditioningCost)),
      metric("Net profit", money(valuation.potentialNetProfit)),
      metric("Confidence", `${valuation.confidenceScore ?? 0}`),
      metric("Comparables", `${valuation.comparableCount ?? 0}`),
      metric("Recommendation", `<span class="badge ${badgeClass(valuation.recommendationBadge)}">${escapeHtml(valuation.recommendationBadge || "Negotiate")}</span>`),
    ].join("");
  }

  function detectedHtml(listing) {
    if (!listing) return "";
    return [
      metric("Current bid", money(listing.currentBid || listing.listedPrice)),
      metric("Current offer", money(listing.currentOffer)),
      metric("Best offer", money(listing.bestOffer)),
      metric("Buy now", money(listing.buyNowPrice)),
      metric("Sold candidate", money(listing.soldPriceCandidate)),
      metric("Buy price auction", money(listing.buyPriceAuction)),
      metric("Invoice total", money(listing.totalInvoiceAmount || listing.finalAcquisitionCost)),
      metric("Price state", priceStateLabel(listing)),
      metric("pageType", listing.pageType || "-"),
      metric("captureKind", listing.captureKind || "-"),
      metric("Mileage", listing.mileageKm ? `${number(listing.mileageKm)} km` : "-"),
      metric("VIN", listing.vin || "-"),
    ].join("");
  }

  function metaHtml(listing, valuation) {
    if (!listing && !valuation) return "";
    return [
      pill("Carfax", carfaxLabel(listing)),
      pill("Deep Capture", listing?.captureLevel === "deep_capture" ? "On - active consent" : "Off - consent needed"),
      pill("Photos", String(listing?.imageCount ?? listing?.photos?.length ?? 0)),
      pill("Videos", String(listing?.videoCount ?? listing?.videos?.length ?? 0)),
      pill("Warnings", String((valuation?.warnings || listing?.warnings || []).length)),
      pill("Missing", String((valuation?.missingData || listing?.missingData || []).length)),
    ].join("");
  }

  function messagesHtml(listing, valuation, message, saveResult) {
    const readiness = readinessSummary(listing);
    const items = [
      message,
      readiness.blockedReason ? `Capture blocked: ${readiness.blockedReason}` : "",
      listing?.carfaxUrlStatus === "text_only" ? "Carfax text found, but no URL is visible." : "",
      listing && listing.captureLevel !== "deep_capture" ? "Deep Capture off: VIN/Carfax may be incomplete on dynamic OpenLane pages." : "",
      savedResultLabel(saveResult),
      ...conditionWarningItems(listing).slice(0, 3),
      ...(valuation?.warnings || listing?.warnings || []).slice(0, 4),
      ...(valuation?.missingData || listing?.missingData || []).slice(0, 4).map((field) => `Missing: ${field}`),
    ].filter(Boolean);
    if (items.length === 0) return "";
    return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function savedResultLabel(saveResult) {
    if (!saveResult?.id && !saveResult?.marketListingId) return "";
    return `Saved IDs: ${[
      saveResult.id ? `Deal Radar ${saveResult.id}` : "",
      saveResult.marketListingId ? `Market listing ${saveResult.marketListingId}` : "",
    ].filter(Boolean).join(" / ")}`;
  }

  function dataQualityHtml(listing, valuation) {
    if (!listing && !valuation) return "<p>No extraction yet.</p>";
    const warnings = valuation?.warnings || listing?.warnings || [];
    const missing = valuation?.missingData || listing?.missingData || [];
    const evidence = listing?.outcomeEvidence || listing?.openlaneMetadata?.classification?.evidence || [];
    const debug = listing?.extractedFields?.debug || {};
    const condition = listing?.condition || listing?.openlaneMetadata?.conditionDetails || {};
    const rejectedCandidates = (listing?.debug?.rejectedCandidates || []).length || (debug.titleCandidates || []).filter((candidate) => candidate.rejectedReason).length + (debug.mediaRejected || []).length;
    const networkCandidates = debug.networkCandidates || {};
    const safeExpansion = listing?.openlaneMetadata?.safeExpansion;
    const deepCaptureRuntime = listing?.openlaneMetadata?.deepCaptureRuntime || {};
    const readiness = readinessSummary(listing);
    const vinCandidates = debug.vinCandidates || [];
    return [
      `<p>Page type: ${safeHtml(listing?.pageType || "-")}</p>`,
      `<p>Capture kind: ${safeHtml(listing?.captureKind || "-")}</p>`,
      `<p>Capture level: ${safeHtml(listing?.captureLevel || "basic_dom")}</p>`,
      `<p>Readiness: ${safeHtml(readiness.state || "-")}</p>`,
      `<p>Capture blocked reason: ${safeHtml(readiness.blockedReason || "-")}</p>`,
      `<p>VIN: ${safeHtml(listing?.vin || "-")}</p>`,
      `<p>VIN status: ${safeHtml(readiness.vinStatus || vinStatusLabel(listing) || "-")}</p>`,
      `<p>VIN evidence source: ${safeHtml(vinEvidenceSource(listing, debug))}</p>`,
      `<p>VIN candidates: ${safeHtml(String(vinCandidates.length || 0))}</p>`,
      `<p>Carfax status: ${safeHtml(carfaxStatusLabel(listing))}</p>`,
      `<p>Carfax URL: ${listing?.carfaxUrl ? `<a href="${escapeHtml(listing.carfaxUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(listing.carfaxUrl)}</a>` : "-"}</p>`,
      `<p>Carfax evidence source: ${safeHtml(carfaxEvidenceLabel(listing))}</p>`,
      listing?.carfaxUrlStatus === "text_only" ? `<p>Carfax warning: ${safeHtml("Visible text only; URL was not available in page evidence.")}</p>` : "",
      `<p>Network observer: ${safeHtml(networkObserverLabel(deepCaptureRuntime))}</p>`,
      `<p>Network evidence count: ${safeHtml(String(networkEvidenceCount(listing, deepCaptureRuntime)))}</p>`,
      `<p>Safe expansion: ${safeHtml(safeExpansion ? `${safeExpansion.clicked?.length || 0} opened / ${safeExpansion.skipped?.length || 0} skipped` : "-")}</p>`,
      `<p>Missing data: ${safeHtml(missing.join(", ") || "-")}</p>`,
      `<p>Extraction confidence: ${safeHtml(valuation?.confidenceScore ?? listing?.extractionConfidenceScore ?? "-")}</p>`,
      `<p>Warnings: ${safeHtml(warnings.length)}</p>`,
      `<p>Top evidence: ${safeHtml(topEvidenceLabel(evidence, debug))}</p>`,
      `<p>Price evidence: ${safeHtml(debug.priceCandidates?.[0]?.label || "-")}</p>`,
      `<p>Condition warnings: ${safeHtml(conditionWarningItems(listing).length)}</p>`,
      `<p>Dealer notes: ${safeHtml(condition.dealerNotes ? "visible" : "-")}</p>`,
      `<p>Rejected candidates: ${safeHtml(rejectedCandidates)}</p>`,
      `<p>Network candidates: ${safeHtml(networkCandidateCount(networkCandidates))}</p>`,
      `<p>Deep Capture runtime: ${safeHtml(deepCaptureRuntimeLabel(deepCaptureRuntime))}</p>`,
      `<p>Evidence</p>`,
      `<ul>${evidence.slice(0, 4).map((item) => `<li>${safeHtml(item.sourceText || item.marker || item.evidenceType || "visible_page_text")}</li>`).join("")}</ul>`,
    ].join("");
  }

  function shouldOpenDebugPanel(state) {
    const listing = state.listing || {};
    const readiness = readinessSummary(listing);
    return Boolean(
      state.status === "warning"
        || state.status === "error"
        || state.debugMode
        || listing.openlaneMetadata?.debugMode
        || readiness.blockedReason
        || !listing.vin
        || listing.carfaxUrlStatus === "text_only"
        || listing.carfaxUrlStatus === "missing",
    );
  }

  function conditionWarningItems(listing) {
    const condition = listing?.condition || listing?.openlaneMetadata?.conditionDetails || {};
    return [
      ...(condition.highRiskTerms || []).map((term) => `Condition risk: ${term}`),
      condition.dealerNotes ? `Dealer notes: ${condition.dealerNotes}` : "",
      ...(condition.mechanicalDisclosures || listing?.mechanicalAnnouncements || []).slice(0, 2).map((item) => `Mechanical: ${item}`),
    ].filter(Boolean);
  }

  function topEvidenceLabel(evidence, debug) {
    const title = debug.titleCandidates?.[0];
    if (title?.text) return `${title.source || "title"} (${title.score || 0})`;
    const first = evidence?.[0];
    return first?.sourceText || first?.marker || first?.evidenceType || "-";
  }

  function carfaxStatusLabel(listing) {
    if (!listing) return "-";
    if (listing.carfaxUrlStatus === "url_found") return "url_found";
    if (listing.carfaxUrlStatus === "text_only") return "text_only";
    return listing.carfaxUrlStatus || "missing";
  }

  function carfaxEvidenceLabel(listing) {
    const evidence = listing?.openlaneMetadata?.carfaxEvidence || listing?.carfax?.evidence || listing?.extractedFields?.carfaxEvidence || [];
    const first = evidence?.[0];
    if (!first) return "-";
    return [first.source, first.endpointPattern, first.urlStatus].filter(Boolean).join(" / ") || first.text || first.sourceText || "-";
  }

  function readinessSummary(listing = {}) {
    const readiness = listing?.openlaneMetadata?.stableCaptureReadiness || {};
    return {
      readyToCapture: Boolean(readiness.readyToCapture),
      state: readiness.state || "",
      blockedReason: readiness.blockedReason || "",
      vinStatus: readiness.vinStatus || vinStatusLabel(listing),
      carfaxStatus: readiness.carfaxStatus || carfaxStatusLabel(listing),
      missingData: readiness.missingData || listing.missingData || [],
    };
  }

  function vinStatusLabel(listing = {}) {
    if (!listing?.vin) return "missing";
    return /^[A-HJ-NPR-Z0-9]{17}$/i.test(String(listing.vin)) ? "found" : "invalid";
  }

  function vinEvidenceSource(listing, debug = {}) {
    return debug.vinCandidates?.[0]?.source
      || listing?.fieldEvidence?.vin?.[0]?.sourceType
      || listing?.extractedFields?.vinEvidence?.matchedLabel
      || "-";
  }

  function networkObserverLabel(runtime = {}) {
    const observer = runtime.networkObserver || {};
    if (observer.enabled) return "enabled";
    return observer.reason || "disabled";
  }

  function networkEvidenceCount(listing, runtime = {}) {
    return Number(runtime.networkEvidenceCount ?? runtime.networkObserver?.observationCount ?? listing?.openlaneMetadata?.networkEvidence?.length ?? 0);
  }

  function networkCandidateCount(candidates) {
    return Number(candidates.vinCandidates?.length || 0) + Number(candidates.mediaCandidates?.length || 0) + Number(candidates.conditionCandidates?.length || 0);
  }

  function deepCaptureRuntimeLabel(runtime = {}) {
    const observer = runtime.networkObserver || {};
    const count = Number(runtime.networkEvidenceCount ?? observer.observationCount ?? 0);
    return runtime.active
      ? `active, consent ${runtime.consentIdPresent ? "present" : "missing"}, network ${observer.enabled ? "on" : observer.reason || "off"}, evidence ${count}`
      : `${runtime.consentStatus || "off"}, consent ${runtime.consentIdPresent ? "present" : "missing"}, network ${observer.reason || "off"}, evidence ${count}`;
  }

  function priceStateLabel(listing) {
    const semantics = listing.priceSemantics || {};
    if (semantics.finalBidAmount || semantics.acceptedAmount || semantics.buyPriceAuction || semantics.totalInvoiceAmount) return "verified outcome";
    if (semantics.soldPriceCandidate || listing.captureKind === "candidate_outcome") return "candidate outcome";
    if (semantics.currentBid || listing.captureKind === "observation") return "observation";
    return "unknown";
  }

  function carfaxLabel(listing) {
    if (!listing) return "Missing";
    if (listing.carfaxUrlStatus === "url_found") return "URL found";
    if (listing.carfaxUrlStatus === "text_only") return "visible, URL missing";
    if (listing.carfaxAvailable) return "Visible";
    return "Missing";
  }

  async function loadWidgetSettings(shadow) {
    const form = shadow.querySelector(".settings-drawer");
    if (!form || !window.DealerFlowMarketSnapStorage) return;
    const settings = await window.DealerFlowMarketSnapStorage.getSettings();
    for (const [key, value] of Object.entries(settings)) {
      const field = form.elements[key];
      if (!field) continue;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = value || "";
    }
  }

  async function saveWidgetSettings(event, callbacks) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    for (const field of Array.from(form.querySelectorAll("input[type='checkbox']"))) {
      values[field.name] = field.checked;
    }
    const saved = await window.DealerFlowMarketSnapStorage.saveSettings(values);
    callbacks.onSettingsSaved?.(saved);
  }

  function installDrag(shadow) {
    const panel = shadow.querySelector(".panel");
    const handle = shadow.querySelector(".drag-handle");
    let start = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
      if (!start) return;
      const left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, start.left + event.clientX - start.x));
      const top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, start.top + event.clientY - start.y));
      setWidgetPosition(panel, { left, top });
    });
    handle.addEventListener("pointerup", () => {
      if (!start) return;
      start = null;
      chrome.storage?.local?.set?.({ marketSnapWidgetPosition: readWidgetPosition(panel) });
    });
  }

  async function restoreWidgetPosition(shadow) {
    const panel = shadow.querySelector(".panel");
    const stored = await chrome.storage?.local?.get?.("marketSnapWidgetPosition");
    if (stored?.marketSnapWidgetPosition) setWidgetPosition(panel, stored.marketSnapWidgetPosition);
  }

  function setWidgetPosition(panel, position) {
    panel.style.left = `${Math.round(position.left)}px`;
    panel.style.top = `${Math.round(position.top)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  function readWidgetPosition(panel) {
    const rect = panel.getBoundingClientRect();
    return { left: Math.round(rect.left), top: Math.round(rect.top) };
  }

  function vehicleLabel(listing) {
    if (!listing) return "";
    return [listing.year, listing.make, listing.model, listing.trim].filter(Boolean).join(" ") || listing.title || "OpenLane vehicle";
  }

  function metric(label, value) {
    return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${String(value || "-")}</strong></div>`;
  }

  function pill(label, value) {
    return `<span class="pill">${escapeHtml(label)}: ${escapeHtml(value)}</span>`;
  }

  function money(value) {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function number(value) {
    return new Intl.NumberFormat("en-CA").format(Number(value || 0));
  }

  function badgeClass(value) {
    return value === "Strong Buy" ? "good" : value === "High Risk" || value === "Avoid" ? "bad" : "warn";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }

  function safeHtml(value) {
    return escapeHtml(redactSensitiveText(value));
  }

  function redactSensitiveText(value) {
    return String(value ?? "")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
      .replace(/\b(?:auth|authorization|cookie|token|secret|credential|session|password|csrf|jwt)\s*[:=]\s*[^,\s"'<>]+/gi, "[redacted]");
  }

  function widgetCss() {
    return `
      :host { all: initial; color-scheme: dark; pointer-events: none; }
      .panel { pointer-events: auto; position: fixed; left: 18px; bottom: 18px; z-index: 2147483647; width: min(360px, calc(100vw - 24px)); max-height: min(720px, calc(100vh - 32px)); overflow: hidden; border: 1px solid rgba(148,163,184,.32); border-radius: 10px; background: #08111d; color: #e5eef8; box-shadow: 0 20px 54px rgba(0,0,0,.38); font: 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-bottom: 1px solid rgba(148,163,184,.18); background: #0f172a; }
      strong { font-size: 14px; }
      .source { margin-left: 8px; color: #94a3b8; font-size: 12px; }
      .icon { width: 28px; height: 28px; border: 1px solid rgba(148,163,184,.28); border-radius: 6px; background: #111827; color: #e5eef8; cursor: pointer; }
      .body { display: grid; gap: 9px; max-height: 650px; overflow: auto; padding: 12px; }
      .collapsed .body { display: none; }
      .status { margin: 0; color: #cbd5e1; }
      .vehicle { margin: 0; color: #fff; font-weight: 700; }
      .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .metric { min-width: 0; border: 1px solid rgba(148,163,184,.16); border-radius: 7px; background: rgba(15,23,42,.78); padding: 7px; }
      .metric span { display: block; color: #94a3b8; font-size: 11px; }
      .metric strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; color: #f8fafc; font-size: 13px; }
      .meta { display: flex; flex-wrap: wrap; gap: 6px; }
      .pill, .badge { border-radius: 999px; padding: 3px 7px; background: rgba(148,163,184,.14); color: #dbeafe; font-size: 11px; font-weight: 700; }
      .badge.good { background: rgba(52,211,153,.14); color: #bbf7d0; }
      .badge.warn { background: rgba(251,191,36,.14); color: #fde68a; }
      .badge.bad { background: rgba(251,113,133,.14); color: #fecdd3; }
      ul { margin: 0; padding-left: 18px; color: #cbd5e1; }
      .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .actions button { min-height: 31px; border: 1px solid rgba(103,183,199,.32); border-radius: 7px; background: #67b7c7; color: #041018; cursor: pointer; font-weight: 800; }
      .actions button:nth-child(3), .actions button:nth-child(4) { background: #111827; color: #e5eef8; }
      .actions button[hidden] { display: none; }
      .settings-drawer { display: grid; gap: 7px; border: 1px solid rgba(148,163,184,.18); border-radius: 7px; padding: 8px; background: rgba(15,23,42,.72); }
      .settings-drawer[hidden] { display: none; }
      .settings-drawer label { display: grid; gap: 4px; color: #cbd5e1; font-size: 12px; }
      .settings-drawer input[type='url'], .settings-drawer input[type='text'] { min-height: 28px; border: 1px solid rgba(148,163,184,.28); border-radius: 6px; background: #020617; color: #f8fafc; padding: 0 7px; }
      .settings-drawer button { min-height: 30px; border: 1px solid rgba(103,183,199,.32); border-radius: 7px; background: #67b7c7; color: #041018; font-weight: 800; }
      .data-quality { border: 1px solid rgba(148,163,184,.18); border-radius: 7px; padding: 7px; background: rgba(15,23,42,.48); }
      .data-quality summary { cursor: pointer; color: #dbeafe; font-weight: 800; }
      .data-quality p { margin: 6px 0; color: #cbd5e1; }
      .error header { border-bottom-color: rgba(251,113,133,.32); }
      .warning header { border-bottom-color: rgba(251,191,36,.32); }
      .saved header { border-bottom-color: rgba(52,211,153,.32); }
    `;
  }

  function mount(callbacks) {
    return createMarketSnapWidget(callbacks);
  }

  function updateState(state) {
    return createMarketSnapWidget().render(state);
  }

  function showLoading(message) {
    return createMarketSnapWidget().showLoading(message);
  }

  function showDisconnected(message) {
    return createMarketSnapWidget().showDisconnected(message);
  }

  function showExtraction(listing) {
    return createMarketSnapWidget().showExtraction(listing);
  }

  function showValuation(listing, valuation) {
    return createMarketSnapWidget().showValuation(listing, valuation);
  }

  function showError(message) {
    return createMarketSnapWidget().showError(message);
  }

  function destroy() {
    const host = document.getElementById(HOST_ID);
    host?.__dealerFlowWidget?.destroy();
  }

  window.DealerFlowMarketSnapWidget = {
    createMarketSnapWidget,
    mount,
    updateState,
    showLoading,
    showDisconnected,
    showExtraction,
    showValuation,
    showError,
    destroy,
  };
})();
