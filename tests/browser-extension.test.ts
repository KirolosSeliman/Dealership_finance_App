import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
require("../browser-extension/src/deep-capture-activation.js");
require("../browser-extension/src/openlane-section-map.js");
require("../browser-extension/src/openlane-page-classifier.js");
const networkObserver = require("../browser-extension/src/openlane-network-observer.js") as {
  extractCandidatesFromNetworkPayload: (payload: unknown, url?: string) => { vinCandidates: Array<{ vin: string }>; mediaCandidates: Array<{ url: string }>; conditionCandidates: Array<{ text: string }>; sanitizedKeys: string[] };
  sanitizeNetworkPayload: (payload: unknown) => unknown;
  rememberNetworkPayload: (body: unknown, url?: string, contentType?: string) => unknown;
  startOpenLaneNetworkObserver: (settings?: Record<string, unknown>, context?: Record<string, unknown>) => { enabled: boolean; reason: string; observationCount: number };
  stopOpenLaneNetworkObserver: () => void;
  getOpenLaneNetworkObserverStatus: () => { enabled: boolean; reason: string; observationCount: number };
  mergeNetworkEvidenceIntoListing: (listing: Record<string, unknown>, evidence: unknown[]) => Record<string, unknown>;
};
const safeExpander = require("../browser-extension/src/openlane-safe-expander.js") as {
  expandOpenLaneReadOnlySections: (doc: { querySelectorAll: (selector: string) => unknown[] }, options?: { maxSteps?: number; waitMs?: number }) => Promise<{ clicked: Array<{ label: string }>; skipped: Array<{ reason: string; label: string }>; snapshots: Array<{ text: string }> }>;
  classifyExpansionControl: (control: unknown) => { safe: boolean; reason: string; label: string };
};
const openLaneExtractor = require("../browser-extension/src/openlane-extractor.js") as {
  extractOpenLaneFixture: (html: string, href?: string) => Record<string, unknown>;
  extractVisibleText: (doc: { body?: { innerText?: string; textContent?: string } }) => string;
};
const { extractOpenLaneFixture } = openLaneExtractor;

test("Market Snap extension injects on OpenLane Canada vehicle pages", () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "browser-extension/manifest.json"), "utf8"));
  const matches = manifest.content_scripts.flatMap((script: { matches: string[] }) => script.matches);
  const scripts = manifest.content_scripts.flatMap((script: { js: string[] }) => script.js);
  const css = manifest.content_scripts.flatMap((script: { css?: string[] }) => script.css ?? []);
  const earlyHookScript = manifest.content_scripts.find((script: { run_at?: string; js: string[] }) => script.run_at === "document_start" && script.js.includes("src/openlane-network-early-hook.js"));
  const mainScript = manifest.content_scripts.find((script: { js: string[] }) => script.js.includes("src/content-script.js"));

  assert.ok(matches.includes("https://*.openlane.ca/*"));
  assert.ok(matches.includes("https://*.openlane.com/*"));
  assert.ok(earlyHookScript);
  assert.deepEqual(earlyHookScript.matches, ["https://*.openlane.com/*", "https://*.openlane.ca/*"]);
  assert.deepEqual(earlyHookScript.js, ["src/openlane-network-early-hook.js"]);
  assert.equal(mainScript.run_at, "document_idle");
  assert.ok(scripts.includes("src/deep-capture-activation.js"));
  assert.ok(scripts.includes("src/storage.js"));
  assert.ok(scripts.includes("src/api-client.js"));
  assert.ok(scripts.includes("src/openlane-extraction-contract.js"));
  assert.ok(scripts.includes("src/openlane-section-map.js"));
  assert.ok(scripts.includes("src/openlane-page-classifier.js"));
  assert.ok(scripts.includes("src/openlane-network-observer.js"));
  assert.ok(scripts.includes("src/openlane-safe-expander.js"));
  assert.ok(scripts.includes("src/openlane-extractor.js"));
  assert.ok(scripts.includes("src/openlane-stable-capture.js"));
  assert.ok(scripts.includes("src/openlane-bid-live-monitor.js"));
  assert.ok(scripts.includes("src/market-snap-widget.js"));
  assert.ok(scripts.includes("src/copy-payload.js"));
  assert.ok(scripts.includes("src/content-script.js"));
  assert.ok(scripts.indexOf("src/deep-capture-activation.js") < scripts.indexOf("src/storage.js"));
  assert.ok(scripts.indexOf("src/openlane-stable-capture.js") < scripts.indexOf("src/content-script.js"));
  assert.ok(scripts.indexOf("src/openlane-bid-live-monitor.js") < scripts.indexOf("src/content-script.js"));
  assert.ok(scripts.indexOf("src/copy-payload.js") < scripts.indexOf("src/content-script.js"));
  assert.ok(css.includes("styles/widget.css"));
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("webRequest"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);
});

test("OpenLane bid live monitor is bid-only, bounded, and has no backend side effects", () => {
  const monitor = readFileSync(join(repoRoot, "browser-extension/src/openlane-bid-live-monitor.js"), "utf8");
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");

  assert.match(monitor, /startOpenLaneBidLiveMonitor/);
  assert.match(monitor, /createOpenLaneBidStateController/);
  assert.match(monitor, /BID_ZONE_SELECTOR/);
  assert.match(monitor, /maxDurationMs/);
  assert.match(monitor, /mediumIntervalMs/);
  assert.match(monitor, /scheduleInterval/);
  assert.match(monitor, /route_changed/);
  assert.match(monitor, /extractOpenLaneCurrentBidOnly/);
  assert.doesNotMatch(monitor, /analyzeListing|saveListing|enqueueCapture|expandOpenLaneReadOnlySections|fetch\s*\(|XMLHttpRequest/i);
  assert.match(contentScript, /syncBidLiveMonitor\(listing\)/);
  assert.match(contentScript, /createOpenLaneBidStateController/);
  assert.match(contentScript, /extractBidState/);
  assert.match(contentScript, /stopBidLiveMonitor\("route_changed"\)/);
  assert.match(contentScript, /stopBidLiveMonitor\("page_unload"\)/);
  assert.match(contentScript, /Current bid updated from/);
});

test("OpenLane early network hook is injection-only and keeps extraction in the main observer", () => {
  const earlyHook = readFileSync(join(repoRoot, "browser-extension/src/openlane-network-early-hook.js"), "utf8");
  const pageHook = readFileSync(join(repoRoot, "browser-extension/src/openlane-network-page-hook.js"), "utf8");
  const observer = readFileSync(join(repoRoot, "browser-extension/src/openlane-network-observer.js"), "utf8");

  assert.match(earlyHook, /document\.createElement\("script"\)/);
  assert.match(earlyHook, /openlane-network-page-hook\.js/);
  assert.doesNotMatch(earlyHook, /DealerFlowMarketSnapApi|chrome\.storage|fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|document\.body|querySelector/i);
  assert.match(pageHook, /MAX_QUEUE_LENGTH/);
  assert.match(pageHook, /dealer-flow-openlane-network-control/);
  assert.match(pageHook, /endpointDecision/);
  assert.match(pageHook, /endpoint_denied/);
  assert.match(observer, /flushEarlyPageHookQueue/);
  assert.doesNotMatch(pageHook, /requestHeaders|getRequestHeader|setRequestHeader|credentials|authorization\s*:|DealerFlowMarketSnapApi|chrome\.storage|saveListing|analyzeListing/i);
});

test("Market Snap extension uses in-page OpenLane widget instead of popup-only analysis", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const stableCapture = readFileSync(join(repoRoot, "browser-extension/src/openlane-stable-capture.js"), "utf8");
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");

  assert.match(contentScript, /__dealerFlowMarketSnapRuntime/);
  assert.match(contentScript, /extractStableOpenLaneListing/);
  assert.match(contentScript, /readyToCapture/);
  assert.match(contentScript, /MutationObserver/);
  assert.match(contentScript, /pushState/);
  assert.match(contentScript, /replaceState/);
  assert.match(contentScript, /disconnected/);
  assert.match(stableCapture, /expandOpenLaneReadOnlySections/);
  assert.match(stableCapture, /DealerFlowOpenLaneSafeExpander/);
  assert.match(contentScript, /DealerFlowOpenLaneNetworkObserver/);
  assert.match(contentScript, /createMarketSnapWidget/);
  assert.match(contentScript, /MARKET_SNAP_ANALYZE/);
  assert.match(widget, /dealer-flow-market-snap-widget/);
  assert.match(widget, /Wholesale sell/);
  assert.match(widget, /Max bid/);
  assert.match(widget, /data-action="settings"/);
  assert.match(widget, /showDisconnected/);
  assert.match(widget, /showValuation/);
  assert.match(widget, /destroy/);
  assert.match(widget, /Copy JSON/);
  assert.match(widget, /attachShadow/);
  assert.match(contentScript, /openOptionsPage/);
});

