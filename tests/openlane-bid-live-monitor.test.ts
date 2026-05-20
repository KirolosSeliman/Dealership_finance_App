import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
require("../browser-extension/src/openlane-extraction-contract.js");
require("../browser-extension/src/openlane-section-map.js");
require("../browser-extension/src/openlane-page-classifier.js");
require("../browser-extension/src/openlane-extractor.js");

const monitorApi = require("../browser-extension/src/openlane-bid-live-monitor.js") as {
  createOpenLaneBidStateController: (options: Record<string, unknown>) => {
    trigger: (reason?: string) => void;
    stop: (reason?: string) => void;
    getStatus: () => Record<string, unknown>;
  };
  startOpenLaneBidLiveMonitor: (options: Record<string, unknown>) => {
    trigger: (reason?: string) => void;
    stop: (reason?: string) => void;
    getStatus: () => Record<string, unknown>;
  };
  mergeBidIntoListing: (listing: Record<string, unknown>, bidResult: Record<string, unknown>, href?: string) => Record<string, unknown>;
};

test("OpenLane bid state controller exports the production controller API", () => {
  assert.equal(typeof monitorApi.createOpenLaneBidStateController, "function");
});

test("OpenLane bid live monitor updates current bid from mutation without full extraction", () => {
  const intervals: Array<{ callback: () => void; ms: number; cleared?: boolean }> = [];
  const timeouts: Array<{ callback: () => void; ms: number; cleared?: boolean }> = [];
  const observers: FakeMutationObserver[] = [];
  const doc = fakeBidDocument("Current bid $13,800 Under 1 min 71 Bids");
  let bidOnlyCalls = 0;
  let fullExtractionCalls = 0;
  const updates: Array<Record<string, unknown>> = [];

  const controller = monitorApi.startOpenLaneBidLiveMonitor({
    doc,
    href: "https://app.openlane.ca/vdp/1N6ED1EK0PN123456",
    getHref: () => "https://app.openlane.ca/vdp/1N6ED1EK0PN123456",
    getListing: () => ({
      sourceName: "OpenLane",
      pageType: "active_listing",
      captureKind: "observation",
      currentBid: 13_800,
      listedPrice: 13_800,
      priceSemantics: { currentBid: "observation", listedPrice: "observation_alias_current_bid" },
    }),
    onBidUpdate: (listing: Record<string, unknown>, metadata: Record<string, unknown>) => updates.push({ listing, metadata }),
    extractBidOnly: () => {
      bidOnlyCalls += 1;
      return {
        currentBid: doc.bid,
        evidence: { field: "currentBid", value: doc.bid, normalizedValue: doc.bid, sourceText: doc.text, sourceType: "section_map", sourceName: "section-map:bidPanel" },
        candidates: [{ field: "currentBid", value: doc.bid, sourceText: doc.text, selectionScore: 130 }],
        staleCurrentBidCandidates: [{ field: "currentBid", value: 13_800, sourceType: "active_bid_bar", rejectedReason: "stale_current_bid_candidate" }],
        lowerBidCandidates: [],
        diagnostics: { winningCurrentBid: doc.bid, winningSourceText: doc.text },
      };
    },
    extractFullListing: () => {
      fullExtractionCalls += 1;
      return {};
    },
    MutationObserverCtor: class extends FakeMutationObserver {
      constructor(callback: () => void) {
        super(callback);
        observers.push(this);
      }
    },
    setIntervalFn: (callback: () => void, ms: number) => {
      intervals.push({ callback, ms });
      return intervals.length;
    },
    clearIntervalFn: (id: number) => {
      if (intervals[id - 1]) intervals[id - 1].cleared = true;
    },
    setTimeoutFn: (callback: () => void, ms: number) => {
      timeouts.push({ callback, ms });
      return timeouts.length;
    },
    clearTimeoutFn: (id: number) => {
      if (timeouts[id - 1]) timeouts[id - 1].cleared = true;
    },
    fastIntervalMs: 350,
    slowIntervalMs: 5000,
    maxDurationMs: 60_000,
  });

  assert.equal(intervals[0]?.ms, 350);
  assert.equal(timeouts[0]?.ms, 60_000);
  assert.equal(observers.length, 1);

  doc.setBid(14_200, "Current bid $14,200 Under 1 min 71 Bids");
  observers[0].trigger();

  assert.equal(bidOnlyCalls, 1);
  assert.equal(fullExtractionCalls, 0);
  assert.equal((updates[0].listing as Record<string, unknown>).currentBid, 14_200);
  assert.equal((updates[0].listing as Record<string, unknown>).listedPrice, 14_200);
  assert.deepEqual((updates[0].listing as Record<string, unknown>).priceSemantics, { currentBid: "observation", listedPrice: "observation_alias_current_bid" });
  assert.equal((updates[0].metadata as Record<string, unknown>).previousBid, 13_800);
  assert.equal((updates[0].metadata as Record<string, unknown>).currentBid, 14_200);
  assert.equal(controller.getStatus().updateCount, 1);

  controller.stop("test_complete");
  assert.equal(observers[0].disconnected, true);
  assert.equal(intervals[0].cleared, true);
});

