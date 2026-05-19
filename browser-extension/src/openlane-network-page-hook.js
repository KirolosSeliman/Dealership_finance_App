(function () {
  if (window.__dealerFlowOpenLaneNetworkHook) return;
  window.__dealerFlowOpenLaneNetworkHook = true;

  const MAX_TEXT_LENGTH = 120000;
  const MAX_QUEUE_LENGTH = 10;
  const ALLOWED_HOST = /(^|\.)openlane\.(ca|com)$|kar-media\.com$/i;
  const ALLOW_ENDPOINT = /\b(vdp|vehicle|vehicles|listing|inventory|purchase|purchases|condition|disclosure|media|photo|image|bid|offer|fee|fees|invoice|post-sale|sale)\b/i;
  const DENY_ENDPOINT = /\b(auth|oauth|login|logout|session|profile|account|payment|billing|user|users|me|token|cookie|password)\b/i;
  const earlyQueue = [];
  let sequence = 0;
  let contentScriptActive = false;
  let queueEnabled = true;

  postDiagnostic("page_hook_installed");

  function emit(url, contentType, body) {
    if (!isAllowedEndpoint(url)) return;
    const message = {
      source: "dealer-flow-openlane-network",
      eventId: `openlane-network-${Date.now()}-${++sequence}`,
      url: String(url || ""),
      contentType: String(contentType || ""),
      body,
    };
    if (queueEnabled && !contentScriptActive) {
      earlyQueue.push(message);
      earlyQueue.splice(0, Math.max(0, earlyQueue.length - MAX_QUEUE_LENGTH));
    }
    window.postMessage(message, window.location.origin);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "dealer-flow-openlane-network-control") return;
    if (event.data.type === "flush") {
      contentScriptActive = true;
      queueEnabled = false;
      postDiagnostic("early_queue_flushed");
      for (const item of earlyQueue.splice(0)) {
        window.postMessage({ ...item, replayed: true }, window.location.origin);
      }
    }
    if (event.data.type === "clear") {
      contentScriptActive = false;
      queueEnabled = false;
      earlyQueue.splice(0);
      postDiagnostic("early_queue_cleared");
    }
  });

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function dealerFlowObservedFetch(...args) {
      const response = await originalFetch.apply(this, args);
      observeResponse(args[0]?.url || args[0], response);
      return response;
    };
  }

  const OriginalXHR = window.XMLHttpRequest;
  if (typeof OriginalXHR === "function") {
    window.XMLHttpRequest = function DealerFlowObservedXMLHttpRequest() {
      const xhr = new OriginalXHR();
      let requestUrl = "";
      const originalOpen = xhr.open;
      xhr.open = function observedOpen(method, url, ...rest) {
        requestUrl = String(url || "");
        return originalOpen.call(xhr, method, url, ...rest);
      };
      xhr.addEventListener("load", () => {
        try {
          const contentType = xhr.getResponseHeader("content-type") || "";
          if (!/json/i.test(contentType) && !/^\s*[\[{]/.test(String(xhr.responseText || ""))) return;
          emit(requestUrl, contentType, String(xhr.responseText || "").slice(0, MAX_TEXT_LENGTH));
        } catch {
          // Passive observation only; never break page XHR.
        }
      });
      return xhr;
    };
  }

  function observeResponse(url, response) {
    try {
      const contentType = response.headers?.get?.("content-type") || "";
      if (!/json/i.test(contentType)) return;
      response.clone().text().then((text) => emit(url, contentType, String(text || "").slice(0, MAX_TEXT_LENGTH))).catch(() => {});
    } catch {
      // Passive observation only; never break page fetch.
    }
  }

  function isAllowedEndpoint(url) {
    let parsed;
    try {
      parsed = new URL(String(url || ""), window.location.href);
    } catch {
      return false;
    }
    const target = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    if (!ALLOWED_HOST.test(parsed.hostname)) return false;
    if (DENY_ENDPOINT.test(target)) return false;
    return ALLOW_ENDPOINT.test(target);
  }

  function postDiagnostic(type) {
    try {
      window.postMessage({
        source: "dealer-flow-openlane-network-diagnostics",
        type,
        pageHookInstalled: true,
        earlyHookInstalled: Boolean(window.__dealerFlowOpenLaneEarlyNetworkHook),
        earlyQueueLength: earlyQueue.length,
      }, window.location.origin);
    } catch {
      // Passive diagnostics only; never break the OpenLane page.
    }
  }
})();