test("Market Snap runtime starts stable capture on OpenLane hosts without the old pre-detection gate", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const runRuntimeBlock = contentScript.slice(
    contentScript.indexOf("async function runRuntime"),
    contentScript.indexOf("async function waitForBody"),
  );

  assert.match(runRuntimeBlock, /isOpenLaneHost\(\)/);
  assert.match(runRuntimeBlock, /ensureWidget\(\)/);
  assert.match(runRuntimeBlock, /runAnalysis\(\{\s*force\s*\}\)/);
  assert.doesNotMatch(runRuntimeBlock, /waitForVehiclePage/);
  assert.doesNotMatch(contentScript, /MAX_READY_RETRIES/);
});

test("Market Snap manual extraction messages use stable capture instead of direct extraction", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const extractBlock = contentScript.slice(
    contentScript.indexOf('message?.type === "MARKET_SNAP_EXTRACT"'),
    contentScript.indexOf('message?.type === "MARKET_SNAP_ANALYZE"'),
  );
  const analyzeBlock = contentScript.slice(
    contentScript.indexOf('message?.type === "MARKET_SNAP_ANALYZE"'),
    contentScript.indexOf("return undefined;", contentScript.indexOf('message?.type === "MARKET_SNAP_ANALYZE"')),
  );

  assert.match(extractBlock, /extractStableListing\(\{\s*force:\s*true\s*\}\)/);
  assert.match(extractBlock, /readiness:\s*stableCapture\.readiness/);
  assert.match(extractBlock, /debug:\s*stableCapture\.debug/);
  assert.doesNotMatch(extractBlock, /extractListing\(\{\s*force:\s*true\s*\}\)/);
  assert.match(analyzeBlock, /runRuntime\(\{\s*force:\s*true,\s*reason:\s*"popup-analyze"\s*\}\)/);
});

test("Market Snap widget exposes draggable, settings, and data-quality controls", () => {
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");

  for (const marker of [
    "drag-handle",
    "pointerdown",
    "marketSnapWidgetPosition",
    "settings-drawer",
    "dealerFlowBaseUrl",
    "autoCapture",
    "modelImprovementOptIn",
    "data-quality",
    "Capture debug",
    "Page type",
    "Capture kind",
    "Outcome confidence",
    "Capture level",
    "Deep Capture active",
    "Deep Capture activation mode",
    "Consent mode",
    "Readiness",
    "Capture blocked reason",
    "VIN status",
    "VIN evidence source",
    "VIN candidates",
    "Price state",
    "Current offer",
    "Best offer",
    "Final bid amount",
    "Sold price candidate",
    "Purchase evidence source",
    "Ignored noisy zones",
    "pageType",
    "captureKind",
    "carfaxUrlStatus",
    "Carfax status",
    "Carfax URL",
    "Carfax evidence source",
    "Carfax warning",
    "Network observer",
    "Network evidence count",
    "Missing data",
    "Extraction confidence",
    "VIN evidence",
    "Price evidence",
    "Condition warnings",
    "Dealer notes",
    "Rejected candidates",
    "Rejected field candidates",
    "Network candidates",
    "Safe expansion",
    "Sold price",
    "Buy price auction",
    "Invoice total",
    "Evidence",
    "observePageNetworkData",
    "data-action=\"hide\"",
    "redactSensitiveText",
  ]) {
    assert.match(widget, new RegExp(marker));
  }

  assert.match(contentScript, /hiddenPageUrl/);
  assert.match(contentScript, /backendResponse/);
  assert.match(contentScript, /captureResponse/);
  assert.match(widget, /pointer-events:\s*none/);
  assert.match(widget, /pointer-events:\s*auto/);
});

test("Market Snap widget separates purchase outcome primary metrics from active auction metrics", () => {
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");

  assert.match(widget, /purchaseOutcomeDetectedMetrics/);
  assert.match(widget, /activeListingDetectedMetrics/);
  assert.match(widget, /isPurchaseOutcomeContext\(safeListing\)\s*\?\s*purchaseOutcomeDetectedMetrics\(safeListing\)\s*:\s*activeListingDetectedMetrics\(safeListing\)/);

  const purchaseMetricsBlock = widget.slice(
    widget.indexOf("function purchaseOutcomeDetectedMetrics"),
    widget.indexOf("function activeListingDetectedMetrics"),
  );
  assert.match(purchaseMetricsBlock, /Sold price/);
  assert.match(purchaseMetricsBlock, /Buy price auction/);
  assert.match(purchaseMetricsBlock, /Final bid amount/);
  assert.doesNotMatch(purchaseMetricsBlock, /Current bid/);
  assert.doesNotMatch(purchaseMetricsBlock, /Best offer/);
});

test("Market Snap copy JSON includes normalized extraction, runtime evidence, and backend responses", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const copyPayload = readFileSync(join(repoRoot, "browser-extension/src/copy-payload.js"), "utf8");
  const source = `${contentScript}\n${copyPayload}`;

  assert.match(contentScript, /DealerFlowMarketSnapCopyPayload\.buildCopyPayload/);
  assert.match(source, /normalizedExtraction/);
  assert.match(source, /deepCaptureActivationMode/);
  assert.match(source, /consentMode/);
  assert.match(source, /legacyPayload/);
  assert.match(source, /classification/);
  assert.match(source, /sectionMap/);
  assert.match(source, /candidateScores/);
  assert.match(source, /debugSummary/);
  assert.match(source, /safeExpansion/);
  assert.match(source, /networkEvidence/);
  assert.match(source, /readinessSummary/);
  assert.match(source, /buildReadinessSummary/);
  assert.match(source, /outcomeEvidence/);
  assert.match(source, /rejectedOutcomePriceCandidates/);
  assert.match(source, /debug/);
  assert.match(contentScript, /basic DOM extraction may miss VIN\/Carfax/);
  assert.match(contentScript, /Future installer consent UI pending/);
  assert.match(contentScript, /Network observer running/);
  assert.match(contentScript, /VIN missing\. Preview only - capture blocked to avoid bad data/);
  assert.match(contentScript, /Ready to capture/);
  assert.match(contentScript, /logExtractionDebug/);
  assert.match(contentScript, /ignored evidence/);
  assert.match(contentScript, /section map/);
  assert.match(contentScript, /safe expansion/);
  assert.match(contentScript, /network candidates/);
  assert.match(contentScript, /condition evidence/);
  assert.match(contentScript, /media filtering stats/);
  assert.match(contentScript, /backendResponse/);
  assert.match(contentScript, /captureResponse/);
  assert.match(source, /buildCopyPayload/);
  assert.match(source, /sanitizeDebugValue/);
});

