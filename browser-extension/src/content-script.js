chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "MARKET_SNAP_EXTRACT") return;
  const url = new URL(location.href);
  const connector = window.DealerFlowConnectors.find((item) => item.matches(url));
  if (!connector) {
    sendResponse({ ok: false, message: "This page is not supported yet." });
    return;
  }
  sendResponse({ ok: true, listing: connector.extract() });
});
