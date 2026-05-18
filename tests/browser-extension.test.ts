import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
require("../browser-extension/src/openlane-section-map.js");
const networkObserver = require("../browser-extension/src/openlane-network-observer.js") as {
  extractCandidatesFromNetworkPayload: (payload: unknown, url?: string) => { vinCandidates: Array<{ vin: string }>; mediaCandidates: Array<{ url: string }>; conditionCandidates: Array<{ text: string }>; sanitizedKeys: string[] };
  sanitizeNetworkPayload: (payload: unknown) => unknown;
  rememberNetworkPayload: (body: unknown, url?: string, contentType?: string) => unknown;
  startOpenLaneNetworkObserver: (settings?: Record<string, unknown>) => { enabled: boolean; reason: string; observationCount: number };
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

  assert.ok(matches.includes("https://*.openlane.ca/*"));
  assert.ok(matches.includes("https://*.openlane.com/*"));
  assert.ok(scripts.includes("src/storage.js"));
  assert.ok(scripts.includes("src/api-client.js"));
  assert.ok(scripts.includes("src/openlane-extraction-contract.js"));
  assert.ok(scripts.includes("src/openlane-section-map.js"));
  assert.ok(scripts.includes("src/openlane-page-classifier.js"));
  assert.ok(scripts.includes("src/openlane-network-observer.js"));
  assert.ok(scripts.includes("src/openlane-safe-expander.js"));
  assert.ok(scripts.includes("src/openlane-extractor.js"));
  assert.ok(scripts.includes("src/openlane-stable-capture.js"));
  assert.ok(scripts.includes("src/market-snap-widget.js"));
  assert.ok(scripts.includes("src/content-script.js"));
  assert.ok(scripts.indexOf("src/openlane-stable-capture.js") < scripts.indexOf("src/content-script.js"));
  assert.ok(css.includes("styles/widget.css"));
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("webRequest"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);
});

test("Market Snap extension uses in-page OpenLane widget instead of popup-only analysis", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");
  const widget = readFileSync(join(repoRoot, "browser-extension/src/market-snap-widget.js"), "utf8");

  assert.match(contentScript, /__dealerFlowMarketSnapRuntime/);
  assert.match(contentScript, /waitForVehiclePage/);
  assert.match(contentScript, /extractStableOpenLaneListing/);
  assert.match(contentScript, /readyToCapture/);
  assert.match(contentScript, /classifyOpenLanePage/);
  assert.match(contentScript, /MAX_READY_RETRIES/);
  assert.match(contentScript, /MutationObserver/);
  assert.match(contentScript, /pushState/);
  assert.match(contentScript, /replaceState/);
  assert.match(contentScript, /disconnected/);
  assert.match(contentScript, /expandReadOnlySections/);
  assert.match(contentScript, /DealerFlowOpenLaneSafeExpander/);
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
    "Price state",
    "Current offer",
    "Best offer",
    "pageType",
    "captureKind",
    "carfaxUrlStatus",
    "Carfax status",
    "Carfax URL",
    "Carfax evidence",
    "Carfax warning",
    "VIN evidence",
    "Price evidence",
    "Condition warnings",
    "Dealer notes",
    "Rejected candidates",
    "Network candidates",
    "Safe expansion",
    "Sold candidate",
    "Buy price auction",
    "Invoice total",
    "Evidence",
    "observePageNetworkData",
    "data-action=\"hide\"",
  ]) {
    assert.match(widget, new RegExp(marker));
  }

  assert.match(contentScript, /hiddenPageUrl/);
  assert.match(contentScript, /backendResponse/);
  assert.match(contentScript, /captureResponse/);
  assert.match(widget, /pointer-events:\s*none/);
  assert.match(widget, /pointer-events:\s*auto/);
});

test("Market Snap copy JSON includes normalized extraction, runtime evidence, and backend responses", () => {
  const contentScript = readFileSync(join(repoRoot, "browser-extension/src/content-script.js"), "utf8");

  assert.match(contentScript, /normalizedExtraction/);
  assert.match(contentScript, /legacyPayload/);
  assert.match(contentScript, /classification/);
  assert.match(contentScript, /sectionMap/);
  assert.match(contentScript, /candidateScores/);
  assert.match(contentScript, /safeExpansion/);
  assert.match(contentScript, /networkEvidence/);
  assert.match(contentScript, /outcomeEvidence/);
  assert.match(contentScript, /debug/);
  assert.match(contentScript, /basic DOM extraction may miss VIN\/Carfax/);
  assert.match(contentScript, /logExtractionDebug/);
  assert.match(contentScript, /ignored evidence/);
  assert.match(contentScript, /section map/);
  assert.match(contentScript, /safe expansion/);
  assert.match(contentScript, /network candidates/);
  assert.match(contentScript, /condition evidence/);
  assert.match(contentScript, /media filtering stats/);
  assert.match(contentScript, /backendResponse/);
  assert.match(contentScript, /captureResponse/);
  assert.match(contentScript, /buildCopyPayload/);
  assert.match(contentScript, /sanitizeDebugValue/);
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

test("Market Snap repository persists OpenLane media and Carfax metadata", () => {
  const repository = readFileSync(join(repoRoot, "src/lib/market-snap/repository.ts"), "utf8");
  const migration = readFileSync(join(repoRoot, "supabase/migrations/20260522_openlane_extension_payload.sql"), "utf8");

  for (const field of ["carfax_url", "photos_json", "videos_json", "openlane_metadata", "extraction_confidence_score", "raw_visible_text"]) {
    assert.match(repository, new RegExp(field));
    assert.match(migration, new RegExp(`add column if not exists ${field}`));
  }
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
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    deepCaptureEnabled: false,
    deepCaptureConsentStatus: "off",
    deepCaptureConsentId: "",
    observePageNetworkData: true,
  });
  const disabled = networkObserver.startOpenLaneNetworkObserver({
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    deepCaptureEnabled: true,
    deepCaptureConsentStatus: "active",
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
    observePageNetworkData: false,
  });
  const active = networkObserver.startOpenLaneNetworkObserver({
    organizationId: "63c47786-fb41-40c1-a573-71346969b9e0",
    deepCaptureEnabled: true,
    deepCaptureConsentStatus: "active",
    deepCaptureConsentId: "33333333-3333-4333-8333-333333333333",
    observePageNetworkData: true,
  });

  assert.equal(inactive.enabled, false);
  assert.equal(inactive.reason, "deep_capture_consent_required");
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

test("OpenLane extractor reports missing price instead of inventing one", () => {
  const html = readFileSync(join(repoRoot, "tests/fixtures/openlane/openlane-missing-price.html"), "utf8");
  const listing = extractOpenLaneFixture(html);

  assert.equal(listing.listedPrice, undefined);
  assert.ok((listing.missingData as string[]).includes("listedPrice"));
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