test("Market Snap copy payload builder returns sanitized readiness and debug evidence", () => {
  const copyPayload = require("../browser-extension/src/copy-payload.js") as {
    buildCopyPayload: (listing: Record<string, unknown>, state?: Record<string, unknown>) => Record<string, unknown>;
  };
  const payload = copyPayload.buildCopyPayload({
    pageType: "active_listing",
    captureKind: "observation",
    captureLevel: "deep_capture",
    vin: "KM8J3CA46HU123456",
    currentBid: 13_700,
    listedPrice: 13_700,
    priceSemantics: { currentBid: "observation", listedPrice: "observation_alias_current_bid" },
    carfaxUrlStatus: "text_only",
    extractionConfidenceScore: 92,
    fieldEvidence: {
      vin: [{ sourceType: "header_chip", sourceText: "VIN KM8J3CA46HU123456" }],
      currentBid: [{ sourceType: "section_map", sourceText: "$13,700 token=should-not-copy", confidenceScore: 98 }],
    },
    extractedFields: {
      currentBidEvidence: { sourceType: "section_map", sourceText: "$13,700", confidenceScore: 98 },
      debug: {
        vinCandidates: [{ vin: "KM8J3CA46HU123456", sourceText: "VIN KM8J3CA46HU123456" }],
        titleCandidates: [{ text: "2017 Hyundai Tucson", score: 85 }, { text: "OpenLane Auction", rejectedReason: "non_vehicle_title" }],
        mileageCandidates: [{ mileageKm: 185, sourceText: "Transport CAD $428 / 185km", rejectedReason: "transport_distance_not_odometer" }],
        priceCandidates: [
          { field: "currentBid", value: 13_700, sourceType: "section_map", sourceText: "$13,700", confidenceScore: 98 },
          { field: "currentBid", value: 13_700, sourceType: "bid_panel_top_row", sourceText: "Bidder 1 $13,700", confidenceScore: 96 },
          { field: "currentBid", value: 4, sourceType: "section_map", sourceText: "Current bid 4 Bids", rejectedReason: "bid_count_not_money" },
          { field: "currentBid", value: 9, sourceType: "section_map", sourceText: "authorization=secret-token 9 Bids", rejectedReason: "bid_count_not_money" },
        ],
        rejectedPurchaseOutcomeCandidates: [
          { field: "soldPriceCandidate", value: 428, sourceText: "Transport estimate CAD $428 / 185km", rejectedReason: "transport_estimate_not_purchase_outcome" },
        ],
        lowerBidCandidates: [
          { field: "currentBid", value: 11_100, sourceType: "visible_text", sourceText: "$11,100", rejectedReason: "lower_bid_history_candidate" },
        ],
        staleCurrentBidCandidates: [
          { field: "currentBid", value: 8_500, sourceType: "active_bid_bar", sourceText: "Current bid $8,500 Last refreshed earlier", rejectedReason: "stale_current_bid_candidate" },
        ],
        listedPriceDecision: { source: "current_bid", semantics: "observation_alias_current_bid" },
        conditionDiagnostics: {
          rejectedConditionLines: [
            { sourceZone: "disclosuresCondition", sourceText: "Full bid history Bidder 1 $13,700", rejectionReason: "bid_history_noise" },
          ],
          sectionBoundaryDecisions: [
            { sourceZone: "disclosuresCondition", startHeading: "Mechanical", stopHeading: "Exterior" },
          ],
        },
        apiToken: "Bearer should-not-copy",
      },
    },
    openlaneMetadata: {
      stableCaptureReadiness: {
        readyToCapture: true,
        state: "ready_to_capture",
        vinStatus: "found",
        carfaxStatus: "url_found",
        missingData: [],
      },
      deepCaptureRuntime: {
        active: true,
        networkEvidenceCount: 0,
        networkObserver: {
          enabled: true,
          reason: "observing_page_generated_responses",
          pageHookInstalled: true,
          earlyHookInstalled: true,
          earlyQueueLength: 0,
          earlyQueueFlushed: true,
          pageHookEventCount: 3,
          allowedEventCount: 1,
          deniedEventCount: 1,
          irrelevantJsonCount: 1,
          duplicateEventCount: 1,
          parseErrorCount: 1,
          lastAllowedEndpointPattern: "app.openlane.ca/api/vdp/:id",
          lastDeniedEndpointPattern: "app.openlane.ca/api/profile/me",
          lastDeniedEndpointReason: "denied_sensitive_endpoint",
          lastObservedEndpointSample: "app.openlane.ca/api/vdp/:id",
        },
      },
      bidStabilization: {
        bidState: "unstable_candidate_conflict",
        initialCurrentBid: 8500,
        finalCurrentBid: 13_700,
        bidStabilizationAttempts: 1,
        bidUpdatedAt: "2026-05-20T12:00:00.000Z",
      },
      bidLiveMonitor: {
        updatedAt: "2026-05-20T12:00:01.000Z",
        currentBid: 13_700,
        source: "bid_only_monitor",
      },
      networkEvidence: [],
      carfaxEvidence: [{ source: "network_json" }],
      carfaxDiagnostics: {
        carfaxNetworkCandidateCount: 0,
        carfaxTextOnlyCandidateCount: 1,
      },
      sectionMapSummary: {
        summary: {
          sidebar: { ignored: true, textLength: 24 },
          marketGuide: { ignored: true, textLength: 19 },
        },
      },
      classification: {
        ignoredEvidence: [
          { zone: "qaSection", sourceText: "Q&A" },
          { marker: "picked up", zone: "sellerNotes", sourceText: "Pickup Monday-Friday", rejectedReason: "pickup_schedule_not_purchase_outcome" },
        ],
      },
    },
  }, {
    valuation: { confidenceScore: 88 },
    backendResponse: { ok: true },
    captureResponse: { skipped: false },
  });

  assert.equal((payload.readinessSummary as { readyToCapture?: boolean }).readyToCapture, true);
  assert.equal((payload.readinessSummary as { vinEvidenceSource?: string }).vinEvidenceSource, "header_chip");
  assert.equal((payload.readinessSummary as { carfaxEvidenceSource?: string }).carfaxEvidenceSource, "network_json");
  assert.equal((payload.readinessSummary as { networkEvidenceCount?: number }).networkEvidenceCount, 0);
  assert.equal((payload.readinessSummary as { networkObserverDiagnostics?: { pageHookInstalled?: boolean } }).networkObserverDiagnostics?.pageHookInstalled, true);
  assert.equal((payload.readinessSummary as { networkObserverDiagnostics?: { deniedEventCount?: number } }).networkObserverDiagnostics?.deniedEventCount, 1);
  assert.equal((payload.readinessSummary as { networkObserverDiagnostics?: { irrelevantJsonCount?: number } }).networkObserverDiagnostics?.irrelevantJsonCount, 1);
  assert.equal((payload.readinessSummary as { carfaxDiagnostics?: { carfaxTextOnlyCandidateCount?: number } }).carfaxDiagnostics?.carfaxTextOnlyCandidateCount, 1);
  assert.match(String((payload.readinessSummary as { networkObserverMessage?: string }).networkObserverMessage), /safe vehicle JSON but no Carfax\/currentBid candidates/i);
  assert.equal((payload.readinessSummary as { priceState?: string }).priceState, "observation");
  assert.equal((payload.readinessSummary as { currentBidSource?: string }).currentBidSource, "section_map");
  assert.match(String((payload.readinessSummary as { currentBidSourceText?: string }).currentBidSourceText), /\$13,700/);
  assert.equal((payload.readinessSummary as { listedPriceSemantics?: string }).listedPriceSemantics, "observation_alias_current_bid");
  assert.match(JSON.stringify((payload.priceDiagnostics as { rejectedPriceCandidates?: unknown[] }).rejectedPriceCandidates), /bid_count_not_money/);
  assert.match(JSON.stringify((payload.priceDiagnostics as { rejectedOutcomePriceCandidates?: unknown[] }).rejectedOutcomePriceCandidates), /transport_estimate_not_purchase_outcome/);
  assert.match(JSON.stringify((payload.readinessSummary as { rejectedOutcomePriceCandidates?: unknown[] }).rejectedOutcomePriceCandidates), /transport_estimate_not_purchase_outcome/);
  assert.match(JSON.stringify((payload.priceDiagnostics as { lowerBidCandidates?: unknown[] }).lowerBidCandidates), /11100/);
  assert.match(JSON.stringify((payload.priceDiagnostics as { staleCurrentBidCandidates?: unknown[] }).staleCurrentBidCandidates), /stale_current_bid_candidate/);
  assert.match(JSON.stringify((payload.readinessSummary as { staleCurrentBidCandidates?: unknown[] }).staleCurrentBidCandidates), /stale_current_bid_candidate/);
  assert.equal((payload.currentBidDebug as { winningCurrentBid?: number }).winningCurrentBid, 13_700);
  assert.equal((payload.currentBidDebug as { winningCurrentBidSource?: string }).winningCurrentBidSource, "section_map");
  assert.match(JSON.stringify((payload.currentBidDebug as { staleActiveBidBarCandidate?: unknown }).staleActiveBidBarCandidate), /8500/);
  assert.match(JSON.stringify((payload.currentBidDebug as { bidPanelTopCandidate?: unknown }).bidPanelTopCandidate), /13700/);
  assert.match(JSON.stringify((payload.currentBidDebug as { freshBidPanelCandidates?: unknown[] }).freshBidPanelCandidates), /13700/);
  assert.match(JSON.stringify((payload.currentBidDebug as { bidMonitorStatus?: unknown }).bidMonitorStatus), /bid_only_monitor/);
  assert.equal((payload.currentBidDebug as { lastBidUpdatedAt?: string }).lastBidUpdatedAt, "2026-05-20T12:00:01.000Z");
  assert.equal((payload.currentBidDebug as { bidStabilizationAttempts?: number }).bidStabilizationAttempts, 1);
  assert.deepEqual((payload.currentBidDebug as { rejectedCounts?: unknown }).rejectedCounts, {
    rejectedPriceCandidates: 2,
    rejectedOutcomePriceCandidates: 3,
    lowerBidCandidates: 1,
    staleCurrentBidCandidates: 1,
  });
  assert.equal((payload.purchaseOutcomeDebug as { soldPriceParserStatus?: string }).soldPriceParserStatus, "not_purchase_context");
  assert.equal((payload.purchaseOutcomeDebug as { missingPurchasePriceReason?: string }).missingPurchasePriceReason, "not_purchase_context");
  assert.match(JSON.stringify((payload.purchaseOutcomeDebug as { purchaseMarkerRejectedReasons?: unknown[] }).purchaseMarkerRejectedReasons), /pickup_schedule_not_purchase_outcome/);
  assert.match(JSON.stringify((payload.purchaseOutcomeDebug as { purchaseMarkerSourceZones?: unknown[] }).purchaseMarkerSourceZones), /sellerNotes/);
  assert.equal((payload.conditionCleanupDebug as { conditionExtractorMode?: string }).conditionExtractorMode, "section_ast_with_boundary_cleanup");
  assert.equal((payload.conditionCleanupDebug as { rejectedConditionLineCount?: number }).rejectedConditionLineCount, 1);
  assert.equal((payload.conditionCleanupDebug as { sectionBoundaryDecisionCount?: number }).sectionBoundaryDecisionCount, 1);
  assert.equal((payload.conditionCleanupDebug as { ignoredNoisyZoneCount?: number }).ignoredNoisyZoneCount, 4);
  assert.match(JSON.stringify((payload.conditionCleanupDebug as { rejectedConditionLines?: unknown[] }).rejectedConditionLines), /bid_history_noise/);
  assert.match(JSON.stringify((payload.conditionCleanupDebug as { sectionBoundaryDecisions?: unknown[] }).sectionBoundaryDecisions), /Mechanical/);
  assert.match(JSON.stringify((payload.carfaxDebug as { carfaxCandidateCounts?: unknown }).carfaxCandidateCounts), /carfaxTextOnlyCandidateCount/);
  assert.equal((payload.carfaxDebug as { textOnlyExplanation?: string }).textOnlyExplanation, "Visible CARFAX text was found, but no safe URL was exposed in DOM, router metadata, hydration JSON, or allowed network evidence.");
  assert.deepEqual((payload.carfaxDebug as { sourceStatus?: unknown }).sourceStatus, {
    domLink: false,
    dataAttribute: false,
    routerOrHydration: false,
    network: false,
    textOnly: true,
  });
  assert.match(JSON.stringify((payload.carfaxDebug as { networkObserverMessage?: string }).networkObserverMessage), /safe vehicle JSON but no Carfax\/currentBid candidates/i);
  assert.match(JSON.stringify((payload.contradictionDiagnostics as { classificationContradictions?: unknown[] }).classificationContradictions), /pickup_schedule_not_purchase_outcome/);
  assert.match(JSON.stringify((payload.contradictionDiagnostics as { priceContradictions?: unknown[] }).priceContradictions), /stale_current_bid_candidate/);
  assert.match(JSON.stringify((payload.contradictionDiagnostics as { conditionContradictions?: unknown[] }).conditionContradictions), /bid_history_noise/);
  assert.match(JSON.stringify((payload.contradictionDiagnostics as { carfaxContradictions?: unknown[] }).carfaxContradictions), /text_only/);
  assert.match(JSON.stringify((payload.contradictionDiagnostics as { networkContradictions?: unknown[] }).networkContradictions), /safe vehicle JSON but no Carfax\/currentBid candidates/i);
  assert.match(JSON.stringify((payload.priceDiagnostics as { priceDiagnosticMessages?: string[] }).priceDiagnosticMessages), /Rejected bid count as price: Current bid 4 Bids/);
  assert.match(JSON.stringify((payload.priceDiagnostics as { priceDiagnosticMessages?: string[] }).priceDiagnosticMessages), /Lower bid candidate ignored: \$11,100/);
  assert.match(JSON.stringify((payload.priceDiagnostics as { priceDiagnosticMessages?: string[] }).priceDiagnosticMessages), /Stale current bid candidate ignored: \$8,500/);
  assert.deepEqual((payload.readinessSummary as { ignoredNoisyZones?: string[] }).ignoredNoisyZones, ["sidebar", "marketGuide", "qaSection", "sellerNotes"]);
  assert.equal((payload.readinessSummary as { rejectedFieldCandidateCount?: number }).rejectedFieldCandidateCount, 2);
  assert.deepEqual((payload.readinessSummary as { requiredFieldsForPageType?: string[] }).requiredFieldsForPageType, ["vin"]);
  assert.match(String((payload.readinessSummary as { listedPriceRequirementReason?: string }).listedPriceRequirementReason), /not required/i);
  assert.match(JSON.stringify(payload.debugSummary), /Network observer saw safe vehicle JSON but no Carfax\/currentBid candidates/i);
  assert.match(JSON.stringify(payload.debugSummary), /Q&A\/sidebar\/market-guide text ignored/i);
  assert.equal((payload.valuation as { confidenceScore?: number }).confidenceScore, 88);
  assert.doesNotMatch(JSON.stringify(payload), /should-not-copy|secret-token/i);
});

