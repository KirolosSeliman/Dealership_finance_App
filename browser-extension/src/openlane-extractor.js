(function (root) {
  const RAW_TEXT_LIMIT = 20000;
  const OPENLANE_LABELS = {
    vin: ["VIN", "Vehicle Identification Number"],
    mileageKm: ["Mileage", "Odometer", "Kilometers", "KM"],
    exteriorColor: ["Exterior Color", "Exterior Colour", "Color", "Colour"],
    interiorColor: ["Interior Color", "Interior Colour"],
    drivetrain: ["Drivetrain", "Drive Train"],
    transmission: ["Transmission"],
    engine: ["Engine"],
    fuelType: ["Fuel Type", "Fuel"],
    bodyStyle: ["Body Style", "Body"],
    doors: ["Doors"],
    cylinders: ["Cylinders"],
    location: ["Location", "Auction Location"],
    sellerName: ["Seller", "Consignor"],
    auctionStatus: ["Auction Status", "Sale Status", "Status"],
    saleDate: ["Sale Date", "Auction Date", "Run Date"],
    runNumber: ["Run Number", "Run"],
    lane: ["Lane"],
    lotNumber: ["Lot", "Lot Number"],
    stockNumber: ["Stock", "Stock Number"],
    currentBid: ["Current Bid", "Bid"],
    buyNowPrice: ["Buy Now", "Buy It Now"],
    reservePrice: ["Reserve", "Reserve Price"],
    titleStatus: ["Title", "Title Status"],
    tireCondition: ["Tires", "Tire Condition"],
    keysAvailable: ["Keys", "Keys Available"],
  };

  function extractOpenLaneListing(doc = document, href = location.href, options = {}) {
    const rawVisibleText = normalizeSpace(doc.body?.innerText || doc.body?.textContent || "");
    const labelValues = extractLabelValues(doc, rawVisibleText);
    const title = bestTitle(doc, rawVisibleText);
    const decodedTitle = parseTitle(title || rawVisibleText);
    const media = options.includeMediaUrls === false ? { photos: [], videos: [] } : extractMedia(doc, href);
    const carfaxUrl = findCarfaxUrl(doc, href);
    const conditionReportText = extractConditionText(rawVisibleText, labelValues);
    const currentBid = moneyFrom(firstLabel(labelValues, OPENLANE_LABELS.currentBid));
    const buyNowPrice = moneyFrom(firstLabel(labelValues, OPENLANE_LABELS.buyNowPrice));
    const listedPrice = buyNowPrice || currentBid || moneyFrom(rawVisibleText.match(/\$\s?[\d,]+(?:\.\d{2})?/)?.[0]);
    const mileageKm = numberFrom(firstLabel(labelValues, OPENLANE_LABELS.mileageKm)) || numberFrom(rawVisibleText.match(/([\d,.\s]+)\s?(km|kilometres|kilometers)\b/i)?.[1]);
    const vin = vinFrom(firstLabel(labelValues, OPENLANE_LABELS.vin) || rawVisibleText);
    const province = provinceFrom(firstLabel(labelValues, OPENLANE_LABELS.location) || rawVisibleText);
    const declarations = splitAnnouncements(labelValues.get("declarations") || findSectionText(rawVisibleText, "Declarations"));
    const damageAnnouncements = splitAnnouncements(findSectionText(rawVisibleText, "Damage"));
    const mechanicalAnnouncements = splitAnnouncements(findSectionText(rawVisibleText, "Mechanical"));
    const structuralAnnouncements = splitAnnouncements(findSectionText(rawVisibleText, "Structural"));
    const odometerAnnouncements = splitAnnouncements(findSectionText(rawVisibleText, "Odometer"));
    const warnings = [];
    const missingData = [];

    const listing = {
      sourceName: "OpenLane",
      sourceType: "auction",
      marketType: "auction_market",
      listingUrl: href,
      capturedAt: new Date().toISOString(),
      title,
      year: decodedTitle.year,
      make: decodedTitle.make,
      model: decodedTitle.model,
      trim: decodedTitle.trim,
      vin,
      mileageKm,
      exteriorColor: firstLabel(labelValues, OPENLANE_LABELS.exteriorColor),
      interiorColor: firstLabel(labelValues, OPENLANE_LABELS.interiorColor),
      drivetrain: firstLabel(labelValues, OPENLANE_LABELS.drivetrain),
      transmission: firstLabel(labelValues, OPENLANE_LABELS.transmission),
      engine: firstLabel(labelValues, OPENLANE_LABELS.engine),
      fuelType: firstLabel(labelValues, OPENLANE_LABELS.fuelType),
      bodyStyle: firstLabel(labelValues, OPENLANE_LABELS.bodyStyle),
      doors: numberFrom(firstLabel(labelValues, OPENLANE_LABELS.doors)),
      cylinders: numberFrom(firstLabel(labelValues, OPENLANE_LABELS.cylinders)),
      location: firstLabel(labelValues, OPENLANE_LABELS.location),
      province,
      sellerName: firstLabel(labelValues, OPENLANE_LABELS.sellerName),
      sellerType: "auction",
      auctionStatus: firstLabel(labelValues, OPENLANE_LABELS.auctionStatus),
      saleDate: firstLabel(labelValues, OPENLANE_LABELS.saleDate),
      runNumber: firstLabel(labelValues, OPENLANE_LABELS.runNumber),
      lane: firstLabel(labelValues, OPENLANE_LABELS.lane),
      lotNumber: firstLabel(labelValues, OPENLANE_LABELS.lotNumber),
      stockNumber: firstLabel(labelValues, OPENLANE_LABELS.stockNumber),
      listedPrice,
      currentBid,
      buyNowPrice,
      reservePrice: moneyFrom(firstLabel(labelValues, OPENLANE_LABELS.reservePrice)),
      estimatedAuctionFees: estimateAuctionFees(listedPrice),
      titleStatus: firstLabel(labelValues, OPENLANE_LABELS.titleStatus),
      declarations,
      conditionReportText,
      damageAnnouncements,
      mechanicalAnnouncements,
      structuralAnnouncements,
      odometerAnnouncements,
      tireCondition: firstLabel(labelValues, OPENLANE_LABELS.tireCondition),
      keysAvailable: firstLabel(labelValues, OPENLANE_LABELS.keysAvailable),
      carfaxUrl,
      carfaxAvailable: Boolean(carfaxUrl || /carfax/i.test(rawVisibleText)),
      photos: media.photos,
      videos: media.videos,
      imageCount: media.photos.length,
      videoCount: media.videos.length,
      description: conditionReportText || rawVisibleText.slice(0, 3000),
      rawVisibleText: options.includeRawVisibleText === false ? undefined : rawVisibleText.slice(0, RAW_TEXT_LIMIT),
      extractedFields: Object.fromEntries(labelValues.entries()),
      missingData,
      warnings,
      extractionConfidenceScore: 0,
    };

    for (const [field, value] of Object.entries({ vin: listing.vin, year: listing.year, make: listing.make, model: listing.model, mileageKm: listing.mileageKm, listedPrice: listing.listedPrice })) {
      if (!value) missingData.push(field);
    }
    if (!listing.carfaxAvailable) warnings.push("Carfax link was not visible on this OpenLane page.");
    if (listing.imageCount === 0) warnings.push("No visible OpenLane photos were found in the page DOM.");
    if (!conditionReportText) warnings.push("Condition report text was not visible or could not be isolated.");

    listing.extractionConfidenceScore = scoreExtraction(listing);
    return compact(listing);
  }

  function isLikelyOpenLaneVehiclePage(doc = document, href = location.href) {
    const host = new URL(href).hostname.toLowerCase();
    if (!host.includes("openlane.")) return false;
    const text = normalizeSpace(doc.body?.innerText || doc.body?.textContent || "");
    const markers = [
      /\bVIN\b/i.test(text) || /[A-HJ-NPR-Z0-9]{17}/i.test(text),
      /\b(odometer|mileage|kilometres|kilometers|km)\b/i.test(text),
      /\b(19|20)\d{2}\b/.test(text),
      /\b(carfax|declarations|condition report|announcements)\b/i.test(text),
      /\b(lot|run|lane|auction|bid)\b/i.test(text),
      doc.images.length >= 2,
    ];
    return markers.filter(Boolean).length >= 2;
  }

  function extractOpenLaneFixture(html, href = "https://www.openlane.ca/vehicle/fixture") {
    const text = stripTags(html);
    const media = extractMediaFromHtml(html, href);
    const fakeDoc = {
      title: text.match(/\b(19|20)\d{2}[^\n<]{3,120}/)?.[0] || "OpenLane vehicle",
      body: { innerText: text, textContent: text },
      images: media.photos.map((photo) => ({ src: photo.url, alt: photo.alt || "", width: photo.width, height: photo.height })),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const listing = extractOpenLaneListing(fakeDoc, href);
    return {
      ...listing,
      photos: media.photos,
      videos: media.videos,
      imageCount: media.photos.length,
      videoCount: media.videos.length,
      carfaxUrl: listing.carfaxUrl || (html.match(/href=["']([^"']*carfax[^"']*)["']/i)?.[1] ? absoluteUrl(html.match(/href=["']([^"']*carfax[^"']*)["']/i)?.[1], href) : undefined),
      carfaxAvailable: listing.carfaxAvailable || /carfax/i.test(html),
    };
  }

  function extractLabelValues(doc, text) {
    const values = new Map();
    for (const [field, labels] of Object.entries(OPENLANE_LABELS)) {
      const value = labels.map((label) => valueNearLabel(doc, text, label)).find(Boolean);
      if (value) values.set(field, value);
    }
    const declarations = findSectionText(text, "Declarations");
    if (declarations) values.set("declarations", declarations);
    return values;
  }

  function valueNearLabel(doc, text, label) {
    const selectorValue = Array.from(doc.querySelectorAll?.("dt, th, label, [data-testid], [aria-label], .label, .field-label") || [])
      .find((node) => normalizeSpace(node.innerText || node.textContent || node.getAttribute?.("aria-label") || "").toLowerCase() === label.toLowerCase());
    const sibling = selectorValue?.nextElementSibling;
    const siblingText = normalizeSpace(sibling?.innerText || sibling?.textContent || "");
    if (siblingText) return siblingText.slice(0, 240);
    const regex = new RegExp(`${escapeRegExp(label)}\\s*[:#]?\\s*([^\\n|•]{1,120})`, "i");
    return normalizeSpace(text.match(regex)?.[1] || "");
  }

  function bestTitle(doc, text) {
    return normalizeSpace(doc.querySelector?.("h1")?.innerText || doc.querySelector?.("[data-testid*='title' i]")?.innerText || doc.title || text.match(/\b(19|20)\d{2}[^\n]{3,100}/)?.[0] || "OpenLane vehicle");
  }

  function parseTitle(title) {
    const year = Number(title.match(/\b(19|20)\d{2}\b/)?.[0]);
    const clean = title.replace(/\b(19|20)\d{2}\b/, "").replace(/[|,-]/g, " ").trim();
    const words = clean.split(/\s+/).filter(Boolean);
    return {
      year: Number.isFinite(year) ? year : undefined,
      make: words[0],
      model: words[1],
      trim: words.slice(2, 7).join(" ") || undefined,
    };
  }

  function extractMedia(doc, href) {
    const photos = [];
    const videos = [];
    for (const img of Array.from(doc.images || [])) {
      addPhoto(photos, { url: img.currentSrc || img.src, thumbnailUrl: img.src, alt: img.alt, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, source: "img" }, href);
      for (const candidate of parseSrcset(img.srcset)) addPhoto(photos, { url: candidate, thumbnailUrl: img.src, alt: img.alt, source: "srcset" }, href);
    }
    for (const source of Array.from(doc.querySelectorAll?.("picture source[srcset]") || [])) {
      for (const candidate of parseSrcset(source.getAttribute("srcset"))) addPhoto(photos, { url: candidate, source: "srcset" }, href);
    }
    for (const node of Array.from(doc.querySelectorAll?.("[style*='background']") || [])) {
      const style = node.getAttribute("style") || "";
      const match = style.match(/url\((['"]?)(.*?)\1\)/i);
      if (match?.[2]) addPhoto(photos, { url: match[2], alt: normalizeSpace(node.getAttribute("aria-label") || ""), source: "background-image" }, href);
    }
    for (const video of Array.from(doc.querySelectorAll?.("video") || [])) {
      addVideo(videos, { url: video.getAttribute("src"), posterUrl: video.getAttribute("poster"), title: video.getAttribute("title") || video.getAttribute("aria-label"), type: "video/mp4", source: "video" }, href);
    }
    for (const source of Array.from(doc.querySelectorAll?.("video source[src], source[type*='video']") || [])) {
      addVideo(videos, { url: source.getAttribute("src"), type: source.getAttribute("type"), source: "source" }, href);
    }
    for (const link of Array.from(doc.querySelectorAll?.("a[href], iframe[src]") || [])) {
      const url = link.getAttribute("href") || link.getAttribute("src");
      if (!url) continue;
      if (looksLikeImage(url)) addPhoto(photos, { url, alt: normalizeSpace(link.innerText || link.getAttribute("aria-label") || ""), source: "link" }, href);
      if (looksLikeVideo(url)) addVideo(videos, { url, title: normalizeSpace(link.innerText || link.getAttribute("title") || ""), type: link.tagName?.toLowerCase() === "iframe" ? "iframe" : undefined, source: link.tagName?.toLowerCase() === "iframe" ? "iframe" : "link" }, href);
    }
    return { photos: dedupeByUrl(photos).slice(0, 80), videos: dedupeByUrl(videos).slice(0, 20) };
  }

  function extractMediaFromHtml(html, href) {
    const photos = [];
    const videos = [];
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      addPhoto(photos, { url: attr(match[0], "src"), thumbnailUrl: attr(match[0], "src"), alt: attr(match[0], "alt"), width: numberFrom(attr(match[0], "width")), height: numberFrom(attr(match[0], "height")), source: "img" }, href);
      for (const candidate of parseSrcset(attr(match[0], "srcset"))) addPhoto(photos, { url: candidate, alt: attr(match[0], "alt"), source: "srcset" }, href);
    }
    for (const match of html.matchAll(/<source\b[^>]*srcset=["']([^"']+)["'][^>]*>/gi)) {
      for (const candidate of parseSrcset(match[1])) addPhoto(photos, { url: candidate, source: "srcset" }, href);
    }
    for (const match of html.matchAll(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/gi)) {
      addPhoto(photos, { url: match[2], source: "background-image" }, href);
    }
    for (const match of html.matchAll(/<(video|source|iframe)\b[^>]*>/gi)) {
      const tag = match[1].toLowerCase();
      const url = attr(match[0], "src");
      if (url && (tag === "video" || tag === "source" || looksLikeVideo(url))) addVideo(videos, { url, posterUrl: attr(match[0], "poster"), title: attr(match[0], "title"), type: attr(match[0], "type") || tag, source: tag === "iframe" ? "iframe" : tag }, href);
    }
    for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
      if (looksLikeImage(match[1])) addPhoto(photos, { url: match[1], source: "link" }, href);
      if (looksLikeVideo(match[1])) addVideo(videos, { url: match[1], source: "link" }, href);
    }
    return { photos: dedupeByUrl(photos), videos: dedupeByUrl(videos) };
  }

  function findCarfaxUrl(doc, href) {
    const link = Array.from(doc.querySelectorAll?.("a[href]") || []).find((item) => /carfax/i.test(`${item.href} ${item.innerText || ""} ${item.getAttribute("aria-label") || ""}`));
    return link ? absoluteUrl(link.getAttribute("href"), href) : undefined;
  }

  function extractConditionText(text, labels) {
    return [
      labels.get("declarations"),
      findSectionText(text, "Condition Report"),
      findSectionText(text, "Announcements"),
      findSectionText(text, "Damage"),
      findSectionText(text, "Mechanical"),
      findSectionText(text, "Structural"),
      findSectionText(text, "Odometer"),
    ].filter(Boolean).join(" | ").slice(0, 4000) || undefined;
  }

  function findSectionText(text, heading) {
    const match = text.match(new RegExp(`${escapeRegExp(heading)}\\s*[:\\n]?\\s*([\\s\\S]{0,800}?)(?=\\n\\s*[A-Z][A-Za-z ]{2,30}\\s*[:\\n]|$)`, "i"));
    return normalizeSpace(match?.[1] || "");
  }

  function firstLabel(values, labels) {
    for (const label of labels) {
      const camel = Object.entries(OPENLANE_LABELS).find(([, names]) => names.includes(label))?.[0];
      const value = values.get(camel || label);
      if (value) return value;
    }
    return undefined;
  }

  function scoreExtraction(listing) {
    const fields = ["vin", "year", "make", "model", "mileageKm", "listedPrice", "location", "conditionReportText"];
    const base = fields.reduce((score, field) => score + (listing[field] ? 9 : 0), 20);
    return Math.max(10, Math.min(98, base + Math.min(12, listing.imageCount * 2) + (listing.carfaxAvailable ? 6 : 0)));
  }

  function estimateAuctionFees(price) {
    return price ? Math.min(1800, Math.max(350, Math.round(price * 0.065))) : undefined;
  }

  function splitAnnouncements(value) {
    return normalizeSpace(value || "").split(/\s*[•|;]\s*|\n+/).map((item) => item.trim()).filter(Boolean).slice(0, 30);
  }

  function addPhoto(photos, photo, href) {
    const url = absoluteUrl(photo.url, href);
    if (!url || !looksLikeImage(url)) return;
    photos.push(compact({ ...photo, url, thumbnailUrl: absoluteUrl(photo.thumbnailUrl, href) || url }));
  }

  function addVideo(videos, video, href) {
    const url = absoluteUrl(video.url, href);
    if (!url) return;
    videos.push(compact({ ...video, url, posterUrl: absoluteUrl(video.posterUrl, href) }));
  }

  function dedupeByUrl(items) {
    const seen = new Set();
    return items.filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }

  function parseSrcset(value = "") {
    return String(value).split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
  }

  function looksLikeImage(url) {
    return /\.(avif|webp|png|jpe?g)(\?|#|$)/i.test(url) || /image|photo|gallery|vehicle/i.test(url);
  }

  function looksLikeVideo(url) {
    return /\.(mp4|webm|mov|m3u8)(\?|#|$)/i.test(url) || /youtube|vimeo|video|walkaround/i.test(url);
  }

  function absoluteUrl(value, href) {
    if (!value) return undefined;
    try {
      return new URL(String(value), href).href;
    } catch {
      return undefined;
    }
  }

  function normalizeSpace(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function stripTags(html) {
    return normalizeSpace(String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "\n"));
  }

  function attr(tag, name) {
    return tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];
  }

  function moneyFrom(value) {
    if (!value) return undefined;
    const number = Number(String(value).replace(/[^\d.]/g, ""));
    return Number.isFinite(number) && number > 0 ? number : undefined;
  }

  function numberFrom(value) {
    if (!value) return undefined;
    const number = Number(String(value).replace(/[^\d.]/g, ""));
    return Number.isFinite(number) ? number : undefined;
  }

  function vinFrom(value) {
    const vin = String(value || "").toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/)?.[0];
    return vin;
  }

  function provinceFrom(value) {
    return String(value || "").match(/\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/i)?.[1]?.toUpperCase();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function compact(object) {
    return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)));
  }

  const api = { extractOpenLaneListing, extractOpenLaneFixture, isLikelyOpenLaneVehiclePage };
  root.DealerFlowOpenLaneExtractor = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
