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

    shadow.querySelector(".collapse").addEventListener("click", () => runWidgetAction(() => api.setCollapsed(!state.collapsed), callbacks, "Collapse failed"));
    shadow.querySelector("[data-action='refresh']").addEventListener("click", () => runWidgetAction(callbacks.onRefresh, callbacks, "Refresh failed"));
    shadow.querySelector("[data-action='save']").addEventListener("click", () => runWidgetAction(callbacks.onSave, callbacks, "Save failed"));
    shadow.querySelector("[data-action='copy']").addEventListener("click", () => runWidgetAction(callbacks.onCopy, callbacks, "Copy JSON failed"));
    shadow.querySelector("[data-action='open']").addEventListener("click", () => runWidgetAction(callbacks.onOpenDealerFlow, callbacks, "Open Dealer Flow failed"));
    shadow.querySelector("[data-action='hide']").addEventListener("click", () => runWidgetAction(callbacks.onHidePage, callbacks, "Hide page failed"));
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
    const safeListing = listing || {};
    if (!listing) return "";
    return [
      metric("Current bid", moneyOrDash(safeListing.currentBid || safeListing.listedPrice)),
      metric("Current offer", moneyOrDash(safeListing.currentOffer)),
      metric("Best offer", moneyOrDash(safeListing.bestOffer)),
      metric("Buy now", moneyOrDash(safeListing.buyNowPrice)),
      metric("Sold price", moneyOrDash(safeListing.soldPriceCandidate)),
      metric("Buy price auction", moneyOrDash(safeListing.buyPriceAuction)),
      metric("Final bid amount", moneyOrDash(safeListing.finalBidAmount)),
      metric("Invoice total", moneyOrDash(safeListing.totalInvoiceAmount || safeListing.finalAcquisitionCost)),
      metric("Price state", priceStateLabel(safeListing)),
      metric("pageType", safeListing.pageType || "-"),
      metric("captureKind", safeListing.captureKind || "-"),
      metric("Mileage", safeListing.mileageKm ? `${number(safeListing.mileageKm)} km` : "-"),
      metric("VIN", safeListing.vin || "-"),
    ].join("");
  }

  function metaHtml(listing, valuation) {
    const safeListing = listing || {};
    if (!listing && !valuation) return "";
    return [
      pill("Carfax", carfaxLabel(safeListing)),
      pill("Deep Capture", deepCaptureStatusLabel(safeListing)),
      pill("Photos", String(safeListing.imageCount ?? safeListing.photos?.length ?? 0)),
      pill("Videos", String(safeListing.videoCount ?? safeListing.videos?.length ?? 0)),
      pill("Warnings", String((valuation?.warnings || safeListing.warnings || []).length)),
      pill("Missing", String((valuation?.missingData || safeListing.missingData || []).length)),
    ].join("");
  }

  function messagesHtml(listing, valuation, message, saveResult) {
    const safeListing = listing || {};
    const readiness = readinessSummary(safeListing);
    const items = [
      message,
      readiness.blockedReason ? `Capture blocked: ${readiness.blockedReason}` : "",
      ...diagnosticMessages(safeListing),
      safeListing.carfaxUrlStatus === "text_only" ? "Carfax text found, but no URL is visible." : "",
      listing && safeListing.captureLevel !== "deep_capture" ? "Deep Capture disabled: missing Dealer Flow URL or Organization ID, or disabled by user." : "",
      savedResultLabel(saveResult),
      ...conditionWarningItems(safeListing).slice(0, 3),
      ...(valuation?.warnings || safeListing.warnings || []).slice(0, 4),
      ...(valuation?.missingData || safeListing.missingData || []).slice(0, 4).map((field) => `Missing: ${field}`),
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
    const safeListing = listing || {};
    if (!listing && !valuation) return "<p>No extraction yet.</p>";
    const warnings = valuation?.warnings || safeListing.warnings || [];
    const missing = valuation?.missingData || safeListing.missingData || [];
    const evidence = safeListing.outcomeEvidence || safeListing.openlaneMetadata?.classification?.evidence || [];
    const debug = safeListing.extractedFields?.debug || {};
    const condition = safeListing.condition || safeListing.openlaneMetadata?.conditionDetails || {};
    const rejectedCandidates = (safeListing.debug?.rejectedCandidates || []).length || (debug.titleCandidates || []).filter((candidate) => candidate.rejectedReason).length + (debug.mediaRejected || []).length;
    const networkCandidates = debug.networkCandidates || {};
    const safeExpansion = safeListing.openlaneMetadata?.safeExpansion;
    const deepCaptureRuntime = safeListing.openlaneMetadata?.deepCaptureRuntime || {};
    const readiness = readinessSummary(safeListing);
    const vinCandidates = debug.vinCandidates || [];
    const rejectedFieldCandidates = rejectedFieldCandidateItems(safeListing);
    const priceDiagnostics = buildPriceDiagnostics(safeListing);
    const currentBidDebug = buildCurrentBidDebug(safeListing, priceDiagnostics);
    const contradictions = contradictionDiagnostics(safeListing, priceDiagnostics);
    const conditionDebug = conditionCleanupDebug(safeListing);
    return [
      `<p>Page type: ${safeHtml(safeListing.pageType || "-")}</p>`,
      `<p>Capture kind: ${safeHtml(safeListing.captureKind || "-")}</p>`,
      `<p>Outcome confidence: ${safeHtml(safeListing.outcomeConfidence || "-")}</p>`,
      `<p>Capture level: ${safeHtml(safeListing.captureLevel || "basic_dom")}</p>`,
      `<p>Deep Capture active: ${safeHtml(String(Boolean(deepCaptureRuntime.active || safeListing.captureLevel === "deep_capture")))}</p>`,
      `<p>Deep Capture activation mode: ${safeHtml(safeListing.deepCaptureActivationMode || deepCaptureRuntime.deepCaptureActivationMode || "-")}</p>`,
      `<p>Consent mode: ${safeHtml(safeListing.consentMode || deepCaptureRuntime.consentMode || "-")}</p>`,
      `<p>Readiness: ${safeHtml(readiness.state || "-")}</p>`,
      `<p>Capture blocked reason: ${safeHtml(readiness.blockedReason || "-")}</p>`,
      `<p>Required fields for page type: ${safeHtml(requiredFieldsForPageType(safeListing).join(", ") || "-")}</p>`,
      `<p>Listed price requirement: ${safeHtml(listedPriceRequirementReason(safeListing))}</p>`,
      `<p>VIN: ${safeHtml(safeListing.vin || "-")}</p>`,
      `<p>VIN status: ${safeHtml(readiness.vinStatus || vinStatusLabel(safeListing) || "-")}</p>`,
      `<p>VIN evidence source: ${safeHtml(vinEvidenceSource(safeListing, debug))}</p>`,
      `<p>VIN candidates: ${safeHtml(String(vinCandidates.length || 0))}</p>`,
      `<p>Carfax status: ${safeHtml(carfaxStatusLabel(safeListing))}</p>`,
      `<p>Carfax URL: ${safeListing.carfaxUrl ? `<a href="${escapeHtml(safeListing.carfaxUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeListing.carfaxUrl)}</a>` : "-"}</p>`,
      `<p>Carfax evidence source: ${safeHtml(carfaxEvidenceLabel(safeListing))}</p>`,
      safeListing.carfaxUrlStatus === "text_only" ? `<p>Carfax warning: ${safeHtml("Visible text only; URL was not available in page evidence.")}</p>` : "",
      `<p>Carfax diagnostics: ${safeHtml(carfaxDiagnosticsLabel(safeListing))}</p>`,
      `<p>Network observer: ${safeHtml(networkObserverLabel(deepCaptureRuntime))}</p>`,
      `<p>Network diagnostics: ${safeHtml(networkObserverDiagnosticsLabel(deepCaptureRuntime))}</p>`,
      `<p>Network evidence count: ${safeHtml(String(networkEvidenceCount(safeListing, deepCaptureRuntime)))}</p>`,
      networkObserverDiagnosticMessage(safeListing, deepCaptureRuntime) ? `<p>Network diagnostic: ${safeHtml(networkObserverDiagnosticMessage(safeListing, deepCaptureRuntime))}</p>` : "",
      `<p>Classification contradictions: ${safeHtml(String(contradictions.classificationContradictions.length))}</p>`,
      `<p>Price contradictions: ${safeHtml(String(contradictions.priceContradictions.length))}</p>`,
      `<p>Condition contradictions: ${safeHtml(String(contradictions.conditionContradictions.length))}</p>`,
      `<p>Carfax contradictions: ${safeHtml(String(contradictions.carfaxContradictions.length))}</p>`,
      `<p>Network contradictions: ${safeHtml(String(contradictions.networkContradictions.length))}</p>`,
      `<p>Price state: ${safeHtml(priceStateLabel(safeListing))}</p>`,
      `<p>Current bid: ${safeHtml(moneyOrDash(safeListing.currentBid))}</p>`,
      `<p>Current bid source: ${safeHtml(priceDiagnostics.currentBidSource || "-")}</p>`,
      `<p>Current bid source text: ${safeHtml(priceDiagnostics.currentBidSourceText || "-")}</p>`,
      `<p>Current bid confidence: ${safeHtml(priceDiagnostics.currentBidConfidence ?? "-")}</p>`,
      `<p>Fresh bid panel candidates: ${safeHtml(String(currentBidDebug.freshBidPanelCandidates.length || 0))}</p>`,
      `<p>Bid monitor status: ${safeHtml(currentBidDebug.bidMonitorStatus ? JSON.stringify(currentBidDebug.bidMonitorStatus).slice(0, 180) : "-")}</p>`,
      `<p>Last bid updated at: ${safeHtml(currentBidDebug.lastBidUpdatedAt || "-")}</p>`,
      priceDiagnostics.rejectedPriceCandidates?.length ? `<p>Rejected price candidates: ${safeHtml(String(priceDiagnostics.rejectedPriceCandidates.length))}</p>` : "",
      priceDiagnostics.rejectedPriceCandidates?.length ? `<ul>${priceDiagnostics.rejectedPriceCandidates.slice(0, 5).map((item) => `<li>${safeHtml(rejectedPriceCandidateLabel(item))}</li>`).join("")}</ul>` : "",
      priceDiagnostics.rejectedOutcomePriceCandidates?.length ? `<p>Rejected outcome price candidates: ${safeHtml(String(priceDiagnostics.rejectedOutcomePriceCandidates.length))}</p>` : "",
      priceDiagnostics.rejectedOutcomePriceCandidates?.length ? `<ul>${priceDiagnostics.rejectedOutcomePriceCandidates.slice(0, 5).map((item) => `<li>${safeHtml(rejectedPriceCandidateLabel(item))}</li>`).join("")}</ul>` : "",
      priceDiagnostics.lowerBidCandidates?.length ? `<p>Lower bid candidates ignored: ${safeHtml(String(priceDiagnostics.lowerBidCandidates.length))}</p>` : "",
      priceDiagnostics.lowerBidCandidates?.length ? `<ul>${priceDiagnostics.lowerBidCandidates.slice(0, 5).map((item) => `<li>${safeHtml(rejectedPriceCandidateLabel(item))}</li>`).join("")}</ul>` : "",
      priceDiagnostics.staleCurrentBidCandidates?.length ? `<p>Stale current bid candidates ignored: ${safeHtml(String(priceDiagnostics.staleCurrentBidCandidates.length))}</p>` : "",
      priceDiagnostics.staleCurrentBidCandidates?.length ? `<ul>${priceDiagnostics.staleCurrentBidCandidates.slice(0, 5).map((item) => `<li>${safeHtml(rejectedPriceCandidateLabel(item))}</li>`).join("")}</ul>` : "",
      `<p>Listed price source: ${safeHtml(priceDiagnostics.listedPriceSource || "-")}</p>`,
      `<p>Listed price semantics: ${safeHtml(priceDiagnostics.listedPriceSemantics || "-")}</p>`,
      `<p>Sold price candidate: ${safeHtml(moneyOrDash(safeListing.soldPriceCandidate))}</p>`,
      `<p>Buy price auction: ${safeHtml(moneyOrDash(safeListing.buyPriceAuction))}</p>`,
      `<p>Final bid amount: ${safeHtml(moneyOrDash(safeListing.finalBidAmount))}</p>`,
      `<p>Purchase evidence source: ${safeHtml(purchaseEvidenceSource(safeListing))}</p>`,
      `<p>Sold price parser status: ${safeHtml(soldPriceParserStatus(safeListing, priceDiagnostics))}</p>`,
      `<p>Purchase marker rejected reasons: ${safeHtml(purchaseMarkerRejectedReasons(safeListing).join(", ") || "-")}</p>`,
      `<p>Ignored noisy zones: ${safeHtml(ignoredNoisyZonesLabel(safeListing))}</p>`,
      `<p>Rejected condition lines: ${safeHtml(String(conditionDebug.rejectedConditionLines.length || 0))}</p>`,
      `<p>Section boundary decisions: ${safeHtml(String(conditionDebug.sectionBoundaryDecisions.length || 0))}</p>`,
      `<p>Safe expansion: ${safeHtml(safeExpansion ? `${safeExpansion.clicked?.length || 0} opened / ${safeExpansion.skipped?.length || 0} skipped` : "-")}</p>`,
      `<p>Missing data: ${safeHtml(missing.join(", ") || "-")}</p>`,
      `<p>Extraction confidence: ${safeHtml(valuation?.confidenceScore ?? safeListing.extractionConfidenceScore ?? "-")}</p>`,
      `<p>Warnings: ${safeHtml(warnings.length)}</p>`,
      `<p>Top evidence: ${safeHtml(topEvidenceLabel(evidence, debug))}</p>`,
      `<p>Price evidence: ${safeHtml(priceDiagnostics.currentBidSource || debug.priceCandidates?.[0]?.label || "-")}</p>`,
      `<p>Condition warnings: ${safeHtml(conditionWarningItems(safeListing).length)}</p>`,
      `<p>Dealer notes: ${safeHtml(condition.dealerNotes ? "visible" : "-")}</p>`,
      `<p>Rejected candidates: ${safeHtml(rejectedCandidates)}</p>`,
      `<p>Rejected field candidates: ${safeHtml(rejectedFieldCandidates.length || "-")}</p>`,
      rejectedFieldCandidates.length ? `<ul>${rejectedFieldCandidates.slice(0, 5).map((item) => `<li>${safeHtml(item)}</li>`).join("")}</ul>` : "",
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
    const safeListing = listing || {};
    const condition = safeListing.condition || safeListing.openlaneMetadata?.conditionDetails || {};
    return [
      ...(condition.highRiskTerms || []).map((term) => `Condition risk: ${term}`),
      condition.dealerNotes ? `Dealer notes: ${condition.dealerNotes}` : "",
      ...(condition.mechanicalDisclosures || safeListing.mechanicalAnnouncements || []).slice(0, 2).map((item) => `Mechanical: ${item}`),
    ].filter(Boolean);
  }

  function topEvidenceLabel(evidence, debug) {
    const title = debug.titleCandidates?.[0];
    if (title?.text) return `${title.source || "title"} (${title.score || 0})`;
    const first = evidence?.[0];
    return first?.sourceText || first?.marker || first?.evidenceType || "-";
  }

  function diagnosticMessages(listing = {}) {
    const safeListing = listing || {};
    return [
      classificationMessage(safeListing),
      priceDiagnosticMessage(safeListing),
      bidStabilizationMessage(safeListing),
      ...priceRejectionMessages(safeListing),
      ...contradictionWarningItems(safeListing),
      transportIgnoredMessage(safeListing),
      safeListing.carfaxUrlStatus === "text_only" ? "Carfax text found, but no URL is exposed." : "",
      networkObserverDiagnosticMessage(safeListing, safeListing.openlaneMetadata?.deepCaptureRuntime || {}),
      ignoredNoisyZones(safeListing).length ? "Q&A/sidebar/market-guide text ignored for canonical fields." : "",
    ].filter(Boolean);
  }

  function classificationMessage(listing = {}) {
    const safeListing = listing || {};
    if (safeListing.pageType === "purchase_detail" || safeListing.captureKind === "verified_outcome") {
      return `Purchased VDP detected from ${purchaseEvidenceSource(safeListing)}.`;
    }
    if (safeListing.pageType === "active_listing" || safeListing.captureKind === "observation") {
      return "Active listing detected. Current bid is observation-only.";
    }
    return "";
  }

  function priceDiagnosticMessage(listing = {}) {
    const safeListing = listing || {};
    if (safeListing.soldPriceCandidate || safeListing.buyPriceAuction) return "Sold price extracted from purchase panel.";
    if (safeListing.currentBid && !safeListing.soldPriceCandidate) return "Current bid is observation-only and is not saved as a final sale label.";
    if ((safeListing.pageType === "active_listing" || safeListing.captureKind === "observation") && !safeListing.currentBid) return "Current bid not found. Active listing remains observation-only.";
    return "";
  }

  function bidStabilizationMessage(listing = {}) {
    const state = listing.openlaneMetadata?.bidStabilization || {};
    if (!state.bidStabilizationAttempts) return "";
    if (state.initialCurrentBid && state.finalCurrentBid && state.initialCurrentBid !== state.finalCurrentBid) {
      return `Current bid updated from ${moneyOrDash(state.initialCurrentBid)} to ${moneyOrDash(state.finalCurrentBid)} after bid panel stabilization.`;
    }
    if (state.bidState && state.bidState !== "stable") return `Bid panel stabilization checked ${state.bidStabilizationAttempts} time(s); state: ${state.bidState}.`;
    return "";
  }

  function priceRejectionMessages(listing = {}) {
    return buildPriceDiagnostics(listing).rejectedPriceCandidates
      .filter((candidate) => /bid_count_not_money/i.test(candidate.rejectionReason || ""))
      .map((candidate) => `Rejected bid count as price: ${candidate.sourceText || candidate.value}`)
      .slice(0, 3);
  }

  function buildPriceDiagnostics(listing = {}) {
    const safeListing = listing || {};
    const debug = safeListing.extractedFields?.debug || {};
    const currentBidEvidence = safeListing.extractedFields?.currentBidEvidence
      || safeListing.fieldEvidence?.currentBid?.[0]
      || {};
    const rejectedPriceCandidates = (debug.priceCandidates || [])
      .filter((candidate) => candidate.rejectedReason || candidate.rejectionReason)
      .map((candidate) => ({
        field: candidate.field || candidate.label || "price",
        value: candidate.value ?? null,
        sourceType: candidate.sourceType || candidate.source || "",
        sourceName: candidate.sourceName || candidate.label || "",
        sourceText: redactSensitiveText(candidate.sourceText || "").slice(0, 300),
        rejectionReason: candidate.rejectedReason || candidate.rejectionReason,
      }))
      .slice(0, 8);
    const lowerBidCandidates = (debug.lowerBidCandidates || [])
      .map((candidate) => ({
        field: candidate.field || "currentBid",
        value: candidate.value ?? null,
        sourceType: candidate.sourceType || "",
        sourceName: candidate.sourceName || "",
        sourceText: redactSensitiveText(candidate.sourceText || "").slice(0, 300),
        rejectionReason: candidate.rejectedReason || candidate.rejectionReason || "lower_bid_candidate",
      }))
      .slice(0, 6);
    const staleCurrentBidCandidates = (debug.staleCurrentBidCandidates || [])
      .map((candidate) => ({
        field: candidate.field || "currentBid",
        value: candidate.value ?? null,
        sourceType: candidate.sourceType || "",
        sourceName: candidate.sourceName || "",
        sourceText: redactSensitiveText(candidate.sourceText || "").slice(0, 300),
        recencyText: redactSensitiveText(candidate.recencyText || "").slice(0, 80),
        freshnessScore: candidate.freshnessScore ?? null,
        rejectionReason: candidate.rejectedReason || candidate.rejectionReason || "stale_current_bid_candidate",
      }))
      .slice(0, 6);
    return {
      currentBid: safeListing.currentBid ?? null,
      currentBidSource: currentBidEvidence.sourceType || currentBidEvidence.matchedLabel || "",
      currentBidSourceText: redactSensitiveText(currentBidEvidence.sourceText || "").slice(0, 300),
      currentBidConfidence: currentBidEvidence.confidenceScore ?? null,
      rejectedPriceCandidates,
      rejectedOutcomePriceCandidates: rejectedOutcomePriceCandidates(safeListing, rejectedPriceCandidates),
      lowerBidCandidates,
      staleCurrentBidCandidates,
      listedPrice: safeListing.listedPrice ?? null,
      listedPriceSource: debug.listedPriceDecision?.source || "",
      listedPriceSemantics: safeListing.priceSemantics?.listedPrice || debug.listedPriceDecision?.semantics || "",
    };
  }

  function buildCurrentBidDebug(listing = {}, priceDiagnostics = buildPriceDiagnostics(listing)) {
    const safeListing = listing || {};
    const debug = safeListing.extractedFields?.debug || {};
    const bidStabilization = safeListing.openlaneMetadata?.bidStabilization || {};
    const bidLiveMonitor = safeListing.openlaneMetadata?.bidLiveMonitor || null;
    const currentBidEvidence = safeListing.extractedFields?.currentBidEvidence
      || safeListing.fieldEvidence?.currentBid?.[0]
      || {};
    const priceCandidates = Array.isArray(debug.priceCandidates) ? debug.priceCandidates : [];
    const freshBidPanelCandidates = priceCandidates
      .filter((candidate) => /bid_panel|top_row|current_bid|bid_history/i.test(`${candidate.sourceType || ""} ${candidate.sourceName || ""} ${candidate.label || ""}`) && !candidate.rejectedReason && !candidate.rejectionReason)
      .map((candidate) => ({
        value: candidate.value ?? null,
        sourceType: candidate.sourceType || candidate.source || "",
        sourceName: candidate.sourceName || candidate.label || "",
        sourceText: redactSensitiveText(candidate.sourceText || "").slice(0, 300),
      }))
      .slice(0, 5);
    const winningSource = currentBidEvidence.sourceType || currentBidEvidence.matchedLabel || priceDiagnostics.currentBidSource || "";
    return {
      winningCurrentBid: safeListing.currentBid ?? null,
      winningCurrentBidSource: winningSource,
      winningSource,
      sourceText: redactSensitiveText(currentBidEvidence.sourceText || priceDiagnostics.currentBidSourceText || "").slice(0, 300),
      freshBidPanelCandidates,
      bidMonitorStatus: bidLiveMonitor,
      lastBidUpdatedAt: bidLiveMonitor?.updatedAt || bidStabilization.bidUpdatedAt || currentBidEvidence.capturedAt || "",
    };
  }

  function contradictionDiagnostics(listing = {}, priceDiagnostics = buildPriceDiagnostics(listing)) {
    const rejectedMarkers = purchaseMarkerRejectedEvidence(listing);
    const conditionDebug = conditionCleanupDebug(listing);
    const networkMessage = networkObserverDiagnosticMessage(listing, listing.openlaneMetadata?.deepCaptureRuntime || {});
    return {
      classificationContradictions: rejectedMarkers.map((item) => item.rejectedReason || item.rejectionReason || item.marker || "rejected_purchase_marker").slice(0, 8),
      priceContradictions: [
        ...(priceDiagnostics.staleCurrentBidCandidates || []),
        ...(priceDiagnostics.lowerBidCandidates || []),
        ...(priceDiagnostics.rejectedOutcomePriceCandidates || []),
      ].slice(0, 12),
      conditionContradictions: conditionDebug.rejectedConditionLines || [],
      carfaxContradictions: listing.carfaxUrlStatus === "text_only" ? ["carfax_text_visible_without_safe_url"] : [],
      networkContradictions: networkMessage ? [networkMessage] : [],
    };
  }

  function contradictionWarningItems(listing = {}) {
    const contradictions = contradictionDiagnostics(listing);
    return [
      contradictions.classificationContradictions.length ? `Purchase marker rejected: ${contradictions.classificationContradictions[0]}` : "",
      contradictions.priceContradictions.length ? "Conflicting price evidence was rejected; see Capture debug." : "",
      contradictions.conditionContradictions.length ? "Condition noise was rejected from disclosures." : "",
      contradictions.networkContradictions.length ? contradictions.networkContradictions[0] : "",
    ].filter(Boolean).slice(0, 4);
  }

  function purchaseMarkerRejectedEvidence(listing = {}) {
    const classification = listing.openlaneMetadata?.classification || listing.extractedFields?.debug?.classifierDecision || {};
    return (classification.ignoredEvidence || [])
      .filter((item) => item?.rejectedReason || item?.rejectionReason || /purchase|pickup|paid|outcome|sold/i.test(`${item?.marker || ""} ${item?.sourceText || ""}`))
      .slice(0, 12);
  }

  function purchaseMarkerRejectedReasons(listing = {}) {
    return [...new Set(purchaseMarkerRejectedEvidence(listing)
      .map((item) => item.rejectedReason || item.rejectionReason || item.marker)
      .filter(Boolean))]
      .slice(0, 8);
  }

  function conditionCleanupDebug(listing = {}) {
    const debug = listing.extractedFields?.debug || {};
    const diagnostics = debug.conditionDiagnostics || listing.openlaneMetadata?.conditionDetails?.conditionDiagnostics || {};
    return {
      ignoredNoisyZones: ignoredNoisyZones(listing),
      rejectedConditionLines: (diagnostics.rejectedConditionLines || []).slice(0, 12),
      sectionBoundaryDecisions: (diagnostics.sectionBoundaryDecisions || []).slice(0, 8),
    };
  }

  function rejectedOutcomePriceCandidates(listing = {}, rejectedPriceCandidates = []) {
    const debug = listing.extractedFields?.debug || {};
    const explicit = Array.isArray(debug.rejectedPurchaseOutcomeCandidates) ? debug.rejectedPurchaseOutcomeCandidates : [];
    const fallback = rejectedPriceCandidates.filter((candidate) => /outcome|purchase|transport_estimate|active_current_bid|bid_count/i.test(candidate.rejectionReason || ""));
    return [...explicit, ...fallback]
      .map((candidate) => ({
        field: candidate.field || "soldPriceCandidate",
        value: candidate.value ?? null,
        sourceType: candidate.sourceType || candidate.source || "",
        sourceName: candidate.sourceName || candidate.label || "",
        sourceText: redactSensitiveText(candidate.sourceText || "").slice(0, 300),
        rejectionReason: candidate.rejectedReason || candidate.rejectionReason || "not_purchase_outcome_price",
      }))
      .slice(0, 8);
  }

  function isPurchaseOutcomeContext(listing = {}) {
    return /purchase_detail|post_sale|fee_details|purchase_info/i.test(String(listing.pageType || ""))
      || /candidate_outcome|verified_outcome/i.test(String(listing.captureKind || ""));
  }

  function requiredFieldsForPageType(listing = {}) {
    if (isPurchaseOutcomeContext(listing)) return ["vin", "soldPriceCandidate", "purchaseEvidence"];
    return ["vin"];
  }

  function listedPriceRequirementReason(listing = {}) {
    if (isPurchaseOutcomeContext(listing)) {
      return "listedPrice is not required on purchase/outcome pages; sold/acquisition outcome price is required.";
    }
    return "listedPrice is not required for active listing readiness; current bid is observation-only.";
  }

  function soldPriceParserStatus(listing = {}, priceDiagnostics = buildPriceDiagnostics(listing)) {
    if (!isPurchaseOutcomeContext(listing)) return "not_purchase_context";
    if (listing.soldPriceCandidate || listing.buyPriceAuction || listing.finalBidAmount) return "price_found";
    if ((priceDiagnostics.rejectedOutcomePriceCandidates || []).length) return "rejected_candidates_only";
    return "missing_sold_price";
  }

  function rejectedPriceCandidateLabel(candidate = {}) {
    const value = candidate.value !== null && candidate.value !== undefined ? `${candidate.value}: ` : "";
    return `${value}${candidate.sourceText || candidate.sourceName || candidate.field} (${candidate.rejectionReason || "rejected"})`;
  }

  function transportIgnoredMessage(listing = {}) {
    const safeListing = listing || {};
    const debug = safeListing.extractedFields?.debug || {};
    const rejectedMileage = (debug.mileageCandidates || []).some((candidate) => /transport|distance|rate|delivery|pickup/i.test(candidate.rejectedReason || candidate.sourceText || ""));
    const visibleTransport = /\btransport\b[\s\S]{0,80}\b(CAD|\$|km)\b/i.test(String(safeListing.rawVisibleText || safeListing.openlaneMetadata?.textRegions?.mainTextSample || ""));
    if ((rejectedMileage || visibleTransport) && !safeListing.buyNowPrice && !safeListing.soldPriceCandidate) return "Transport estimate ignored as listing price.";
    return "";
  }

  function purchaseEvidenceSource(listing = {}) {
    const safeListing = listing || {};
    const explicit = safeListing.openlaneMetadata?.purchaseEconomics?.purchaseEvidenceSource
      || safeListing.extractedFields?.debug?.purchaseEvidenceSource;
    if (explicit) return explicit;
    const evidence = safeListing.outcomeEvidence || safeListing.openlaneMetadata?.classification?.evidence || [];
    const first = evidence.find((item) => item.sourceText || item.marker || item.evidenceType) || {};
    if (first.sourceText) return first.sourceText;
    if (first.marker) return first.marker;
    if (first.evidenceType) return first.evidenceType;
    if (safeListing.buyPriceAuction || safeListing.soldPriceCandidate) return "purchase panel";
    return "classification evidence";
  }

  function ignoredNoisyZones(listing = {}) {
    const safeListing = listing || {};
    const summary = safeListing.openlaneMetadata?.sectionMapSummary?.summary || {};
    const fromSummary = Object.entries(summary)
      .filter(([, value]) => value?.ignored && Number(value.textLength || 0) > 0)
      .map(([name]) => name);
    const fromEvidence = (safeListing.openlaneMetadata?.classification?.ignoredEvidence || [])
      .map((item) => item.zone || String(item.marker || "").replace(/_text$/, ""))
      .filter(Boolean);
    return [...new Set([...fromSummary, ...fromEvidence])].slice(0, 8);
  }

  function ignoredNoisyZonesLabel(listing = {}) {
    return ignoredNoisyZones(listing).join(", ") || "-";
  }

  function rejectedFieldCandidateItems(listing = {}) {
    const debug = listing.extractedFields?.debug || {};
    const items = [];
    for (const [field, candidates] of Object.entries({
      vin: debug.vinCandidates || [],
      mileage: debug.mileageCandidates || [],
      title: debug.titleCandidates || [],
      carfax: debug.carfaxCandidates || [],
    })) {
      for (const candidate of candidates || []) {
        const reason = candidate.rejectedReason || candidate.rejectionReason;
        if (reason) items.push(`${field}: ${reason}`);
      }
    }
    for (const item of debug.mediaRejected || []) {
      if (item.reason || item.rejectedReason) items.push(`media: ${item.reason || item.rejectedReason}`);
    }
    return items.slice(0, 12);
  }

  function carfaxStatusLabel(listing) {
    const safeListing = listing || {};
    if (!listing) return "-";
    if (safeListing.carfaxUrlStatus === "url_found") return "url_found";
    if (safeListing.carfaxUrlStatus === "text_only") return "text_only";
    return safeListing.carfaxUrlStatus || "missing";
  }

  function carfaxEvidenceLabel(listing) {
    const safeListing = listing || {};
    const evidence = safeListing.openlaneMetadata?.carfaxEvidence || safeListing.carfax?.evidence || safeListing.extractedFields?.carfaxEvidence || [];
    const first = evidence?.[0];
    if (!first) return "-";
    return [first.source, first.endpointPattern, first.urlStatus].filter(Boolean).join(" / ") || first.text || first.sourceText || "-";
  }

  function readinessSummary(listing = {}) {
    const safeListing = listing || {};
    const readiness = safeListing.openlaneMetadata?.stableCaptureReadiness || {};
    return {
      readyToCapture: Boolean(readiness.readyToCapture),
      state: readiness.state || "",
      blockedReason: readiness.blockedReason || "",
      vinStatus: readiness.vinStatus || vinStatusLabel(safeListing),
      carfaxStatus: readiness.carfaxStatus || carfaxStatusLabel(safeListing),
      missingData: readiness.missingData || safeListing.missingData || [],
    };
  }

  function vinStatusLabel(listing = {}) {
    const safeListing = listing || {};
    if (!safeListing.vin) return "missing";
    return /^[A-HJ-NPR-Z0-9]{17}$/i.test(String(safeListing.vin)) ? "found" : "invalid";
  }

  function vinEvidenceSource(listing, debug = {}) {
    const safeListing = listing || {};
    return debug.vinCandidates?.[0]?.source
      || safeListing.fieldEvidence?.vin?.[0]?.sourceType
      || safeListing.extractedFields?.vinEvidence?.matchedLabel
      || "-";
  }

  function networkObserverLabel(runtime = {}) {
    const observer = runtime.networkObserver || {};
    if (observer.enabled) return "enabled";
    return observer.reason || "disabled";
  }

  function networkEvidenceCount(listing, runtime = {}) {
    const safeListing = listing || {};
    return Number(runtime.networkEvidenceCount ?? runtime.networkObserver?.observationCount ?? safeListing.openlaneMetadata?.networkEvidence?.length ?? 0);
  }

  function carfaxDiagnosticsLabel(listing = {}) {
    const diagnostics = listing.openlaneMetadata?.carfaxDiagnostics || {};
    return [
      `links ${Number(diagnostics.carfaxLinkCandidateCount || 0)}`,
      `data-href ${Number(diagnostics.carfaxDataHrefCandidateCount || 0)}`,
      `data-url ${Number(diagnostics.carfaxDataUrlCandidateCount || 0)}`,
      `html ${Number(diagnostics.carfaxHtmlZoneCandidateCount || 0)}`,
      `safe-attrs ${Number(diagnostics.carfaxSafeAttributeCandidateCount || 0)}`,
      `network ${Number(diagnostics.carfaxNetworkCandidateCount || 0)}`,
      `text-only ${Number(diagnostics.carfaxTextOnlyCandidateCount || 0)}`,
    ].join(", ");
  }

  function networkObserverDiagnosticMessage(listing = {}, runtime = {}) {
    const observer = runtime.networkObserver || {};
    const count = networkEvidenceCount(listing, runtime);
    if (observer.enabled && count === 0) {
      if (Number(observer.deniedEventCount || 0) > 0 && Number(observer.allowedEventCount || 0) === 0) {
        return "Network events observed but denied by allowlist/denylist.";
      }
      if (Number(observer.irrelevantJsonCount || 0) > 0) {
        return "Network JSON observed but no vehicle/carfax/price candidates found.";
      }
      return "Network observer is enabled but no OpenLane vehicle JSON has been observed yet. Reload the VDP or check early hook/endpoint allowlist.";
    }
    return "";
  }

  function networkObserverDiagnosticsLabel(runtime = {}) {
    const observer = runtime.networkObserver || {};
    return [
      `hook:${observer.pageHookInstalled ? "on" : "unknown"}`,
      `early:${observer.earlyHookInstalled ? "on" : "unknown"}`,
      `queue:${Number(observer.earlyQueueLength || 0)}`,
      `events:${Number(observer.pageHookEventCount || 0)}`,
      `allowed:${Number(observer.allowedEventCount || 0)}`,
      `denied:${Number(observer.deniedEventCount || 0)}`,
      `irrelevant:${Number(observer.irrelevantJsonCount || 0)}`,
      `duplicates:${Number(observer.duplicateEventCount || 0)}`,
      `parseErrors:${Number(observer.parseErrorCount || 0)}`,
    ].join(" ");
  }

  function deepCaptureStatusLabel(listing) {
    const safeListing = listing || {};
    const runtime = safeListing.openlaneMetadata?.deepCaptureRuntime || {};
    const mode = safeListing.deepCaptureActivationMode || runtime.deepCaptureActivationMode;
    if (mode === "default_enabled_pending_consent_ui") return "Active by default";
    if (mode === "explicit_consent_active") return "On - active consent";
    if (mode === "disabled_missing_required_settings") return "Disabled - missing settings";
    if (mode === "disabled_by_user") return "Disabled by user";
    if (safeListing.captureLevel === "deep_capture") return "On";
    return "Off";
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
    const safeListing = listing || {};
    const semantics = safeListing.priceSemantics || {};
    if (semantics.finalBidAmount || semantics.acceptedAmount || semantics.buyPriceAuction || semantics.totalInvoiceAmount) return "verified outcome";
    if (semantics.soldPriceCandidate || safeListing.captureKind === "candidate_outcome") return "candidate outcome";
    if (semantics.currentBid || safeListing.captureKind === "observation") return "observation";
    return "unknown";
  }

  function carfaxLabel(listing) {
    const safeListing = listing || {};
    if (!listing) return "Missing";
    if (safeListing.carfaxUrlStatus === "url_found") return "URL found";
    if (safeListing.carfaxUrlStatus === "text_only") return "visible, URL missing";
    if (safeListing.carfaxAvailable) return "Visible";
    return "Missing";
  }

  async function loadWidgetSettings(shadow, settingsOverride = null) {
    const form = shadow.querySelector(".settings-drawer");
    if (!form || !window.DealerFlowMarketSnapStorage) return;
    const settings = settingsOverride || await window.DealerFlowMarketSnapStorage.getSettings();
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
    const shadow = form.getRootNode();
    const submitButton = form.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      for (const field of Array.from(form.querySelectorAll("input[type='checkbox']"))) {
        values[field.name] = field.checked;
      }
      const saved = await window.DealerFlowMarketSnapStorage.saveSettings(values);
      await loadWidgetSettings(shadow, saved);
      callbacks.onSettingsSaved?.(saved, "Settings saved.");
    } catch (error) {
      callbacks.onSettingsError?.(`Settings save failed: ${formatWidgetError(error)}`, error);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  function formatWidgetError(error) {
    return sanitizeWidgetError(error?.message || String(error || "Unknown error"));
  }

  function sanitizeWidgetError(message) {
    return String(message || "Unknown error")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
      .replace(/\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
      .replace(/\b(authorization|cookie|token|secret|credential|session|password|csrf|jwt)\b\s*[:=]\s*[^,\s;]+/gi, "$1=[redacted]")
      .slice(0, 500);
  }

  function runWidgetAction(action, callbacks = {}, fallbackMessage = "Action failed") {
    try {
      const result = action?.();
      if (result && typeof result.then === "function") {
        result.catch((error) => callbacks.onActionError?.(`${fallbackMessage}: ${formatWidgetError(error)}`, error));
      }
    } catch (error) {
      callbacks.onActionError?.(`${fallbackMessage}: ${formatWidgetError(error)}`, error);
    }
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

  function moneyOrDash(value) {
    if (value === undefined || value === null || value === "") return "-";
    return money(value);
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
