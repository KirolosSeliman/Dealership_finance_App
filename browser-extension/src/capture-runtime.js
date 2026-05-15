(function (root) {
  const DEFAULT_TIME_BUCKET_MS = 10 * 60 * 1000;
  const MAX_QUEUE_SIZE = 10;

  function createMarketSnapCaptureRuntime({ api, now = () => Date.now(), timeBucketMs = DEFAULT_TIME_BUCKET_MS } = {}) {
    const state = {
      signaturesByBucket: new Set(),
      queue: [],
      running: false,
      backoffUntil: 0,
      backoffMs: 0,
    };

    async function enqueueCapture(listing, settings = {}, options = {}) {
      if (settings.autoCapture === false) return { skipped: true, reason: "capture-disabled" };
      if (!api?.captureListing) return { skipped: true, reason: "capture-api-unavailable" };
      if (now() < state.backoffUntil && !options.force) return { skipped: true, reason: "backoff-active" };

      const signature = captureSignature(listing);
      const bucketedSignature = `${timeBucket(now(), timeBucketMs)}:${signature}`;
      if (!options.force && state.signaturesByBucket.has(bucketedSignature)) {
        return { skipped: true, reason: "duplicate-signature", signature };
      }

      state.signaturesByBucket.add(bucketedSignature);
      state.queue.push({ listing: prepareListing(listing, settings), settings, signature });
      if (state.queue.length > MAX_QUEUE_SIZE) state.queue.splice(0, state.queue.length - MAX_QUEUE_SIZE);
      await drainQueue();
      return { skipped: false, signature };
    }

    async function drainQueue() {
      if (state.running) return;
      state.running = true;
      try {
        while (state.queue.length) {
          const item = state.queue.shift();
          try {
            await api.captureListing(item.settings, item.listing);
            state.backoffMs = 0;
            state.backoffUntil = 0;
          } catch (error) {
            state.queue.unshift(item);
            state.backoffMs = state.backoffMs ? Math.min(state.backoffMs * 2, 60_000) : 5_000;
            state.backoffUntil = now() + state.backoffMs;
            throw error;
          }
        }
      } finally {
        state.running = false;
      }
    }

    return { enqueueCapture, captureSignature, pendingCount: () => state.queue.length };
  }

  function captureSignature(listing = {}) {
    const metadata = listing.openlaneMetadata || {};
    return [
      listing.vin || "",
      listing.listingUrl || "",
      listing.pageType || "",
      listing.captureKind || "",
      listing.currentBid ?? "",
      listing.currentOffer ?? "",
      listing.bestOffer ?? "",
      listing.buyNowPrice ?? "",
      listing.auctionStatus || listing.negotiationStatus || "",
      listing.soldPriceCandidate ?? "",
      listing.acceptedAmount ?? "",
      listing.negotiatedAmount ?? "",
      listing.buyPriceAuction ?? "",
      listing.totalInvoiceAmount ?? "",
      listing.finalAcquisitionCost ?? "",
      listing.imageCount ?? "",
      metadata.disclosureCount ?? "",
      metadata.bidCount ?? "",
      metadata.offerCount ?? "",
    ].join("|");
  }

  function prepareListing(listing, settings) {
    return {
      ...listing,
      openlaneMetadata: {
        ...(listing.openlaneMetadata || {}),
        modelImprovementOptIn: Boolean(settings.modelImprovementOptIn),
        captureQueuedAt: new Date().toISOString(),
      },
    };
  }

  function timeBucket(value, bucketMs) {
    return Math.floor(value / bucketMs);
  }

  const api = { createMarketSnapCaptureRuntime, captureSignature };
  root.DealerFlowMarketSnapCaptureRuntime = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
