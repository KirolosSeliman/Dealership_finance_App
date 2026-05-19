(function () {
  if (window.__dealerFlowOpenLaneEarlyNetworkHook) return;
  window.__dealerFlowOpenLaneEarlyNetworkHook = true;

  try {
    const target = document.documentElement || document.head;
    if (!target) return;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/openlane-network-page-hook.js");
    script.async = false;
    target.appendChild(script);
    script.remove();
  } catch {
    // Passive bootstrap only; never break the OpenLane page.
  }
})();
