(function (root) {
  const BID_ZONE_SELECTOR = [
    "[class*='bid' i]",
    "[class*='offer' i]",
    "[class*='auction-panel' i]",
    "[class*='active-bid' i]",
    "[class*='sticky-bid' i]",
    "[class*='current-bid' i]",
    "[class*='proxy' i]",
    "[data-testid*='bid' i]",
    "[data-testid*='offer' i]",
    "[data-testid*='current-bid' i]",
    "[aria-label*='bid' i]",
    "[title*='bid' i]",
  ].join(",");
  const DEFAULT_FAST_INTERVAL_MS = 350;
  const DEFAULT_MEDIUM_INTERVAL_MS = 1500;
  const DEFAULT_SLOW_INTERVAL_MS = 5000;
  const DEFAULT_MAX_DURATION_MS = 120000;

  function createOpenLaneBidStateController(options = {}) {
    const doc = options.doc || root.document;
    const href = String(options.href || root.location?.href || "");
    const getHref = typeof options.getHref === "function" ? options.getHref : () => root.location?.href || href;
    const getListing = typeof options.getListing === "function" ? options.getListing : () => ({});
    const onBidStateChange = typeof options.onBidStateChange === "function"
      ? options.onBidStateChange
      : typeof options.onBidUpdate === "function"
        ? options.onBidUpdate
        : () => undefined;
    const onDiagnostics = typeof options.onDiagnostics === "function" ? options.onDiagnostics : () => undefined;
    const extractBidState = typeof options.extractBidState === "function"
      ? options.extractBidState
      : typeof options.extractBidOnly === "function"
        ? options.extractBidOnly
        : defaultExtractBidOnly;
    const MutationObserverCtor = options.MutationObserverCtor || root.MutationObserver;
    const setIntervalFn = options.setIntervalFn || root.setInterval?.bind(root) || setInterval;
    const clearIntervalFn = options.clearIntervalFn || root.clearInterval?.bind(root) || clearInterval;
    const setTimeoutFn = options.setTimeoutFn || root.setTimeout?.bind(root) || setTimeout;
    const clearTimeoutFn = options.clearTimeoutFn || root.clearTimeout?.bind(root) || clearTimeout;
    const maxDurationMs = Math.min(DEFAULT_MAX_DURATION_MS, Math.max(1000, Number(options.maxDurationMs || DEFAULT_MAX_DURATION_MS)));
    const bidNodes = bidZoneNodes(doc);
    const initialListing = getListing() || {};
    const status = {
      active: false,
      href,
      observedNodeCount: bidNodes.length,
      updateCount: 0,
      lastCurrentBid: Number(initialListing.currentBid || initialListing.listedPrice || 0) || undefined,
      lastCheckedAt: "",
      lastTriggerReason: "",
      stoppedReason: "",
      intervalMs: 0,
      intervalChangeCount: 0,
    };

    if (!isActiveAuctionListing(initialListing)) {
      status.stoppedReason = "not_active_auction_listing";
      return inertController(status);
    }
    if (!bidNodes.length || !MutationObserverCtor) {
      status.stoppedReason = bidNodes.length ? "mutation_observer_unavailable" : "no_bid_nodes";
      return inertController(status);
    }

    let stopped = false;
    let intervalId = null;
    let maxTimerId = null;
    const observer = new MutationObserverCtor(() => runBidCheck("mutation"));
    for (const node of bidNodes.slice(0, 40)) {
      observer.observe(node, { childList: true, subtree: true, characterData: true });
    }
    scheduleInterval("start");
    maxTimerId = setTimeoutFn(() => stop("max_duration_reached"), maxDurationMs);
    status.active = true;

    function runBidCheck(reason = "manual") {
      if (stopped) return;
      if (String(getHref()) !== href) {
        stop("route_changed");
        return;
      }
      if (doc.visibilityState === "hidden") {
        stop("page_hidden");
        return;
      }
      if (typeof options.isWidgetConnected === "function" && !options.isWidgetConnected()) {
        stop("widget_removed");
        return;
      }
      const listing = getListing() || {};
      if (!isActiveAuctionListing(listing)) {
        stop("auction_not_active");
        return;
      }
      scheduleInterval(reason);
      const bidResult = extractBidState(doc, href, { bidOnly: true, source: reason }) || {};
      const nextBid = Number(bidResult.currentBid || 0) || undefined;
      status.lastCheckedAt = new Date().toISOString();
      status.lastTriggerReason = reason;
      if (!nextBid || nextBid === status.lastCurrentBid) {
        onDiagnostics({ ...status, reason, rejectedCandidates: bidResult.candidates || [] });
        return;
      }
      const previousBid = status.lastCurrentBid;
      status.lastCurrentBid = nextBid;
      status.updateCount += 1;
      const nextListing = mergeBidIntoListing(listing, bidResult, href);
      onBidStateChange(nextListing, {
        reason,
        previousBid,
        currentBid: nextBid,
        href,
        updateCount: status.updateCount,
      });
    }

    function scheduleInterval(reason = "schedule") {
      const nextInterval = intervalMsFor(doc, options);
      if (intervalId !== null && nextInterval === status.intervalMs) return;
      if (intervalId !== null) clearIntervalFn(intervalId);
      status.intervalMs = nextInterval;
      status.intervalChangeCount += 1;
      intervalId = setIntervalFn(() => runBidCheck("interval"), status.intervalMs);
      onDiagnostics({ ...status, reason, scheduledIntervalMs: nextInterval });
    }

    function stop(reason = "stopped") {
      if (stopped) return;
      stopped = true;
      status.active = false;
      status.stoppedReason = reason;
      try {
        observer.disconnect?.();
      } catch {
        // Passive monitor cleanup only.
      }
      if (intervalId !== null) clearIntervalFn(intervalId);
      if (maxTimerId !== null) clearTimeoutFn(maxTimerId);
    }

    return {
      trigger: runBidCheck,
      stop,
      getStatus: () => ({ ...status }),
    };
  }

  function startOpenLaneBidLiveMonitor(options = {}) {
    return createOpenLaneBidStateController({
      ...options,
      onBidStateChange: options.onBidStateChange || options.onBidUpdate,
      extractBidState: options.extractBidState || options.extractBidOnly,
    });
  }

  function stopOpenLaneBidLiveMonitor(controller, reason = "stopped") {
    controller?.stop?.(reason);
  }

  function defaultExtractBidOnly(doc, href, options) {
    return root.DealerFlowOpenLaneExtractor?.extractOpenLaneCurrentBidOnly?.(doc, href, options) || {};
  }

  function bidZoneNodes(doc = root.document) {
    try {
      return Array.from(doc.querySelectorAll?.(BID_ZONE_SELECTOR) || []).slice(0, 40);
    } catch {
      return [];
    }
  }

  function intervalMsFor(doc, options = {}) {
    const text = bidZoneNodes(doc).map((node) => `${node.innerText || ""} ${node.textContent || ""}`).join("\n");
    if (/\b(under\s+[123]\s+min|[0-2]\s*min|\d{1,2}\s*seconds?\s*(?:remaining|left)?|seconds?\s+remaining)\b/i.test(text)) {
      return Math.max(250, Math.min(500, Number(options.fastIntervalMs || DEFAULT_FAST_INTERVAL_MS)));
    }
    if (/\b(under\s+10\s+min|[3-9]\s*min)\b/i.test(text)) {
      return Math.max(1000, Math.min(2000, Number(options.mediumIntervalMs || DEFAULT_MEDIUM_INTERVAL_MS)));
    }
    return Math.max(2000, Math.min(10000, Number(options.slowIntervalMs || DEFAULT_SLOW_INTERVAL_MS)));
  }

  function isActiveAuctionListing(listing = {}) {
    const pageType = String(listing.pageType || "");
    const captureKind = String(listing.captureKind || "");
    if (pageType && pageType !== "active_listing") return false;
    if (captureKind && captureKind !== "observation") return false;
    if (listing.soldPriceCandidate || listing.buyPriceAuction || listing.finalBidAmount) return false;
    return true;
  }

  function mergeBidIntoListing(listing = {}, bidResult = {}, href = "") {
    const currentBid = Number(bidResult.currentBid || 0) || undefined;
    if (!currentBid) return listing;
    const evidence = bidResult.evidence ? { ...bidResult.evidence, capturedAt: bidResult.evidence.capturedAt || new Date().toISOString() } : undefined;
    const next = {
      ...listing,
      listingUrl: listing.listingUrl || href,
      currentBid,
      listedPrice: currentBid,
      currentOffer: bidResult.currentOffer ?? listing.currentOffer,
      bestOffer: bidResult.bestOffer ?? listing.bestOffer,
      priceSemantics: {
        ...(listing.priceSemantics || {}),
        currentBid: "observation",
        listedPrice: "observation_alias_current_bid",
      },
      fieldEvidence: {
        ...(listing.fieldEvidence || {}),
        currentBid: evidence ? [evidence] : listing.fieldEvidence?.currentBid,
      },
      extractedFields: {
        ...(listing.extractedFields || {}),
        currentBidEvidence: evidence || listing.extractedFields?.currentBidEvidence,
        debug: {
          ...(listing.extractedFields?.debug || {}),
          priceCandidates: bidResult.candidates || listing.extractedFields?.debug?.priceCandidates,
          lowerBidCandidates: bidResult.lowerBidCandidates || listing.extractedFields?.debug?.lowerBidCandidates,
          staleCurrentBidCandidates: bidResult.staleCurrentBidCandidates || listing.extractedFields?.debug?.staleCurrentBidCandidates,
          currentBidDiagnostics: bidResult.diagnostics || listing.extractedFields?.debug?.currentBidDiagnostics,
        },
      },
      openlaneMetadata: {
        ...(listing.openlaneMetadata || {}),
        bidLiveMonitor: {
          updatedAt: new Date().toISOString(),
          currentBid,
          currentOffer: bidResult.currentOffer ?? listing.currentOffer,
          bestOffer: bidResult.bestOffer ?? listing.bestOffer,
          bidCount: bidResult.bidCount ?? listing.openlaneMetadata?.bidLiveMonitor?.bidCount,
          timeRemaining: bidResult.timeRemaining || listing.openlaneMetadata?.bidLiveMonitor?.timeRemaining,
          highestProxy: bidResult.highestProxy ?? listing.openlaneMetadata?.bidLiveMonitor?.highestProxy,
          source: evidence?.sourceName || evidence?.sourceType || "bid_only_monitor",
        },
      },
    };
    const contract = root.DealerFlowOpenLaneExtractionContract;
    if (!contract?.normalizeOpenLaneCanonicalState || !contract?.canonicalToLegacyPayload) return next;
    const canonical = contract.normalizeOpenLaneCanonicalState(next);
    canonical.activeAuction = {
      ...(canonical.activeAuction || {}),
      currentBid,
      currentOffer: bidResult.currentOffer ?? canonical.activeAuction?.currentOffer,
      bestOffer: bidResult.bestOffer ?? canonical.activeAuction?.bestOffer,
      evidence: evidence ? [evidence] : canonical.activeAuction?.evidence,
      rejectedCandidates: bidResult.candidates?.filter((candidate) => candidate?.rejectedReason || candidate?.rejectionReason) || canonical.activeAuction?.rejectedCandidates,
      staleCandidates: bidResult.staleCurrentBidCandidates || canonical.activeAuction?.staleCandidates,
    };
    next.openlaneCanonicalState = canonical;
    return contract.canonicalToLegacyPayload(canonical, next);
  }

  function inertController(status) {
    return {
      trigger: () => undefined,
      stop: (reason = "stopped") => {
        status.active = false;
        status.stoppedReason = reason;
      },
      getStatus: () => ({ ...status }),
    };
  }

  const api = {
    createOpenLaneBidStateController,
    startOpenLaneBidLiveMonitor,
    stopOpenLaneBidLiveMonitor,
    mergeBidIntoListing,
  };
  root.DealerFlowOpenLaneBidLiveMonitor = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