test("OpenLane bid state controller recomputes interval as countdown enters final minutes", () => {
  const intervals: Array<{ callback: () => void; ms: number; cleared?: boolean }> = [];
  const doc = fakeBidDocument("Current bid $13,800 12 min 71 Bids");
  const controller = monitorApi.createOpenLaneBidStateController({
    doc,
    href: "https://app.openlane.ca/vdp/1N6ED1EK0PN123456",
    getHref: () => "https://app.openlane.ca/vdp/1N6ED1EK0PN123456",
    getListing: () => ({ pageType: "active_listing", captureKind: "observation", currentBid: 13_800 }),
    onBidStateChange: () => undefined,
    extractBidState: () => ({ currentBid: doc.bid, evidence: { sourceText: doc.text } }),
    MutationObserverCtor: FakeMutationObserver,
    setIntervalFn: (callback: () => void, ms: number) => {
      intervals.push({ callback, ms });
      return intervals.length;
    },
    clearIntervalFn: (id: number) => {
      if (intervals[id - 1]) intervals[id - 1].cleared = true;
    },
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => undefined,
    fastIntervalMs: 300,
    mediumIntervalMs: 1500,
    slowIntervalMs: 6000,
  });

  assert.equal(intervals[0]?.ms, 6000);
  doc.setBid(13_800, "Current bid $13,800 8 min 71 Bids");
  controller.trigger("countdown");
  assert.equal(intervals[0].cleared, true);
  assert.equal(intervals[1]?.ms, 1500);

  doc.setBid(14_200, "Current bid $14,200 Under 1 min 71 Bids");
  controller.trigger("countdown");
  assert.equal(intervals[1].cleared, true);
  assert.equal(intervals[2]?.ms, 300);
  assert.equal(controller.getStatus().intervalMs, 300);

  controller.stop("test_complete");
});

test("OpenLane bid state controller is bid-only and rejects bid-count-only changes", () => {
  let backendCalls = 0;
  let fullExtractionCalls = 0;
  let updates = 0;
  const doc = fakeBidDocument("Current bid 71 Bids Under 1 min");

  const controller = monitorApi.createOpenLaneBidStateController({
    doc,
    href: "https://app.openlane.ca/vdp/1N6ED1EK0PN123456",
    getHref: () => "https://app.openlane.ca/vdp/1N6ED1EK0PN123456",
    getListing: () => ({ pageType: "active_listing", captureKind: "observation", currentBid: 13_800 }),
    onBidStateChange: () => { updates += 1; },
    onBackendWrite: () => { backendCalls += 1; },
    extractFullListing: () => {
      fullExtractionCalls += 1;
      return {};
    },
    extractBidState: () => ({
      currentBid: undefined,
      candidates: [{ field: "currentBid", value: 71, sourceText: "71 Bids", rejectedReason: "bid_count_not_money" }],
    }),
    MutationObserverCtor: FakeMutationObserver,
    setIntervalFn: () => 1,
    clearIntervalFn: () => undefined,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => undefined,
  });

  controller.trigger("mutation");

  assert.equal(updates, 0);
  assert.equal(backendCalls, 0);
  assert.equal(fullExtractionCalls, 0);
  assert.equal(controller.getStatus().lastCurrentBid, 13_800);
  controller.stop("test_complete");
});

test("OpenLane bid state controller stops when listing becomes purchase outcome", () => {
  const doc = fakeBidDocument("Current bid $13,800 Under 1 min 71 Bids");
  let listing: Record<string, unknown> = { pageType: "active_listing", captureKind: "observation", currentBid: 13_800 };
  const controller = monitorApi.createOpenLaneBidStateController({
    doc,
    href: "https://app.openlane.ca/vdp/1N6ED1EK0PN123456",
    getHref: () => "https://app.openlane.ca/vdp/1N6ED1EK0PN123456",
    getListing: () => listing,
    onBidStateChange: () => undefined,
    extractBidState: () => ({ currentBid: 14_200, evidence: { sourceText: "Current bid $14,200" } }),
    MutationObserverCtor: FakeMutationObserver,
    setIntervalFn: () => 1,
    clearIntervalFn: () => undefined,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => undefined,
  });

  listing = { pageType: "purchase_detail", captureKind: "candidate_outcome", soldPriceCandidate: 4_000 };
  controller.trigger("mutation");

  assert.equal(controller.getStatus().active, false);
  assert.equal(controller.getStatus().stoppedReason, "auction_not_active");
});

