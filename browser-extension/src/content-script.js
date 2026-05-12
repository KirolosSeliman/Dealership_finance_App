chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "MARKET_SNAP_EXTRACT") return;
  const url = new URL(location.href);
  const connector = window.DealerFlowConnectors.find((item) => item.matches(url));
  if (!connector) {
    sendResponse({ ok: false, message: "This page is not supported yet." });
    return;
  }
  const listing = connector.extract();
  sendResponse({
    ok: true,
    listing,
    extraction: {
      html: window.DealerFlowCapture.captureAuthorizedHtml(),
      sourceName: listing.sourceName,
      sourceType: listing.sourceType,
      sourceUrl: location.href,
      permissionBasis: "User-assisted visible listing capture from browser extension.",
    },
  });
});
