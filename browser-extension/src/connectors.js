window.DealerFlowConnectors = [
  {
    id: "facebook-marketplace",
    matches: (url) => url.hostname.includes("facebook.com") && url.pathname.includes("/marketplace"),
    extract: () => extractGenericListing("Facebook Marketplace", "retail"),
  },
  {
    id: "autohebdo",
    matches: (url) => url.hostname.includes("autohebdo") || url.hostname.includes("autotrader"),
    extract: () => extractGenericListing("AutoTrader/AutoHebdo", "retail"),
  },
  {
    id: "openlane",
    matches: (url) => url.hostname.includes("openlane"),
    extract: () => extractGenericListing("OpenLane", "auction"),
  },
];

function extractGenericListing(sourceName, sourceType) {
  const text = document.body.innerText || "";
  const title = document.querySelector("h1")?.innerText || document.title;
  const price = matchNumber(text.match(/\$[\s\d,.]+/)?.[0]);
  const mileageKm = matchNumber(text.match(/([\d\s,.]+)\s?(km|kilometres|kilometers)/i)?.[1]);
  const year = Number((title.match(/\b(19|20)\d{2}\b/) || text.match(/\b(19|20)\d{2}\b/))?.[0]);
  const words = title.replace(/\b(19|20)\d{2}\b/, "").trim().split(/\s+/);
  return {
    sourceName,
    sourceType,
    listingUrl: location.href,
    title,
    description: text.slice(0, 3000),
    year: Number.isFinite(year) ? year : undefined,
    make: words[0],
    model: words[1],
    trim: words.slice(2, 5).join(" ") || undefined,
    mileageKm,
    listedPrice: price,
    imageCount: document.images.length,
    capturedAt: new Date().toISOString(),
  };
}

function matchNumber(value) {
  if (!value) return undefined;
  const number = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(number) ? number : undefined;
}