test("Market Snap copy payload exposes Kia purchase outcome fields without listedPrice missing noise", () => {
  const copyPayload = require("../browser-extension/src/copy-payload.js") as {
    buildCopyPayload: (listing: Record<string, unknown>, state?: Record<string, unknown>) => Record<string, unknown>;
  };
  const listing = extractOpenLaneFixture(
    readFileSync(join(repoRoot, "tests/fixtures/openlane/openlane-vdp-kia-purchase-sold-price-picked-up-live.html"), "utf8"),
    "https://app.openlane.ca/vdp/3KPFL4A72HE119966",
  );

  const payload = copyPayload.buildCopyPayload(listing);
  const readiness = payload.readinessSummary as {
    missingData?: string[];
    soldPriceCandidate?: number;
    buyPriceAuction?: number;
    finalBidAmount?: number | null;
    purchaseEvidenceSource?: string;
  };
  const purchaseDebug = payload.purchaseOutcomeDebug as {
    soldPriceCandidate?: number;
    buyPriceAuction?: number;
    finalBidAmount?: number | null;
    purchaseEvidenceSource?: string;
    rejectedOutcomePriceCandidates?: unknown[];
  };

  assert.equal(readiness.soldPriceCandidate, 4_000);
  assert.equal(readiness.buyPriceAuction, 4_000);
  assert.equal(readiness.finalBidAmount, null);
  assert.equal(readiness.purchaseEvidenceSource, "purchase_detail_panel");
  assert.ok(!readiness.missingData?.includes("listedPrice"));
  assert.equal(purchaseDebug.soldPriceCandidate, 4_000);
  assert.equal(purchaseDebug.buyPriceAuction, 4_000);
  assert.equal(purchaseDebug.purchaseEvidenceSource, "purchase_detail_panel");
  assert.equal((purchaseDebug as { soldPriceParserStatus?: string }).soldPriceParserStatus, "price_found");
  assert.ok(Array.isArray(purchaseDebug.rejectedOutcomePriceCandidates));
  assert.match(JSON.stringify(payload), /soldPriceCandidate|buyPriceAuction|purchaseOutcomeDebug|rejectedOutcomePriceCandidates/);
});