test("OpenLane bid state controller merges bid updates into canonical state", () => {
  const listing = monitorApi.mergeBidIntoListing({
    pageType: "active_listing",
    captureKind: "observation",
    currentBid: 13_800,
    openlaneCanonicalState: {
      activeAuction: { currentBid: 13_800 },
      readiness: { ready: true, missingData: [] },
    },
  }, {
    currentBid: 14_200,
    currentOffer: 14_000,
    bestOffer: 14_100,
    bidCount: 71,
    timeRemaining: "Under 1 min",
    evidence: { field: "currentBid", sourceType: "section_map", sourceText: "Current bid $14,200 Under 1 min" },
  }, "https://app.openlane.ca/vdp/1N6ED1EK0PN123456");

  assert.equal(listing.currentBid, 14_200);
  assert.equal(listing.currentOffer, 14_000);
  assert.equal(listing.bestOffer, 14_100);
  assert.equal(listing.openlaneCanonicalState.activeAuction.currentBid, 14_200);
  assert.equal(listing.openlaneMetadata.bidLiveMonitor.bidCount, 71);
  assert.equal(listing.openlaneMetadata.bidLiveMonitor.timeRemaining, "Under 1 min");
});

test("OpenLane bid live monitor stops on route change and max duration", () => {
  const intervals: Array<{ callback: () => void; ms: number; cleared?: boolean }> = [];
  const timeouts: Array<{ callback: () => void; ms: number; cleared?: boolean }> = [];
  const doc = fakeBidDocument("Current bid $13,800 12 min 71 Bids");
  let href = "https://app.openlane.ca/vdp/1N6ED1EK0PN123456";
  let updateCount = 0;

  const controller = monitorApi.startOpenLaneBidLiveMonitor({
    doc,
    href,
    getHref: () => href,
    getListing: () => ({ pageType: "active_listing", captureKind: "observation", currentBid: 13_800 }),
    onBidUpdate: () => { updateCount += 1; },
    extractBidOnly: () => ({ currentBid: 14_200, evidence: { sourceText: "Current bid $14,200" } }),
    MutationObserverCtor: FakeMutationObserver,
    setIntervalFn: (callback: () => void, ms: number) => {
      intervals.push({ callback, ms });
      return intervals.length;
    },
    clearIntervalFn: (id: number) => {
      if (intervals[id - 1]) intervals[id - 1].cleared = true;
    },
    setTimeoutFn: (callback: () => void, ms: number) => {
      timeouts.push({ callback, ms });
      return timeouts.length;
    },
    clearTimeoutFn: (id: number) => {
      if (timeouts[id - 1]) timeouts[id - 1].cleared = true;
    },
    slowIntervalMs: 5000,
    maxDurationMs: 60_000,
  });

  assert.equal(intervals[0]?.ms, 5000);
  href = "https://app.openlane.ca/vdp/ROUTECHANGED12345";
  intervals[0].callback();

  assert.equal(updateCount, 0);
  assert.equal(controller.getStatus().active, false);
  assert.equal(controller.getStatus().stoppedReason, "route_changed");

  const maxDurationController = monitorApi.startOpenLaneBidLiveMonitor({
    doc,
    href,
    getHref: () => href,
    getListing: () => ({ pageType: "active_listing", captureKind: "observation", currentBid: 13_800 }),
    onBidUpdate: () => { updateCount += 1; },
    extractBidOnly: () => ({ currentBid: 14_200, evidence: { sourceText: "Current bid $14,200" } }),
    MutationObserverCtor: FakeMutationObserver,
    setIntervalFn: (callback: () => void, ms: number) => {
      intervals.push({ callback, ms });
      return intervals.length;
    },
    clearIntervalFn: (id: number) => {
      if (intervals[id - 1]) intervals[id - 1].cleared = true;
    },
    setTimeoutFn: (callback: () => void, ms: number) => {
      timeouts.push({ callback, ms });
      return timeouts.length;
    },
    clearTimeoutFn: (id: number) => {
      if (timeouts[id - 1]) timeouts[id - 1].cleared = true;
    },
    maxDurationMs: 60_000,
  });
  timeouts[1].callback();

  assert.equal(maxDurationController.getStatus().active, false);
  assert.equal(maxDurationController.getStatus().stoppedReason, "max_duration_reached");
});

class FakeMutationObserver {
  callback: () => void;
  observed: unknown[] = [];
  disconnected = false;

  constructor(callback: () => void) {
    this.callback = callback;
  }

  observe(node: unknown) {
    this.observed.push(node);
  }

  disconnect() {
    this.disconnected = true;
  }

  trigger() {
    this.callback();
  }
}

function fakeBidDocument(initialText: string) {
  return {
    bid: 13_800,
    text: initialText,
    body: { innerText: initialText, textContent: initialText },
    querySelectorAll() {
      return [{
        innerText: this.text,
        textContent: this.text,
        getAttribute: () => null,
      }];
    },
    setBid(value: number, text: string) {
      this.bid = value;
      this.text = text;
      this.body.innerText = text;
      this.body.textContent = text;
    },
  };
}
