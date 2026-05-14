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
        <header>
          <div>
            <strong>Market Snap</strong>
            <span class="source">OpenLane</span>
          </div>
          <button class="icon collapse" type="button" title="Collapse or expand">-</button>
        </header>
        <div class="body">
          <p class="status">Detecting OpenLane vehicle...</p>
          <p class="vehicle"></p>
          <div class="metrics"></div>
          <div class="meta"></div>
          <div class="messages"></div>
          <div class="actions">
            <button type="button" data-action="refresh">Refresh</button>
            <button type="button" data-action="save">Save</button>
            <button type="button" data-action="copy">Copy JSON</button>
            <button type="button" data-action="open">Open Dealer Flow</button>
          </div>
        </div>
      </section>
    `;

    const state = { collapsed: false, listing: null, valuation: null, status: "idle", message: "" };
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
    };

    shadow.querySelector(".collapse").addEventListener("click", () => api.setCollapsed(!state.collapsed));
    shadow.querySelector("[data-action='refresh']").addEventListener("click", () => callbacks.onRefresh?.());
    shadow.querySelector("[data-action='save']").addEventListener("click", () => callbacks.onSave?.());
    shadow.querySelector("[data-action='copy']").addEventListener("click", () => callbacks.onCopy?.());
    shadow.querySelector("[data-action='open']").addEventListener("click", () => callbacks.onOpenDealerFlow?.());

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
    shadow.querySelector(".metrics").innerHTML = state.valuation ? metricsHtml(state.valuation) : detectedHtml(state.listing);
    shadow.querySelector(".meta").innerHTML = metaHtml(state.listing, state.valuation);
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
      metric("Mileage", listing.mileageKm ? `${number(listing.mileageKm)} km` : "-"),
      metric("VIN", listing.vin || "-"),
    ].join("");
  }

  function metaHtml(listing, valuation) {
    if (!listing && !valuation) return "";
    return [
      pill("Carfax", listing?.carfaxAvailable ? "Visible" : "Missing"),
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
      .panel { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; width: min(360px, calc(100vw - 24px)); max-height: min(720px, calc(100vh - 32px)); overflow: hidden; border: 1px solid rgba(148,163,184,.32); border-radius: 10px; background: #08111d; color: #e5eef8; box-shadow: 0 20px 54px rgba(0,0,0,.38); font: 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
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
      .error header { border-bottom-color: rgba(251,113,133,.32); }
      .warning header { border-bottom-color: rgba(251,191,36,.32); }
      .saved header { border-bottom-color: rgba(52,211,153,.32); }
    `;
  }

  window.DealerFlowMarketSnapWidget = {
    createMarketSnapWidget,
  };
})();
