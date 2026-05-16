(function () {
  if (window.__dealerFlowOpenLaneNetworkHook) return;
  window.__dealerFlowOpenLaneNetworkHook = true;

  const MAX_TEXT_LENGTH = 120000;
  const RELEVANT_URL = /openlane|kar|vehicle|vdp|listing|inventory|purchase|condition|disclosure|media|photo|image/i;

  function emit(url, contentType, body) {
    if (!RELEVANT_URL.test(String(url || ""))) return;
    window.postMessage({ source: "dealer-flow-openlane-network", url: String(url || ""), contentType: String(contentType || ""), body }, window.location.origin);
  }

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
})();
