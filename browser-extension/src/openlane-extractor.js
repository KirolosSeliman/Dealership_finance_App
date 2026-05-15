(function (root) {
  const RAW_TEXT_LIMIT = 12000;
  const OPENLANE_LABELS = {
    vin: ["VIN", "Vehicle Identification Number"],
    mileageKm: ["Mileage", "Odometer", "Kilometers"],
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
    const rawVisibleText = extractVisibleText(doc);
    const classification = classifyOpenLanePage(doc, href);
    const labelValues = extractLabelValueMap(doc, rawVisibleText);
    const title = bestTitle(doc, rawVisibleText);
    const decodedTitle = extractYearMakeModelTrim(title || rawVisibleText);
    const media = options.includeMediaUrls === false ? { photos: [], videos: [] } : extractMedia(doc, href);
    const mediaCounts = extractMediaCounts(rawVisibleText);
    const carfaxUrl = extractCarfaxLink(doc, href);
    const conditionReportText = extractConditionText(rawVisibleText, labelValues);
    const purchaseEconomics = extractPurchaseEconomics(rawVisibleText, classification);
    const postSaleOutcome = extractPostSaleOutcome(rawVisibleText, classification);
    const isPurchaseOutcomePage = ["fee_details", "purchase_detail", "purchase_info", "purchase_list", "post_sale"].includes(classification.pageType);
    const currentBid = isPurchaseOutcomePage ? undefined : extractMoneyByLabels(labelValues, OPENLANE_LABELS.currentBid);
    const buyNowPrice = isPurchaseOutcomePage ? undefined : extractMoneyByLabels(labelValues, OPENLANE_LABELS.buyNowPrice);
    const listedPrice = isPurchaseOutcomePage ? undefined : buyNowPrice || currentBid || moneyFrom(rawVisibleText.match(/\$\s?[\d,]+(?:\.\d{2})?/)?.[0]);
    const mileageKm = extractMileage(firstLabel(labelValues, OPENLANE_LABELS.mileageKm)) || extractMileage(rawVisibleText);
    const vin = extractVin(firstLabel(labelValues, OPENLANE_LABELS.vin)) || extractVinFromDom(doc) || extractVin(rawVisibleText);
    const province = provinceFrom(firstLabel(labelValues, OPENLANE_LABELS.location) || rawVisibleText);
    const disclosureText = findDisclosureText(rawVisibleText);
    const declarations = splitAnnouncements(labelValues.get("declarations") || findSectionText(rawVisibleText, "Declarations") || disclosureText);
    const damageAnnouncements = splitAnnouncements(findSectionText(rawVisibleText, "Damage"));
    const mechanicalAnnouncements = splitAnnouncements(findSectionText(rawVisibleText, "Mechanical"));
    const structuralAnnouncements = splitAnnouncements(findSectionText(rawVisibleText, "Structural"));
    const odometerAnnouncements = splitAnnouncements(findSectionText(rawVisibleText, "Odometer"));
    const disclosureCount = countNearLabel(rawVisibleText, "disclosures?");
    const warnings = [];
    const missingData = [];

    const listing = {
      sourceName: "OpenLane",
      sourceType: "auction",
      marketType: "auction_market",
      pageType: classification.pageType,
      captureKind: classification.captureKind,
      outcomeConfidence: classification.outcomeConfidence,
      outcomeEvidence: classificationEvidence(classification),
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
      sellerName: cleanSellerName(firstLabel(labelValues, OPENLANE_LABELS.sellerName)),
      sellerType: "auction",
      auctionStatus: purchaseEconomics.purchaseStatus || postSaleOutcome.negotiationStatus || firstLabel(labelValues, OPENLANE_LABELS.auctionStatus),
      saleDate: firstLabel(labelValues, OPENLANE_LABELS.saleDate),
      runNumber: firstLabel(labelValues, OPENLANE_LABELS.runNumber),
      lane: firstLabel(labelValues, OPENLANE_LABELS.lane),
      lotNumber: firstLabel(labelValues, OPENLANE_LABELS.lotNumber),
      stockNumber: firstLabel(labelValues, OPENLANE_LABELS.stockNumber),
      listedPrice,
      currentBid,
      buyNowPrice,
      soldPriceCandidate: postSaleOutcome.soldPriceCandidate,
      finalBidAmount: postSaleOutcome.finalBidAmount,
      negotiatedAmount: postSaleOutcome.negotiatedAmount,
      counterOfferAmount: postSaleOutcome.counterOfferAmount,
      acceptedAmount: postSaleOutcome.acceptedAmount,
      negotiationStatus: postSaleOutcome.negotiationStatus,
      negotiatedAt: postSaleOutcome.negotiatedAt,
      acceptedAt: postSaleOutcome.acceptedAt,
      buyPriceAuction: purchaseEconomics.buyPriceAuction,
      transactionFee: purchaseEconomics.transactionFee,
      vehicleHistoryFee: purchaseEconomics.vehicleHistoryFee,
      subtotal: purchaseEconomics.subtotal,
      taxes: purchaseEconomics.taxes,
      totalInvoiceAmount: purchaseEconomics.totalInvoiceAmount,
      finalAcquisitionCost: purchaseEconomics.finalAcquisitionCost,
      priceSemantics: mergeObjects(postSaleOutcome.priceSemantics, purchaseEconomics.priceSemantics),
      reservePrice: moneyFrom(firstLabel(labelValues, OPENLANE_LABELS.reservePrice)),
      estimatedAuctionFees: estimateAuctionFees(listedPrice),
      titleStatus: cleanStatusValue(firstLabel(labelValues, OPENLANE_LABELS.titleStatus)),
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
      imageCount: Math.max(media.photos.length, mediaCounts.photoCount ?? 0),
      videoCount: Math.max(media.videos.length, mediaCounts.videoCount ?? 0),
      description: conditionReportText || rawVisibleText.slice(0, 3000),
      rawVisibleText: options.includeRawVisibleText === false ? undefined : rawVisibleText.slice(0, RAW_TEXT_LIMIT),
      openlaneMetadata: {
        classification,
        disclosureCount,
        mediaCountEvidence: mediaCounts,
        purchaseStatus: purchaseEconomics.purchaseStatus,
        purchaseEconomics: purchaseEconomics.metadata,
        negotiation: postSaleOutcome.metadata,
      },
      extractedFields: {
        ...Object.fromEntries(labelValues.entries()),
        classification,
        vinEvidence: evidenceSnippet(rawVisibleText, /\bVIN\b.{0,80}|[A-HJ-NPR-Z0-9]{17}/i, "VIN"),
        mileageEvidence: evidenceSnippet(rawVisibleText, /\b(Odometer|Mileage|Kilometers)\b.{0,80}/i, "Odometer"),
      },
      missingData,
      warnings: [...warnings, ...(classification.warnings || []), ...(postSaleOutcome.warnings || [])],
      extractionConfidenceScore: 0,
    };

    missingData.push(...buildMissingData(listing));
    if (!listing.carfaxAvailable) warnings.push("Carfax link was not visible on this OpenLane page.");
    if (listing.imageCount === 0) warnings.push("No visible OpenLane photos were found in the page DOM.");
    if (!conditionReportText) warnings.push("Condition report text was not visible or could not be isolated.");

    listing.warnings = [...warnings, ...(classification.warnings || []), ...(postSaleOutcome.warnings || [])];
    listing.extractionConfidenceScore = calculateExtractionConfidence(listing);
    return compact(listing);
  }

  function isOpenLaneVehiclePage(doc = document, href = location.href) {
    const host = new URL(href).hostname.toLowerCase();
    if (!host.includes("openlane.")) return false;
    const classification = classifyOpenLanePage(doc, href);
    if (classification.pageType && classification.pageType !== "unknown") return true;
    const text = extractVisibleText(doc);
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

  function classifyOpenLanePage(doc = document, href = location.href) {
    return root.DealerFlowOpenLanePageClassifier?.classifyOpenLanePage?.(doc, href) || {
      pageType: "unknown",
      captureKind: "observation",
      outcomeConfidence: "low",
      confidenceScore: 0,
      evidence: [],
      warnings: ["OpenLane page classifier was not available."],
    };
  }

  function classificationEvidence(classification) {
    return (classification.evidence || []).map((item) => ({
      evidenceType: evidenceTypeForClassification(classification),
      sourceText: item.sourceText || item.marker,
      capturedAt: new Date().toISOString(),
      confidenceScore: classification.confidenceScore,
    }));
  }

  function evidenceTypeForClassification(classification) {
    if (classification.pageType === "fee_details") return "fee_details_page";
    if (classification.pageType === "post_sale" && classification.captureKind === "verified_outcome") return "accepted_negotiation";
    return "visible_page_text";
  }

  function isLikelyOpenLaneVehiclePage(doc = document, href = location.href) {
    return isOpenLaneVehiclePage(doc, href);
  }

  function extractOpenLaneFixture(html, href = "https://www.openlane.ca/vehicle/fixture") {
    const text = `${stripTags(html)}\n${extractAttributeText(html)}`;
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
      imageCount: Math.max(Number(listing.imageCount || 0), media.photos.length),
      videoCount: Math.max(Number(listing.videoCount || 0), media.videos.length),
      carfaxUrl: listing.carfaxUrl || (html.match(/href=["']([^"']*carfax[^"']*)["']/i)?.[1] ? absoluteUrl(html.match(/href=["']([^"']*carfax[^"']*)["']/i)?.[1], href) : undefined),
      carfaxAvailable: listing.carfaxAvailable || /carfax/i.test(html),
    };
  }

  function extractVisibleText(doc = document) {
    return normalizeSpace(doc.body?.innerText || doc.body?.textContent || "").slice(0, RAW_TEXT_LIMIT);
  }

  function extractLabelValueMap(doc = document, text = extractVisibleText(doc)) {
    return extractLabelValues(doc, text);
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

  function extractYearMakeModelTrim(value) {
    return parseTitle(String(value || ""));
  }

  function extractMileage(value) {
    const text = String(value || "");
    const match = text.match(/(?:odometer|mileage|kilometers|kilometres)?\D*([\d,.\s]+)\s?(km|kilometres|kilometers)\b/i);
    return match ? numberFrom(match[1]) : undefined;
  }

  function extractVin(value) {
    return vinFrom(value);
  }

  function extractVinFromDom(doc = document) {
    const nodes = Array.from(doc.querySelectorAll?.("[data-vin], [aria-label], [data-testid], [title], button, [role='button']") || []);
    for (const node of nodes) {
      const text = [
        node.getAttribute?.("data-vin"),
        node.getAttribute?.("aria-label"),
        node.getAttribute?.("data-testid"),
        node.getAttribute?.("title"),
        node.innerText,
        node.textContent,
      ].filter(Boolean).join(" ");
      const vin = vinFrom(text);
      if (vin) return vin;
    }
    return undefined;
  }

  function extractMoneyByLabels(labels, labelNames = []) {
    const values = labels instanceof Map ? labels : new Map(Object.entries(labels || {}));
    const searchLabels = labelNames.length ? labelNames : [
      ...OPENLANE_LABELS.buyNowPrice,
      ...OPENLANE_LABELS.currentBid,
      ...OPENLANE_LABELS.reservePrice,
    ];
    return moneyFrom(firstLabel(values, searchLabels));
  }

  function extractCarfaxLink(doc = document, href = safeCurrentHref()) {
    return findCarfaxUrl(doc, href);
  }

  function extractPhotos(doc = document, href = safeCurrentHref()) {
    return extractMedia(doc, href).photos;
  }

  function extractVideos(doc = document, href = safeCurrentHref()) {
    return extractMedia(doc, href).videos;
  }

  function normalizeAbsoluteUrl(url, href = safeCurrentHref()) {
    return absoluteUrl(url, href);
  }

  function dedupeMedia(items) {
    return dedupeByUrl(items || []);
  }

  function calculateExtractionConfidence(listing) {
    return scoreExtraction(listing);
  }

  function buildMissingData(listing) {
    const requiredFields = {
      vin: listing.vin,
      year: listing.year,
      make: listing.make,
      model: listing.model,
      mileageKm: listing.mileageKm,
      listedPrice: listing.listedPrice,
    };
    return Object.entries(requiredFields)
      .filter(([, value]) => value === undefined || value === null || value === "")
      .map(([field]) => field);
  }

  function extractMedia(doc, href) {
    const photos = [];
    const videos = [];
    for (const img of Array.from(doc.images || [])) {
      const src = img.currentSrc || img.src || img.getAttribute?.("data-src") || img.getAttribute?.("data-original");
      addPhoto(photos, { url: src, thumbnailUrl: img.src || src, alt: img.alt, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, source: "img" }, href);
      for (const candidate of parseSrcset(img.srcset || img.getAttribute?.("srcset"))) addPhoto(photos, { url: candidate, thumbnailUrl: img.src || src, alt: img.alt, source: "srcset" }, href);
    }
    for (const source of Array.from(doc.querySelectorAll?.("picture source[srcset]") || [])) {
      for (const candidate of parseSrcset(source.getAttribute("srcset"))) addPhoto(photos, { url: candidate, source: "picture" }, href);
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
      const src = attr(match[0], "src") || attr(match[0], "currentSrc") || attr(match[0], "data-src") || attr(match[0], "data-original");
      addPhoto(photos, { url: src, thumbnailUrl: src, alt: attr(match[0], "alt"), width: numberFrom(attr(match[0], "width")), height: numberFrom(attr(match[0], "height")), source: "img" }, href);
      for (const candidate of parseSrcset(attr(match[0], "srcset"))) addPhoto(photos, { url: candidate, alt: attr(match[0], "alt"), source: "srcset" }, href);
    }
    for (const match of html.matchAll(/<source\b[^>]*srcset=["']([^"']+)["'][^>]*>/gi)) {
      for (const candidate of parseSrcset(match[1])) addPhoto(photos, { url: candidate, source: "picture" }, href);
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

  function findDisclosureText(text) {
    const match = text.match(/\bDisclosures?\b\s*[:\n]?\s*([\s\S]{0,1200}?)(?=\n\s*(Condition Report|Announcements|Damage|Mechanical|Structural|Odometer)\b|$)/i);
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

  function extractPurchaseEconomics(text, classification) {
    if (!["fee_details", "purchase_detail", "purchase_info"].includes(classification.pageType)) return {};
    const buyPriceAuction = moneyNearLabel(text, "Buy price - auction");
    const transactionFee = moneyNearLabel(text, "Transaction Fee");
    const vehicleHistoryFee = moneyNearLabel(text, "Vehicle history - auction") || moneyNearLabel(text, "Vehicle History Fee");
    const subtotal = moneyNearLabel(text, "Subtotal");
    const taxes = moneyNearLabel(text, "Taxes");
    const totalInvoiceAmount = moneyNearLabel(text, "Total");
    const finalAcquisitionCost = totalInvoiceAmount;
    const purchaseStatus = cleanStatusValue(valueNearTextLabel(text, "Status"));
    const priceSemantics = buyPriceAuction || transactionFee || vehicleHistoryFee || subtotal || taxes || totalInvoiceAmount ? compact({
      buyPriceAuction: buyPriceAuction ? "verified_wholesale_label" : undefined,
      transactionFee: transactionFee ? "acquisition_cost_component" : undefined,
      vehicleHistoryFee: vehicleHistoryFee ? "acquisition_cost_component" : undefined,
      subtotal: subtotal ? "acquisition_cost_component" : undefined,
      taxes: taxes ? "acquisition_cost_component" : undefined,
      totalInvoiceAmount: totalInvoiceAmount ? "final_acquisition_cost" : undefined,
      finalAcquisitionCost: finalAcquisitionCost ? "final_acquisition_cost" : undefined,
    }) : undefined;
    return compact({
      buyPriceAuction,
      transactionFee,
      vehicleHistoryFee,
      subtotal,
      taxes,
      totalInvoiceAmount,
      finalAcquisitionCost,
      purchaseStatus,
      priceSemantics,
      metadata: compact({
        currency: /\bCA\$|CAD\b/i.test(text) ? "CAD" : undefined,
        releaseFormStatus: cleanStatusValue(valueNearTextLabel(text, "Release Form")),
        titleStatus: cleanStatusValue(valueNearTextLabel(text, "Title Status")),
        inspectionStatus: cleanStatusValue(valueNearTextLabel(text, "Inspection")),
        transportStatus: cleanStatusValue(valueNearTextLabel(text, "Transport")),
      }),
    });
  }

  function extractPostSaleOutcome(text, classification) {
    if (classification.pageType !== "post_sale") return {};
    const soldPriceCandidate = moneyNearLabel(text, "Sold Price") || moneyNearLabel(text, "Post Sale Amount");
    const counterOfferAmount = moneyNearLabel(text, "Counter Offer Amount") || moneyNearLabel(text, "Counter Offer") || moneyNearLabel(text, "Counteroffer");
    const acceptedAmount = moneyNearLabel(text, "Accepted Amount") || moneyNearLabel(text, "Accepted Offer");
    const negotiationStatus = extractNegotiationStatus(text);
    const isVerified = classification.captureKind === "verified_outcome" && /accepted|paid|completed|finalized|purchase confirmed/i.test(negotiationStatus || text);
    const negotiatedAmount = isVerified ? acceptedAmount || moneyNearLabel(text, "Negotiated Amount") : undefined;
    const finalBidAmount = isVerified ? negotiatedAmount || soldPriceCandidate : undefined;
    const priceSemantics = soldPriceCandidate || counterOfferAmount || acceptedAmount || negotiatedAmount || finalBidAmount ? compact({
      soldPriceCandidate: soldPriceCandidate ? "candidate_wholesale_label" : undefined,
      counterOfferAmount: counterOfferAmount ? "candidate_wholesale_label" : undefined,
      acceptedAmount: acceptedAmount ? (isVerified ? "verified_wholesale_label" : "candidate_wholesale_label") : undefined,
      negotiatedAmount: negotiatedAmount ? "verified_wholesale_label" : undefined,
      finalBidAmount: finalBidAmount ? "verified_wholesale_label" : undefined,
    }) : undefined;
    const warnings = [];
    if (soldPriceCandidate && !isVerified) {
      warnings.push("Post-sale sold price is not accepted, paid, completed, or user-confirmed; keep it out of training labels.");
    }
    return compact({
      soldPriceCandidate,
      counterOfferAmount,
      acceptedAmount,
      negotiatedAmount,
      finalBidAmount,
      negotiationStatus,
      negotiatedAt: extractDateNearNegotiation(text),
      acceptedAt: isVerified ? extractDateNearNegotiation(text) : undefined,
      priceSemantics,
      warnings,
      metadata: compact({
        negotiationStatus,
        soldPriceCandidate,
        counterOfferAmount,
        acceptedAmount,
        negotiatedAmount,
        finalBidAmount,
        negotiatedAt: extractDateNearNegotiation(text),
        acceptedAt: isVerified ? extractDateNearNegotiation(text) : undefined,
        trainingStatus: isVerified ? "eligible_verified_outcome" : "candidate_only_do_not_train",
      }),
    });
  }

  function extractNegotiationStatus(text) {
    const labelStatus = cleanStatusValue(valueNearTextLabel(text, "Status"));
    if (labelStatus) return labelStatus;
    if (/\bseller accepted\b|\baccepted\b/i.test(text)) return "Accepted";
    if (/\brejected\b/i.test(text)) return "Rejected";
    if (/\bpending\b|\bawaiting\b/i.test(text)) return "Pending";
    if (/\bcounter offer\b/i.test(text)) return "Counter Offer";
    if (/\bpaid\b/i.test(text)) return "Paid";
    if (/\bcompleted\b|\bfinalized\b/i.test(text)) return "Completed";
    return undefined;
  }

  function extractDateNearNegotiation(text) {
    return String(text || "").match(/\b(?:on\s+)?((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+(?:19|20)\d{2})\b/i)?.[1];
  }

  function splitAnnouncements(value) {
    return normalizeSpace(value || "").split(/\s*[•|;]\s*|\n+/).map((item) => item.trim()).filter(Boolean).slice(0, 30);
  }

  function addPhoto(photos, photo, href) {
    const url = absoluteUrl(photo.url, href);
    if (!url || (photo.source === "link" && !looksLikeImage(url))) return;
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

  function extractMediaCounts(text) {
    return compact({
      photoCount: numberFrom(String(text).match(/\b(\d{1,3})[ \t]+(?:total|photos?|images?)\b/i)?.[1]),
      videoCount: numberFrom(String(text).match(/\b(\d{1,3})[ \t]+videos?\b/i)?.[1]),
    });
  }

  function countNearLabel(text, labelPattern) {
    return numberFrom(String(text).match(new RegExp(`\\b(\\d{1,3})\\s+${labelPattern}\\b`, "i"))?.[1]);
  }

  function evidenceSnippet(text, regex, matchedLabel) {
    const match = String(text || "").match(regex);
    if (!match) return undefined;
    const index = Math.max(0, match.index ?? 0);
    return compact({ matchedLabel, sourceText: String(text).slice(index, index + 180).trim() });
  }

  function extractAttributeText(html) {
    return Array.from(String(html || "").matchAll(/\s(?:aria-label|data-[a-z0-9_-]+|title|alt)=["']([^"']+)["']/gi))
      .map((match) => match[1])
      .join("\n");
  }

  function moneyNearLabel(text, label) {
    const regex = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[:\\n]?\\s*([^\\n]*(?:\\n[^\\n]*){0,3})`, "ig");
    for (const match of String(text || "").matchAll(regex)) {
      const money = moneyFrom(match[1]?.match(/(?:CA\$|CAD)?\s*\$\s?[\d,]+(?:\.\d{2})?|\bCAD\s*[\d,]+(?:\.\d{2})?/i)?.[0]);
      if (money) return money;
    }
    return moneyFrom(valueNearTextLabel(text, label));
  }

  function valueNearTextLabel(text, label) {
    const match = String(text || "").match(new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[:\\n]?\\s*([^\\n]{1,160})`, "i"));
    return normalizeSpace(match?.[1] || "");
  }

  function cleanSellerName(value) {
    return normalizeSpace(value || "").replace(/^(dealer|seller|consignor)\s*:\s*/i, "") || undefined;
  }

  function cleanStatusValue(value) {
    return normalizeSpace(value || "").replace(/^(status|title status|release form|inspection|transport)\s*:\s*/i, "") || undefined;
  }

  function absoluteUrl(value, href) {
    if (!value) return undefined;
    try {
      return new URL(String(value), href).href;
    } catch {
      return undefined;
    }
  }

  function safeCurrentHref() {
    return typeof location !== "undefined" ? location.href : "https://www.openlane.ca/";
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

  function mergeObjects(...objects) {
    const merged = compact(Object.assign({}, ...objects.filter(Boolean)));
    return Object.keys(merged).length ? merged : undefined;
  }

  const api = {
    extractOpenLaneListing,
    extractOpenLaneFixture,
    classifyOpenLanePage,
    isOpenLaneVehiclePage,
    isLikelyOpenLaneVehiclePage,
    extractVisibleText,
    extractLabelValueMap,
    extractMoneyByLabels,
    extractMileage,
    extractVin,
    extractYearMakeModelTrim,
    extractCarfaxLink,
    extractPhotos,
    extractVideos,
    normalizeAbsoluteUrl,
    dedupeMedia,
    calculateExtractionConfidence,
    buildMissingData,
  };
  root.DealerFlowOpenLaneExtractor = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