test("Market Snap copy payload uses canonical OpenLane state over stale legacy fields", () => {
  const contract = require("../browser-extension/src/openlane-extraction-contract.js") as {
    createCanonicalOpenLaneState: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  };
  const copyPayload = require("../browser-extension/src/copy-payload.js") as {
    buildCopyPayload: (listing: Record<string, unknown>, state?: Record<string, unknown>) => Record<string, unknown>;
  };

  const payload = copyPayload.buildCopyPayload({
    sourceName: "OpenLane",
    pageType: "active_listing",
    captureKind: "observation",
    currentBid: 13_800,
    soldPriceCandidate: undefined,
    carfaxUrlStatus: "text_only",
    missingData: ["listedPrice"],
    openlaneCanonicalState: contract.createCanonicalOpenLaneState({
      pageContext: { pageType: "purchase_detail", captureKind: "candidate_outcome", outcomeConfidence: "high" },
      activeAuction: {
        currentBid: 14_200,
        evidence: [{ field: "currentBid", sourceType: "section_map", sourceText: "Current bid $14,200" }],
      },
      purchaseOutcome: {
        soldPriceCandidate: 4_000,
        buyPriceAuction: 4_000,
        evidence: [{ field: "soldPriceCandidate", sourceType: "purchase_detail_panel", sourceText: "Sold price $4,000" }],
      },
      carfax: {
        urlStatus: "url_found",
        url: "https://vhr.carfax.ca/report/example",
        available: true,
      },
      readiness: {
        ready: true,
        state: "ready_to_capture",
        missingData: [],
      },
    }),
  });

  const canonicalState = payload.canonicalState as {
    activeAuction?: { currentBid?: number };
    purchaseOutcome?: { soldPriceCandidate?: number };
    diagnostics?: { sourcePriorities?: Record<string, unknown> };
  };
  const legacyPayload = payload.legacyPayload as { currentBid?: number; soldPriceCandidate?: number; carfaxUrlStatus?: string; missingData?: string[] };
  const readiness = payload.readinessSummary as { currentBid?: number; soldPriceCandidate?: number; carfaxStatus?: string; missingData?: string[] };
  const currentBidDebug = payload.currentBidDebug as { winningCurrentBid?: number };
  const contradictionDiagnostics = payload.contradictionDiagnostics as {
    legacyOverrides?: Array<{ legacyValueOverridden?: boolean; canonicalWinningField?: string; canonicalValue?: unknown }>;
  };

  assert.equal(canonicalState.activeAuction?.currentBid, 14_200);
  assert.equal(canonicalState.purchaseOutcome?.soldPriceCandidate, 4_000);
  assert.ok(canonicalState.diagnostics?.sourcePriorities);
  assert.equal(legacyPayload.currentBid, 14_200);
  assert.equal(legacyPayload.soldPriceCandidate, 4_000);
  assert.equal(legacyPayload.carfaxUrlStatus, "url_found");
  assert.deepEqual(legacyPayload.missingData, []);
  assert.equal(readiness.currentBid, 14_200);
  assert.equal(readiness.soldPriceCandidate, 4_000);
  assert.equal(readiness.carfaxStatus, "url_found");
  assert.deepEqual(readiness.missingData, []);
  assert.equal(currentBidDebug.winningCurrentBid, 14_200);
  assert.ok(contradictionDiagnostics.legacyOverrides?.some((item) => (
    item.legacyValueOverridden === true
    && item.canonicalWinningField === "currentBid"
    && item.canonicalValue === 14_200
  )));
});

