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
            <summary>Data quality</summary>
            <div class="quality-body"></div>
          </details>
          <form class="settings-drawer" hidden>
            <label>Dealer Flow URL <input name="dealerFlowBaseUrl" id="dealerFlowBaseUrl" type="url" /></label>
            <label>Organization ID <input name="organizationId" id="organizationId" type="text" /></label>
            <label><input name="autoAnalyze" type="checkbox" /> Auto-analyze</label>
            <label><input name="autoCapture" type="checkbox" /> Capture observations/outcomes</label>
            <label><input name="modelImprovementOptIn" type="checkbox" /> Model improvement opt-in</label>
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
    shadow.querySelector(".settings-drawer").hidden = !state.settingsOpen;
    shadow.querySelector(".messages").innerHTML = messagesHtml(state.listing, state.valuation, state.message);
  }

  function statusText(state) {
    if (state.status === "detecting") return "OpenLane vehicle detected.";
    if (state.status === "extracting") return "Extracting visible OpenLane data...";
    if (state.status === "loading" || state.status === "analyzing") return "Analyzing visible OpenLane page...";
    if (state.status === "disconnected") return state.message || "Connect Dealer Flow in Market Snap settings.";
    if (state.status === "warning") return state.message || "Vehicle data is incomplete.";
    if (state.status === "error") return state.message || "Market Snap could not analyze this page.";
    if (state.status === "saved") return "Saved to Deal Radar.";
    if (state.valuation) return "Analysis ready.";
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
      pill("Photos", String(listing?.imageCount ?? listing?.photos?.length ?? 0)),
      pill("Videos", String(listing?.videoCount ?? listing?.videos?.length ?? 0)),
      pill("Warnings", String((valuation?.warnings || listing?.warnings || []).length)),
      pill("Missing", String((valuation?.missingData || listing?.missingData || []).length)),
    ].join("");
  }

  function messagesHtml(listing, valuation, message) {
    const items = [
      message,
      ...(valuation?.warnings || listing?.warnings || []).slice(0, 4),
      ...(valuation?.missingData || listing?.missingData || []).slice(0, 4).map((field) => `Missing: ${field}`),
    ].filter(Boolean);
    if (items.length === 0) return "";
    return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function dataQualityHtml(listing, valuation) {
    if (!listing && !valuation) return "<p>No extraction yet.</p>";
    const warnings = valuation?.warnings || listing?.warnings || [];
    const missing = valuation?.missingData || listing?.missingData || [];
    const evidence = listing?.outcomeEvidence || listing?.openlaneMetadata?.classification?.evidence || [];
    const debug = listing?.extractedFields?.debug || {};
    return [
      `<p>Confidence: ${escapeHtml(valuation?.confidenceScore ?? listing?.extractionConfidenceScore ?? "-")}</p>`,
      `<p>Warnings: ${escapeHtml(warnings.length)}</p>`,
      `<p>Missing: ${escapeHtml(missing.length)}</p>`,
      `<p>Classifier: ${escapeHtml(listing?.pageType || "-")} / ${escapeHtml(listing?.captureKind || "-")}</p>`,
      `<p>VIN evidence: ${escapeHtml(debug.vinCandidates?.[0]?.source || listing?.extractedFields?.vinEvidence?.matchedLabel || "-")}</p>`,
      `<p>Price evidence: ${escapeHtml(debug.priceCandidates?.[0]?.label || "-")}</p>`,
      `<p>Evidence</p>`,
      `<ul>${evidence.slice(0, 4).map((item) => `<li>${escapeHtml(item.sourceText || item.marker || item.evidenceType || "visible_page_text")}</li>`).join("")}</ul>`,
    ].join("");
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

  function widgetCss() {
    return `
      :host { all: initial; color-scheme: dark; }
      .panel { position: fixed; left: 18px; bottom: 18px; z-index: 2147483647; width: min(360px, calc(100vw - 24px)); max-height: min(720px, calc(100vh - 32px)); overflow: hidden; border: 1px solid rgba(148,163,184,.32); border-radius: 10px; background: #08111d; color: #e5eef8; box-shadow: 0 20px 54px rgba(0,0,0,.38); font: 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
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