test("Market Snap widget debug UX explains purchased, active, Carfax, network, and noisy fields", () => {
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");

  for (const marker of [
    "canonicalListing",
    "canonicalToLegacyPayload",
    "Purchased VDP detected from",
    "Active listing detected. Current bid is observation-only.",
    "Sold price extracted from purchase panel.",
    "Missing sold price",
    "Carfax text-only; URL not required.",
    "Transport estimate ignored as listing price.",
    "Carfax text found, but no URL is exposed.",
    "Network observer active; no OpenLane vehicle JSON observed yet.",
    "Network observer active, but the OpenLane page hook is not installed yet.",
    "Network observer saw requests but denied them as sensitive.",
    "Network observer saw safe vehicle JSON but no Carfax/currentBid candidates.",
    "Network diagnostics:",
    "networkObserverDiagnosticsLabel",
    "Legacy overrides:",
    "legacyValueOverridden",
    "canonicalValue",
    "legacyValue",
    "Q&A/sidebar/market-guide text ignored for canonical fields.",
    "Current bid source:",
    "Current bid source text:",
    "Rejected current bid counts:",
    "Rejected price candidates:",
    "Rejected outcome price candidates:",
    "Lower bid candidates ignored:",
    "Stale current bid candidates ignored:",
    "Current bid updated from",
    "Classification contradictions:",
    "Price contradictions:",
    "Condition contradictions:",
    "Carfax contradictions:",
    "Network contradictions:",
    "Purchase marker rejected reasons:",
    "Sold price parser status:",
    "Missing purchase price reason:",
    "Required fields for page type:",
    "Listed price requirement:",
    "Condition extractor mode:",
    "Rejected condition lines:",
    "Ignored noisy zones count:",
    "Section boundary decisions:",
    "Carfax text-only explanation:",
    "Carfax source status:",
    "Listed price semantics:",
    "Rejected bid count as price:",
    "contradictionDiagnostics",
    "conditionCleanupDebug",
    "buildPriceDiagnostics",
    "purchaseEvidenceSource",
    "ignoredNoisyZones",
    "rejectedFieldCandidateItems",
    "redactSensitiveText",
  ]) {
    assert.match(widget, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.doesNotMatch(widget, /requestHeaders|Authorization header|Cookie header/i);
});

test("Market Snap no-VIN OpenLane listings stay preview-only in the content script and widget", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");
  const readinessBlockIndex = contentScript.indexOf("!stableCapture.readiness.readyToCapture");
  const queueCaptureIndex = contentScript.indexOf("queueCapture(listing");

  assert.ok(readinessBlockIndex >= 0);
  assert.ok(queueCaptureIndex > readinessBlockIndex);
  assert.match(contentScript, /missing_vin_openlane_preview_only/);
  assert.match(contentScript, /VIN missing\. Preview only - capture blocked to avoid bad data\./);
  assert.match(widget, /saveButton\.disabled\s*=\s*state\.status === "saving"\s*\|\|\s*\(renderListing && !readinessSummary\(renderListing\)\.readyToCapture\)/);
});

test("Market Snap analyze and save routes support extension CORS preflight", () => {
  const analyzeRoute = readFileSync(join(repoRoot, "src/app/api/market-snap/analyze-listing/route.ts"), "utf8");
  const captureRoute = readFileSync(join(repoRoot, "src/app/api/market-snap/capture-listing/route.ts"), "utf8");
  const saveRoute = readFileSync(join(repoRoot, "src/app/api/market-snap/save-listing/route.ts"), "utf8");
  const api = readFileSync(join(repoRoot, "src/lib/server/market-snap-api.ts"), "utf8");

  assert.match(analyzeRoute, /OPTIONS = marketSnapOptions/);
  assert.match(captureRoute, /OPTIONS = marketSnapOptions/);
  assert.match(saveRoute, /OPTIONS = marketSnapOptions/);
  assert.match(api, /MARKET_SNAP_EXTENSION_ORIGINS/);
  assert.match(api, /access-control-allow-credentials/);
  assert.match(api, /requireOrganizationRole/);
});

test("Market Snap extension settings and API client are shared and secret-free", () => {
  const storage = readFileSync(join(repoRoot, "browser-extension/src/storage.js"), "utf8");
  const apiClient = readFileSync(join(repoRoot, "browser-extension/src/api-client.js"), "utf8");
  const popupHtml = readFileSync(join(repoRoot, "browser-extension/popup.html"), "utf8");
  const optionsHtml = readFileSync(join(repoRoot, "browser-extension/options.html"), "utf8");
  const options = readFileSync(join(repoRoot, "browser-extension/src/options.js"), "utf8");
  const popup = readFileSync(join(repoRoot, "browser-extension/src/popup.js"), "utf8");

  for (const setting of ["dealerFlowBaseUrl", "organizationId", "autoAnalyze", "autoCapture", "autoSave", "modelImprovementOptIn", "widgetCollapsed", "debugMode", "includeMediaUrls", "includeRawVisibleText", "observePageNetworkData"]) {
    assert.match(storage, new RegExp(setting));
  }
  assert.match(storage, /deepCaptureActivationMode/);
  for (const fn of ["getMarketSnapSettings", "saveMarketSnapSettings", "validateMarketSnapSettings", "analyzeListing", "saveListing", "buildDealerFlowUrl", "formatApiError"]) {
    assert.match(apiClient, new RegExp(fn));
  }
  assert.match(apiClient, /credentials:\s*"include"/);
  assert.match(apiClient, /\/api\/market-snap\/analyze-listing/);
  assert.match(apiClient, /\/api\/market-snap\/capture-listing/);
  assert.match(apiClient, /\/api\/market-snap\/save-listing/);
  assert.match(popupHtml, /src\/storage\.js/);
  assert.match(popupHtml, /src\/api-client\.js/);
  assert.match(optionsHtml, /src\/storage\.js/);
  assert.doesNotMatch(options, /chrome\.storage\.sync\.(get|set)/);
  assert.doesNotMatch(popup, /chrome\.storage\.sync\.(get|set)/);

  const extensionText = readExtensionText(join(repoRoot, "browser-extension"));
  assert.doesNotMatch(extensionText, /SUPABASE_SERVICE_ROLE|service_role_key|supabase_service_role/i);
  assert.doesNotMatch(extensionText, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(extensionText, /sk_(live|test|proj)_[A-Za-z0-9_-]{16,}/);
  assert.doesNotMatch(extensionText, /password\s*[:=]|openlane credentials\s*[:=]|carfax credentials\s*[:=]/i);
});

test("Market Snap storage normalizes blank Dealer Flow URL back to the safe default", async () => {
  const storageSource = readFileSync(join(repoRoot, "browser-extension/src/storage.js"), "utf8");
  const syncStore: Record<string, unknown> = {
    dealerFlowBaseUrl: "",
    organizationId: "5a652d48-a32d-4d84-acab-2799c85dee35",
    autoAnalyze: true,
  };
  const localStore: Record<string, unknown> = {};
  const context = {
    window: {} as {
      DealerFlowMarketSnapStorage?: {
        getSettings: () => Promise<Record<string, unknown>>;
        saveSettings: (values: Record<string, unknown>) => Promise<Record<string, unknown>>;
      };
    },
    crypto: { randomUUID: () => "install-test" },
    chrome: {
      storage: {
        sync: {
          get: async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, syncStore[key]]).filter((entry) => entry[1] !== undefined)),
          set: async (values: Record<string, unknown>) => {
            Object.assign(syncStore, values);
          },
        },
        local: {
          get: async (key: string) => ({ [key]: localStore[key] }),
          set: async (values: Record<string, unknown>) => {
            Object.assign(localStore, values);
          },
        },
      },
    },
  };

  vm.runInNewContext(storageSource, context);
  const storageApi = context.window.DealerFlowMarketSnapStorage;
  assert.ok(storageApi);

  const settings = await storageApi.getSettings();
  assert.equal(settings.dealerFlowBaseUrl, "http://localhost:3000");

  const saved = await storageApi.saveSettings({
    ...settings,
    dealerFlowBaseUrl: "   ",
  });
  assert.equal(saved.dealerFlowBaseUrl, "http://localhost:3000");
  assert.equal(syncStore.dealerFlowBaseUrl, "http://localhost:3000");
  assert.equal(String(syncStore.organizationId), "5a652d48-a32d-4d84-acab-2799c85dee35");
});

test("Market Snap widget settings save surfaces success and failure and reloads saved values", () => {
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");
  const saveBlock = widget.slice(
    widget.indexOf("async function saveWidgetSettings"),
    widget.indexOf("function installDrag"),
  );

  assert.match(saveBlock, /try\s*{/);
  assert.match(saveBlock, /catch\s*\(error\)/);
  assert.match(saveBlock, /onSettingsSaved/);
  assert.match(saveBlock, /onSettingsError/);
  assert.match(saveBlock, /Settings saved\./);
  assert.match(saveBlock, /Settings save failed:/);
  assert.match(saveBlock, /loadWidgetSettings\(shadow,\s*saved\)/);
});

test("Market Snap widget render helpers are null-safe when no extraction exists", () => {
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");
  const readinessBlock = widget.slice(
    widget.indexOf("function readinessSummary"),
    widget.indexOf("function vinStatusLabel"),
  );
  const conditionBlock = widget.slice(
    widget.indexOf("function conditionWarningItems"),
    widget.indexOf("function topEvidenceLabel"),
  );
  const priceStateBlock = widget.slice(
    widget.indexOf("function priceStateLabel"),
    widget.indexOf("function carfaxLabel"),
  );

  assert.match(readinessBlock, /const safeListing = listing \|\| \{\}/);
  assert.match(readinessBlock, /safeListing\.missingData/);
  assert.doesNotMatch(readinessBlock, /listing\.missingData/);
  assert.match(conditionBlock, /const safeListing = listing \|\| \{\}/);
  assert.match(priceStateBlock, /const safeListing = canonicalListing\(listing \|\| \{\}\)/);
});

test("Market Snap widget wraps async button actions and sanitizes action errors", () => {
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");

  assert.match(widget, /runWidgetAction/);
  assert.match(widget, /onActionError/);
  assert.match(widget, /Refresh failed/);
  assert.match(widget, /Save failed/);
  assert.match(widget, /Copy JSON failed/);
  assert.match(widget, /Open Dealer Flow failed/);
  assert.match(widget, /Hide page failed/);
  assert.match(widget, /sanitizeWidgetError/);
  assert.doesNotMatch(widget, /authorization bearer/i);
});

test("Market Snap content script surfaces extraction failures instead of leaving stale debug state", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const runAnalysisBlock = contentScript.slice(
    contentScript.indexOf("async function runAnalysis"),
    contentScript.indexOf("function queueCapture"),
  );
  const copyBlock = contentScript.slice(
    contentScript.indexOf("async function copyExtractedJson"),
    contentScript.indexOf("function buildCopyPayload"),
  );

  assert.match(runAnalysisBlock, /catch\s*\(error\)/);
  assert.match(runAnalysisBlock, /status:\s*"error"/);
  assert.match(runAnalysisBlock, /formatError\(error\)/);
  assert.match(copyBlock, /try\s*{/);
  assert.match(copyBlock, /catch\s*\(error\)/);
  assert.match(copyBlock, /Extracted JSON copied\./);
});

test("Market Snap repository persists OpenLane media and Carfax metadata", () => {
  const repository = readFileSync(join(repoRoot, "src/lib/market-snap/repository.ts"), "utf8");
  const migration = readFileSync(join(repoRoot, "supabase/migrations/20260522_openlane_extension_payload.sql"), "utf8");

  for (const field of ["carfax_url", "photos_json", "videos_json", "openlane_metadata", "extraction_confidence_score", "raw_visible_text"]) {
    assert.match(repository, new RegExp(field));
    assert.match(migration, new RegExp(`add column if not exists ${field}`));
  }
});

test("Copy JSON diagnostics distinguish missing network hook from zero candidate responses", () => {
  const copyPayload = require("../browser-extension/src/copy-payload.js") as {
    buildReadinessSummary: (listing: Record<string, unknown>) => Record<string, unknown>;
  };
  const payload = copyPayload.buildReadinessSummary({
    sourceName: "OpenLane",
    openlaneMetadata: {
      deepCaptureRuntime: {
        active: true,
        networkEvidenceCount: 0,
        networkObserver: {
          enabled: true,
          pageHookInstalled: false,
          earlyHookInstalled: false,
          pageHookEventCount: 0,
          allowedEventCount: 0,
          deniedEventCount: 0,
          irrelevantJsonCount: 0,
        },
      },
    },
  });

  assert.match(String((payload as { networkObserverMessage?: string }).networkObserverMessage), /page hook is not installed yet/i);
  assert.equal((payload as { networkObserverDiagnostics?: { pageHookInstalled?: boolean } }).networkObserverDiagnostics?.pageHookInstalled, false);
});

test("OpenLane extractor captures core vehicle, price, and auction fields", () => {
  const html = readFileSync(join(repoRoot, "tests/fixtures/openlane/openlane-basic.html"), "utf8");
  const listing = extractOpenLaneFixture(html);

  assert.equal(listing.sourceName, "OpenLane");
  assert.equal(listing.sourceType, "auction");
  assert.equal(listing.marketType, "auction_market");
  assert.equal(listing.vin, "2T3R1RFV5MW123456");
  assert.equal(listing.year, 2021);
  assert.equal(listing.make, "Toyota");
  assert.equal(listing.model, "RAV4");
  assert.equal(listing.mileageKm, 52300);
  assert.equal(listing.currentBid, 18500);
  assert.equal(listing.buyNowPrice, 22900);
  assert.equal(listing.listedPrice, 22900);
  assert.equal(listing.runNumber, "42");
  assert.equal(listing.lane, "A");
  assert.equal(listing.imageCount, 1);
});

test("OpenLane extractor exposes the dedicated helper contract", () => {
  const contract = readFileSync(join(repoRoot, "browser-extension/src/openlane-extraction-contract.js"), "utf8");
  const sectionMap = readFileSync(join(repoRoot, "browser-extension/src/openlane-section-map.js"), "utf8");
  const expander = readFileSync(join(repoRoot, "browser-extension/src/openlane-safe-expander.js"), "utf8");
  const network = readFileSync(join(repoRoot, "browser-extension/src/openlane-network-observer.js"), "utf8");
  const pageHook = readFileSync(join(repoRoot, "browser-extension/src/openlane-network-page-hook.js"), "utf8");

  for (const marker of ["buildOpenLaneExtractionContract", "pageContext", "identity", "auctionObservation", "purchaseOutcome", "condition", "media", "carfax", "debug"]) {
    assert.match(contract, new RegExp(marker));
  }
  for (const marker of ["buildOpenLaneSectionMap", "buildOpenLaneSectionMapFromHtml", "vehicleHero", "disclosuresCondition", "dealerNotes", "marketGuide", "sidebar"]) {
    assert.match(sectionMap, new RegExp(marker));
  }
  for (const marker of ["expandOpenLaneReadOnlySections", "SAFE_LABEL_PATTERN", "DANGEROUS_LABEL_PATTERN", "maxSteps", "snapshotOpenLaneReadOnlySections"]) {
    assert.match(expander, new RegExp(marker));
  }
  for (const marker of ["startOpenLaneNetworkObserver", "extractCandidatesFromNetworkPayload", "sanitizeNetworkPayload", "mergeNetworkEvidenceIntoListing"]) {
    assert.match(network, new RegExp(marker));
  }
  assert.match(pageHook, /originalFetch/);
  assert.match(pageHook, /XMLHttpRequest/);

  for (const helper of [
    "extractOpenLaneListing",
    "isOpenLaneVehiclePage",
    "extractVisibleText",
    "extractLabelValueMap",
    "extractMoneyByLabels",
    "extractMileage",
    "extractVin",
    "extractYearMakeModelTrim",
    "extractCarfaxLink",
    "extractPhotos",
    "extractVideos",
    "normalizeAbsoluteUrl",
    "dedupeMedia",
    "calculateExtractionConfidence",
    "buildMissingData",
  ]) {
    assert.equal(typeof openLaneExtractor[helper], "function", `${helper} should be exported`);
  }
});

test("OpenLane safe expander opens read-only sections and skips dangerous controls", async () => {
  const hiddenSection = fakeNode("Disclosures and conditions", "");
  const safe = fakeNode("Disclosures and conditions", "", () => {
    hiddenSection.innerText = "Hidden disclosure text. Note from selling dealer: check engine light on.";
    hiddenSection.textContent = "Hidden disclosure text. Note from selling dealer: check engine light on.";
  });
  const bid = fakeNode("Place bid", "", () => {
    throw new Error("dangerous bid clicked");
  });
  const markRetrieved = fakeNode("Mark Retrieved", "", () => {
    throw new Error("dangerous mark retrieved clicked");
  });
  const doc = {
    querySelectorAll(selector: string) {
      if (selector.includes("button")) return [safe, bid, markRetrieved];
      return [hiddenSection];
    },
  };

  const result = await safeExpander.expandOpenLaneReadOnlySections(doc, { maxSteps: 4, waitMs: 0 });

  assert.equal(safe.clicked, true);
  assert.equal(bid.clicked, false);
  assert.equal(markRetrieved.clicked, false);
  assert.ok(result.clicked.some((item) => /Disclosures/i.test(item.label)));
  assert.ok(result.skipped.some((item) => item.reason === "dangerous_label" && /Place bid/i.test(item.label)));
  assert.ok(result.snapshots.some((snapshot) => /Hidden disclosure text/i.test(snapshot.text)));
});

test("OpenLane network observer extracts only sanitized page-generated vehicle candidates", () => {
  const payload = {
    vehicle: {
      vin: "2T3R1RFV5MW123456",
      photos: ["https://pub-us.kar-media.com/vehicle/2T3R1RFV5MW123456/front.jpg", "https://app.openlane.ca/openlane-logo.svg"],
      condition: {
        mechanical: "check engine light on",
        disclosure: "Transmission hesitation",
      },
    },
    sessionToken: "eyJaaaaaaaaaaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccccc",
    customerEmail: "buyer@example.com",
  };
  const candidates = networkObserver.extractCandidatesFromNetworkPayload(payload, "https://app.openlane.ca/api/vdp/2T3R1RFV5MW123456");
  const sanitized = JSON.stringify(networkObserver.sanitizeNetworkPayload(payload));
  const merged = networkObserver.mergeNetworkEvidenceIntoListing({ listingUrl: "https://app.openlane.ca/vdp/test" }, [{
    capturedAt: "2026-05-15T00:00:00.000Z",
    endpointPattern: "app.openlane.ca/api/vdp/:id",
    sanitizedKeys: candidates.sanitizedKeys,
    candidates,
  }]);

  assert.equal(candidates.vinCandidates[0]?.vin, "2T3R1RFV5MW123456");
  assert.ok(candidates.mediaCandidates.some((item) => item.url.includes("pub-us.kar-media.com")));
  assert.equal(candidates.mediaCandidates.some((item) => /logo/i.test(item.url)), false);
  assert.ok(candidates.conditionCandidates.some((item) => /check engine/i.test(item.text)));
  assert.doesNotMatch(sanitized, /buyer@example\.com|eyJaaaaaaaa/i);
  assert.equal(merged.vin, "2T3R1RFV5MW123456");
  assert.match(String(merged.conditionReportText), /check engine light on/);
});

test("OpenLane network observer ignores sensitive endpoints and reports consent-gated status", () => {
  networkObserver.stopOpenLaneNetworkObserver();

  assert.equal(networkObserver.rememberNetworkPayload(JSON.stringify({ vehicle: { vin: "2T3R1RFV5MW123456" } }), "https://app.openlane.ca/api/profile/me", "application/json"), undefined);
  assert.equal(networkObserver.rememberNetworkPayload(JSON.stringify({ vehicle: { vin: "2T3R1RFV5MW123456" } }), "https://app.openlane.ca/api/account/payment", "application/json"), undefined);
  assert.equal(networkObserver.rememberNetworkPayload(JSON.stringify({ vehicle: { vin: "2T3R1RFV5MW123456" } }), "https://app.openlane.ca/api/session/token", "application/json"), undefined);

  const inactive = networkObserver.startOpenLaneNetworkObserver({
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    deepCaptureEnabled: false,
    deepCaptureConsentStatus: "off",
    deepCaptureConsentId: "",
    observePageNetworkData: true,
  }, { href: "https://app.openlane.ca/vdp/123" });
  const disabled = networkObserver.startOpenLaneNetworkObserver({
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    deepCaptureEnabled: true,
    deepCaptureConsentStatus: "active",
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
    observePageNetworkData: false,
  }, { href: "https://app.openlane.ca/vdp/123" });
  const active = networkObserver.startOpenLaneNetworkObserver({
    dealerFlowBaseUrl: "https://dealer-flow.example",
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    deepCaptureEnabled: true,
    deepCaptureConsentStatus: "active",
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
    observePageNetworkData: true,
  }, { href: "https://app.openlane.ca/vdp/123" });

  assert.equal(inactive.enabled, false);
  assert.equal(inactive.reason, "deep_capture_disabled_by_user");
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.reason, "disabled");
  assert.equal(active.enabled, true);
  assert.equal(active.reason, "observing_page_generated_responses");
  networkObserver.stopOpenLaneNetworkObserver();
});

test("OpenLane network sanitizer redacts authorization-like strings and sensitive keys", () => {
  const sanitized = JSON.stringify(networkObserver.sanitizeNetworkPayload({
    vehicle: { vin: "2T3R1RFV5MW123456" },
    nested: {
      authorization: "Bearer should-not-appear",
      cookie: "session=secret",
      notes: "Authorization: Bearer visible-secret token=abc123 buyer@example.com 514-555-1212",
    },
  }));

  assert.doesNotMatch(sanitized, /Bearer should-not-appear|visible-secret|token=abc123|buyer@example\.com|514-555-1212|session=secret/i);
  assert.match(sanitized, /\[redacted/);
});

test("OpenLane extractor caps raw visible text at the prompt limit", () => {
  const longText = `2022 Honda Civic VIN 2HGFE2F52NH123456 Mileage 41000 km Buy Now $21000 ${"x".repeat(14000)}`;
  const text = openLaneExtractor.extractVisibleText({ body: { innerText: longText } });

  assert.equal(text.length, 12000);
});

test("OpenLane extractor captures visible Carfax links without fetching reports", () => {
  const html = readFileSync(join(repoRoot, "tests/fixtures/openlane/openlane-with-carfax.html"), "utf8");
  const listing = extractOpenLaneFixture(html);

  assert.equal(listing.carfaxAvailable, true);
  assert.equal(listing.carfaxUrl, "https://www.carfax.ca/report/ABC123");
  assert.match(String(listing.conditionReportText), /Minor scratches/);
});

test("OpenLane extractor captures and deduplicates visible photos and videos", () => {
  const html = readFileSync(join(repoRoot, "tests/fixtures/openlane/openlane-with-photos-videos.html"), "utf8");
  const listing = extractOpenLaneFixture(html);

  assert.ok(Array.isArray(listing.photos));
  assert.ok(Array.isArray(listing.videos));
  assert.ok(Number(listing.imageCount) >= 3);
  assert.ok(Number(listing.videoCount) >= 2);
  assert.ok((listing.photos as Array<{ url: string }>).some((photo) => photo.url.endsWith("/photos/f150-front.jpg")));
  assert.ok((listing.photos as Array<{ source?: string }>).some((photo) => photo.source === "picture"));
  assert.ok((listing.videos as Array<{ url: string }>).some((video) => video.url.includes("f150-walkaround.mp4")));
});

test("OpenLane extractor does not invent a listed price when active price is missing", () => {
  const html = readFileSync(join(repoRoot, "tests/fixtures/openlane/openlane-missing-price.html"), "utf8");
  const listing = extractOpenLaneFixture(html);

  assert.equal(listing.listedPrice, undefined);
  assert.ok(!((listing.missingData as string[] | undefined) || []).includes("listedPrice"));
});

test("OpenLane extractor feeds condition report and announcements into payload", () => {
  const html = readFileSync(join(repoRoot, "tests/fixtures/openlane/openlane-condition-report.html"), "utf8");
  const listing = extractOpenLaneFixture(html);

  assert.match(String(listing.conditionReportText), /Severe rust/);
  assert.match(String(listing.conditionReportText), /Transmission hesitation/);
  assert.ok((listing.declarations as string[]).some((item) => /Structural/i.test(item)));
});

function readExtensionText(path: string): string {
  const stats = statSync(path);
  if (stats.isDirectory()) {
    return readdirSync(path).map((entry) => readExtensionText(join(path, entry))).join("\n");
  }
  if (!/\.(js|json|html|css|md)$/i.test(path)) return "";
  return readFileSync(path, "utf8");
}

function fakeNode(label: string, text = "", onClick?: () => void) {
  return {
    clicked: false,
    innerText: label,
    textContent: text || label,
    dataset: {} as Record<string, string>,
    getAttribute(name: string) {
      if (name === "aria-label") return label;
      if (name === "type") return "button";
      return "";
    },
    closest() {
      return null;
    },
    click() {
      this.clicked = true;
      onClick?.();
    },
  };
}
