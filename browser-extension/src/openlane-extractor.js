(function (root) {
  const RAW_TEXT_LIMIT = 12000;
  const OPENLANE_LABELS = {
    vin: ["VIN", "Vehicle Identification Number"],
    mileageKm: ["Mileage", "Odometer", "Odomètre", "Odometre", "Kilometers"],
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
    trim: ["Trim"],
    currentBid: ["Current Bid", "Top Bid", "Mise actuelle", "Bid"],
    currentOffer: ["Current Offer", "Offer", "My Offer", "Offre actuelle"],
    bestOffer: ["Best Offer", "Meilleure offre"],
    buyNowPrice: ["Buy Now", "Buy It Now"],
    reservePrice: ["Reserve", "Reserve Price"],
    titleStatus: ["Title", "Title Status"],
    tireCondition: ["Tires", "Tire Condition"],
    keysAvailable: ["Keys", "Keys Available"],
  };

  function extractOpenLaneListing(doc = document, href = location.href, options = {}) {
    const textRegions = extractTextRegions(doc);
    const rawVisibleText = textRegions.allText;
    const mainVisibleText = textRegions.mainText || rawVisibleText;
    const classification = classifyOpenLanePage(doc, href);
    const labelValues = extractLabelValueMap(doc, mainVisibleText);
    const titleResult = bestTitle(doc, mainVisibleText);
    const title = titleResult.title;
    const decodedTitle = extractYearMakeModelTrim(title || mainVisibleText);
    const vinResult = extractBestVin(doc, rawVisibleText, mainVisibleText, href);
    const mileageResult = extractBestMileage(doc, mainVisibleText, rawVisibleText, labelValues);
    const media = options.includeMediaUrls === false ? { photos: [], videos: [] } : extractMedia(doc, href);
    const mediaRejected = [...(media.rejected || []), ...(doc.__openlaneMediaRejected || [])];
    const mediaCounts = extractMediaCounts(mainVisibleText);
    const carfax = extractCarfaxInfo(doc, href, rawVisibleText);
    const conditionDetails = extractConditionDetails(textRegions.sectionMap, mainVisibleText, labelValues);
    const conditionReportText = [conditionDetails.conditionReportText, extractConditionText(mainVisibleText, labelValues)].filter(Boolean).join(" | ") || undefined;
    const purchaseEconomics = extractPurchaseEconomics(mainVisibleText, classification);
    const postSaleOutcome = extractPostSaleOutcome(mainVisibleText, classification);
    const isPurchaseOutcomePage = ["fee_details", "purchase_detail", "purchase_info", "purchase_list", "post_sale"].includes(classification.pageType);
    const currentBid = isPurchaseOutcomePage ? undefined : extractMoneyByLabels(labelValues, OPENLANE_LABELS.currentBid);
    const currentOffer = isPurchaseOutcomePage ? undefined : extractMoneyByLabels(labelValues, OPENLANE_LABELS.currentOffer);
    const bestOffer = isPurchaseOutcomePage ? undefined : extractMoneyByLabels(labelValues, OPENLANE_LABELS.bestOffer);
    const buyNowPrice = isPurchaseOutcomePage ? undefined : extractMoneyByLabels(labelValues, OPENLANE_LABELS.buyNowPrice);
    const listedPrice = isPurchaseOutcomePage ? undefined : buyNowPrice || currentBid || currentOffer || bestOffer || moneyFrom(mainVisibleText.match(moneyRegex())?.[0]);
    const mileageKm = mileageResult.mileageKm;
    const vin = vinResult.vin;
    const province = provinceFrom(firstLabel(labelValues, OPENLANE_LABELS.location) || mainVisibleText);
    const disclosureText = findDisclosureText(mainVisibleText);
    const declarations = conditionDetails.knownHistoryItems || splitAnnouncements(labelValues.get("declarations") || findSectionText(mainVisibleText, "Declarations") || disclosureText);
    const damageAnnouncements = conditionDetails.exteriorDisclosures || splitAnnouncements(findSectionText(mainVisibleText, "Damage"));
    const mechanicalAnnouncements = conditionDetails.mechanicalDisclosures || splitAnnouncements(findSectionText(mainVisibleText, "Mechanical"));
    const structuralAnnouncements = conditionDetails.safetyDisclosures || splitAnnouncements(findSectionText(mainVisibleText, "Structural"));
    const odometerAnnouncements = splitAnnouncements(findSectionText(mainVisibleText, "Odometer"));
    const disclosureCount = countNearLabel(mainVisibleText, "disclosures?");
    const warnings = [];
    const missingData = [];

    const listing = {
      sourceName: "OpenLane",
      sourceType: "auction",
      marketType: "auction_market",
      pageType: classification.pageType,
      captureKind: classification.captureKind,
      outcomeConfidence: classification.outcomeConfidence,
      outcomeEvidence: [...classificationEvidence(classification), ...(purchaseEconomics.outcomeEvidence || []), ...(postSaleOutcome.outcomeEvidence || [])],
      listingUrl: href,
      capturedAt: new Date().toISOString(),
      title,
      year: decodedTitle.year,
      make: decodedTitle.make,
      model: decodedTitle.model,
      trim: decodedTitle.trim || firstLabel(labelValues, OPENLANE_LABELS.trim) || extractTrim(mainVisibleText),
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
      currentOffer,
      bestOffer,
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
      safetyDisclosures: conditionDetails.safetyDisclosures,
      interiorAnnouncements: conditionDetails.interiorDisclosures,
      odometerAnnouncements,
      tireCondition: conditionDetails.tireWheelDisclosures?.join(" | ") || firstLabel(labelValues, OPENLANE_LABELS.tireCondition),
      keysAvailable: firstLabel(labelValues, OPENLANE_LABELS.keysAvailable),
      carfaxMentioned: carfax.carfaxMentioned,
      carfaxUrl: carfax.carfaxUrl,
      carfaxAvailable: carfax.carfaxAvailable,
      carfaxUrlStatus: carfax.carfaxUrlStatus,
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
        textRegions: {
          mainTextSample: mainVisibleText.slice(0, 800),
          ignoredSidebarSample: textRegions.sidebarText?.slice(0, 400),
          ignoredFooterSample: textRegions.footerText?.slice(0, 300),
          ignoredMarketGuideSample: textRegions.marketGuideText?.slice(0, 300),
        },
        sectionMapSummary: summarizeSectionMapForDebug(textRegions.sectionMap),
        mediaFiltering: { rejected: mediaRejected },
        carfaxEvidence: carfax.carfaxEvidence,
        conditionDetails,
        dealerNotes: conditionDetails.dealerNotes,
        purchaseStatus: purchaseEconomics.purchaseStatus,
        purchaseEconomics: purchaseEconomics.metadata,
        negotiation: postSaleOutcome.metadata,
      },
      extractedFields: {
        ...Object.fromEntries(labelValues.entries()),
        classification,
        carfaxEvidence: carfax.carfaxEvidence,
        vinEvidence: vinResult.evidence,
        mileageEvidence: mileageResult.evidence,
        debug: {
          classifierDecision: classification,
          decisiveEvidence: classification.decisiveEvidence || [],
          ignoredEvidence: classification.ignoredEvidence || [],
          titleCandidates: titleResult.candidates,
          vinCandidates: vinResult.candidates,
          mileageCandidates: mileageResult.candidates,
          candidateScores: titleResult.candidates,
          priceCandidates: purchaseEconomics.priceCandidates || [],
          mediaRejected,
          mainTextSample: mainVisibleText.slice(0, 800),
        },
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
    return root.DealerFlowOpenLaneExtractionContract?.applyOpenLaneExtractionContract?.(compact(listing)) || compact(listing);
  }

  function isOpenLaneVehiclePage(doc = document, href = location.href) {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();
    if (!host.includes("openlane.")) return false;
    if (!isSupportedOpenLaneCapturePath(url.pathname)) return false;
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

  function isSupportedOpenLaneCapturePath(pathname) {
    return /\/(?:vdp|vehicle|purchases?|post-sale)(?:\/|$)/i.test(String(pathname || ""));
  }

  function summarizeSectionMapForDebug(sectionMap) {
    if (!sectionMap) return undefined;
    return {
      isVdpUrl: Boolean(sectionMap.isVdpUrl),
      summary: sectionMap.summary || {},
      ignoredEvidence: (sectionMap.ignoredEvidence || []).slice(0, 8),
      zoneEvidence: Object.fromEntries(Object.entries(sectionMap.zones || {}).map(([name, zone]) => [name, {
        ignored: Boolean(zone?.ignored),
        textLength: zone?.text?.length || 0,
        evidence: (zone?.evidence || []).slice(0, 3),
      }])),
    };
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
    const textRegions = extractHtmlTextRegions(html);
    const text = textRegions.allText;
    const media = extractMediaFromHtml(html, href);
    const fakeDoc = {
      title: text.match(/\b(19|20)\d{2}[^\n<]{3,120}/)?.[0] || "OpenLane vehicle",
      body: { innerText: text, textContent: text },
      images: media.photos.map((photo) => ({ src: photo.url, alt: photo.alt || "", width: photo.width, height: photo.height })),
      __openlaneHtml: html,
      __openlaneTextRegions: textRegions,
      __openlaneMediaRejected: media.rejected || [],
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
      carfaxUrlStatus: listing.carfaxUrlStatus || (html.match(/href=["']([^"']*carfax[^"']*)["']/i) ? "url_found" : /carfax/i.test(html) ? "text_only" : "missing"),
    };
  }

  function extractVisibleText(doc = document) {
    return extractTextRegions(doc).allText.slice(0, RAW_TEXT_LIMIT);
  }

  function extractTextRegions(doc = document) {
    if (doc.__openlaneTextRegions) return doc.__openlaneTextRegions;
    const classifierRegions = root.DealerFlowOpenLanePageClassifier?.extractDocumentRegions?.(doc);
    if (classifierRegions) return classifierRegions;
    const allText = normalizeSpace(doc.body?.innerText || doc.body?.textContent || "").slice(0, RAW_TEXT_LIMIT);
    return { allText, mainText: allText, sidebarText: "", footerText: "", marketGuideText: "" };
  }

  function extractHtmlTextRegions(html) {
    const classifierRegions = root.DealerFlowOpenLanePageClassifier?.extractHtmlRegions?.(html);
    if (classifierRegions) return classifierRegions;
    const text = `${stripTags(html)}\n${extractAttributeText(html)}`;
    return { allText: text, mainText: text, sidebarText: "", footerText: "", marketGuideText: "" };
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
    const candidates = [];
    const addCandidate = (value, source, weight = 0) => {
      if (!value) return;
      candidates.push({ text: value, source, weight });
    };
    const sectionMap = doc.__openlaneTextRegions?.sectionMap || doc.__openlaneSectionMap;
    const heroZoneText = sectionMap?.zones?.vehicleHero?.text || "";
    for (const match of heroZoneText.matchAll(/\b(19|20)\d{2}[^\n]{3,100}/g)) {
      addCandidate(match[0], "section-map:vehicleHero", 95);
    }
    const h1 = normalizeSpace(doc.querySelector?.("h1")?.innerText || "");
    addCandidate(h1, "h1", 35);
    const testTitle = normalizeSpace(doc.querySelector?.("[data-testid*='title' i]")?.innerText || "");
    addCandidate(testTitle, "data-testid-title", 70);
    for (const match of String(doc.__openlaneHtml || "").matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)) {
      addCandidate(stripTags(match[1]), "html-h1", 35);
    }
    for (const match of String(doc.__openlaneHtml || "").matchAll(/<h[2-3]\b[^>]*>([\s\S]*?\b(19|20)\d{2}[\s\S]*?)<\/h[2-3]>/gi)) {
      addCandidate(stripTags(match[1]), "html-heading", 60);
    }
    const heroText = String(doc.__openlaneHtml || "").match(/<(?:section|div)\b[^>]*(?:vehicle-hero|vehicle-header|data-testid=["'][^"']*vehicle)[^>]*>[\s\S]{0,1200}?<\/(?:section|div)>/i)?.[0];
    const heroTitle = stripTags(heroText || "").match(/\b(19|20)\d{2}[^\n]{3,90}/)?.[0];
    addCandidate(heroTitle, "hero", 90);
    const docTitle = normalizeSpace(doc.title || "");
    addCandidate(docTitle, "document-title", 25);
    const ignoredTitleText = [
      doc.__openlaneTextRegions?.marketGuideText,
      doc.__openlaneTextRegions?.footerText,
    ].filter(Boolean).join("\n");
    for (const match of ignoredTitleText.matchAll(/[^\n]*(Sales history of similar vehicles|Market overview|OPENLANE wholesale sales data|Subscribe now|Other conditions)[^\n]*/gi)) {
      addCandidate(match[0], "ignored-region", -80);
    }
    for (const match of String(text || "").matchAll(/\b(19|20)\d{2}[^\n]{3,100}/g)) {
      addCandidate(match[0], "visible-text", 20);
    }

    const evaluated = candidates.map((candidate) => {
      const clean = cleanTitleCandidate(candidate.text);
      const rejectedReason = rejectedTitleReason(clean);
      return { ...candidate, text: clean, rejectedReason, score: rejectedReason ? -100 + (candidate.weight || 0) : scoreTitleCandidate(clean, candidate) };
    }).filter((candidate) => candidate.text);
    const accepted = evaluated
      .filter((candidate) => !candidate.rejectedReason && /\b(19|20)\d{2}\b/.test(candidate.text))
      .sort((a, b) => b.score - a.score)[0];
    return { title: accepted?.text || "OpenLane vehicle", candidates: evaluated.slice(0, 12) };
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

  function cleanTitleCandidate(value) {
    return normalizeSpace(String(value || "")
      .replace(/\bVIN\b.*$/i, "")
      .replace(/\bOdometer\b.*$/i, "")
      .replace(/\b(front|rear|side|left|right|interior|exterior|avant|arriere|arrière)\b\.?$/i, ""));
  }

  function rejectedTitleReason(value) {
    if (!value) return "empty";
    if (/\b(Sales history of similar vehicles|Historique des ventes|Market overview|OPENLANE wholesale sales data|Subscribe now|Other conditions|legal footer)\b/i.test(value)) return "non_vehicle_market_or_footer_text";
    if (/\b(launched|encan d[eé]marr[eé])\b/i.test(value)) return "auction_status_text";
    if (/\b(19|20)\d{2}\s+(?:a|à|at)?\s*\d{1,2}:\d{2}\s*(?:am|pm)?\b/i.test(value)) return "auction_datetime";
    if (!/\b(19|20)\d{2}\b/.test(value)) return "missing_year";
    if (value.split(/\s+/).length < 3) return "too_short";
    return "";
  }

  function scoreTitleCandidate(value, candidate) {
    const decoded = parseTitle(value);
    let score = candidate.weight || 0;
    if (decoded.year) score += 15;
    if (decoded.make && /^[A-Z][A-Za-z-]+$/.test(decoded.make)) score += 14;
    if (decoded.model && /^[A-Za-z0-9][A-Za-z0-9-]+$/.test(decoded.model)) score += 12;
    if (decoded.trim) score += Math.min(12, decoded.trim.split(/\s+/).length * 3);
    if (/\b(VIN|NIV|odometer|odom[eè]tre|mileage|km)\b/i.test(candidate.text || "")) score += 8;
    if (/section-map:vehicleHero|hero|vehicle/i.test(candidate.source || "")) score += 20;
    if (/ignored-region|document-title/i.test(candidate.source || "")) score -= 25;
    return score;
  }

  function extractMileage(value) {
    const text = String(value || "");
    const match = text.match(/(?:odometer|odom[eè]tre|mileage|kilometers|kilometres)?\D*([\d,.\s]+)\s?(km|kilometres|kilometers)\b/i);
    return match ? numberFrom(match[1]) : undefined;
  }

  function extractBestMileage(doc, mainText, rawText, labelValues) {
    const candidates = [];
    const sectionMap = doc.__openlaneTextRegions?.sectionMap || doc.__openlaneSectionMap;
    addMileageCandidates(candidates, "label_value", firstLabel(labelValues, OPENLANE_LABELS.mileageKm), 80);
    addMileageCandidates(candidates, "section-map:vehicleSpecs", sectionMap?.zones?.vehicleSpecs?.text, 75);
    addMileageCandidates(candidates, "section-map:vehicleHero", sectionMap?.zones?.vehicleHero?.text, 55);
    addMileageCandidates(candidates, "main_text", mainText, 35);
    addMileageCandidates(candidates, "visible_text", rawText, 10);
    for (const node of Array.from(doc.querySelectorAll?.("[aria-label], [title], [data-testid], [data-mileage], [data-odometer]") || [])) {
      const attrs = ["aria-label", "title", "data-testid", "data-mileage", "data-odometer"].map((name) => node.getAttribute?.(name)).filter(Boolean).join(" ");
      addMileageCandidates(candidates, "dom_attributes", attrs, 65);
      addMileageCandidates(candidates, "dom_text", `${node.innerText || ""} ${node.textContent || ""}`, 55);
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates.find((candidate) => !candidate.rejectedReason);
    return {
      mileageKm: chosen?.mileageKm,
      evidence: chosen ? { matchedLabel: chosen.source, sourceText: chosen.sourceText, score: chosen.score } : undefined,
      candidates: candidates.slice(0, 12),
    };
  }

  function addMileageCandidates(candidates, source, value, weight = 0) {
    const text = String(value || "");
    if (!text) return;
    const regex = /(?:odometer|odom[eè]tre|mileage|kilometers|kilometres)?[^\d\n]{0,35}([\d][\d,.\s]{1,12})\s?(km|kilometres|kilometers)\b/gi;
    for (const match of text.matchAll(regex)) {
      const mileageKm = numberFrom(match[1]);
      if (!Number.isFinite(mileageKm)) continue;
      const sourceText = snippetAround(text, match[0]);
      const hasLabel = /\b(odometer|odom[eè]tre|mileage|kilometers|kilometres)\b/i.test(sourceText);
      const rejectionReason = mileageRejectionReason(sourceText, source);
      candidates.push({
        mileageKm,
        source,
        sourceText,
        rejectedReason: rejectionReason,
        score: weight + (hasLabel ? 18 : 0) + vehicleMileageContextBonus(sourceText, source) + (mileageKm > 0 ? 4 : 0) - (rejectionReason ? 120 : 0),
      });
    }
  }

  function mileageRejectionReason(sourceText, source = "") {
    const text = `${source || ""} ${sourceText || ""}`;
    if (/\b(transport|delivery|pickup|distance|estimate|shipping|livraison|ramassage)\b/i.test(text)) return "transport_distance_not_vehicle_odometer";
    if (/\bCAD\b|\$\s*\d[\d,. ]*\s*\/\s*\d[\d,. ]*\s*km\b/i.test(text)) return "rate_or_price_per_distance_not_vehicle_odometer";
    if (/\bper\s*km\b|\/\s*km\b/i.test(text)) return "per_km_rate_not_vehicle_odometer";
    return "";
  }

  function vehicleMileageContextBonus(sourceText, source = "") {
    const text = `${source || ""} ${sourceText || ""}`;
    let score = 0;
    if (/\b(odometer|odom[eÃ¨]tre|mileage|kilometers|kilometres)\b/i.test(text)) score += 24;
    if (/\b(vehicle information|vehicle details|specs?|specifications)\b/i.test(text)) score += 18;
    if (/vehicleSpecs|vehicleHero|label_value|data-odometer|data-mileage/i.test(source)) score += 16;
    return score;
  }

  function extractVin(value) {
    return vinFrom(value);
  }

  function extractBestVin(doc, rawText, mainText, href = safeCurrentHref()) {
    const candidates = [];
    const addCandidates = (source, value, weight = 0) => {
      const raw = String(value || "");
      if (!raw) return;
      const barcode = raw.match(/\bVIN\b[^\n|:;]{0,40}\bbarcode\b|\bbarcode\b[^\n|:;]{0,40}\bVIN\b/i);
      if (barcode) {
        candidates.push({ source, sourceText: snippetAround(raw, barcode[0]), weight: -100, rejectedReason: "vin_barcode_label_not_identifier" });
      }
      for (const match of raw.toUpperCase().matchAll(/\b[A-Z0-9]{17}\b/g)) {
        const candidate = match[0];
        const sourceText = snippetAround(raw, candidate);
        const rejectedReason = rejectedVinReason(candidate, sourceText);
        const score = rejectedReason ? -100 + weight : weight;
        candidates.push({ vin: rejectedReason ? undefined : candidate, candidate, source, sourceText, weight: score, score, rejectedReason });
      }
    };
    addCandidates("url", href, 95);
    addCandidates("main_text", mainText, 40);
    addCandidates("visible_text", rawText, 10);
    addCandidates("label_value", firstLabel(extractLabelValueMap(doc, mainText), OPENLANE_LABELS.vin), 55);
    for (const node of Array.from(doc.querySelectorAll?.("[data-vin], [aria-label], [data-testid], [title], button, [role='button']") || [])) {
      const attrs = ["data-vin", "aria-label", "data-testid", "title"].map((name) => node.getAttribute?.(name)).filter(Boolean).join(" ");
      addCandidates("dom_attributes", attrs, /data-vin/i.test(attrs) ? 90 : 70);
      addCandidates("dom_text", `${node.innerText || ""} ${node.textContent || ""}`, 60);
      for (const attribute of Array.from(node.attributes || [])) {
        if (attribute.name.startsWith("data-")) addCandidates(`attribute:${attribute.name}`, attribute.value, 65);
      }
    }
    const sectionMap = doc.__openlaneTextRegions?.sectionMap || doc.__openlaneSectionMap;
    addCandidates("safe_dom_attributes", extractSafeDomAttributeText(doc), 85);
    addCandidates("section-map:vehicleHero", sectionMap?.zones?.vehicleHero?.text, 50);
    addCandidates("section-map:vehicleSpecs", sectionMap?.zones?.vehicleSpecs?.text, 45);
    addCandidates("html_attributes", extractAttributeText(doc.__openlaneHtml || ""), 75);
    candidates.sort((a, b) => b.weight - a.weight);
    const chosen = candidates.find((candidate) => !candidate.rejectedReason && candidate.vin);
    return {
      vin: chosen?.vin,
      evidence: chosen ? { matchedLabel: chosen.source, sourceText: chosen.sourceText } : undefined,
      candidates: candidates.slice(0, 12),
    };
  }

  function rejectedVinReason(candidate, sourceText = "") {
    if (!candidate) return "empty_vin_candidate";
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(candidate)) return "invalid_vin_characters_or_length";
    if (/\b(no additional information|not available|unknown)\b/i.test(sourceText)) return "non_identifier_label_text";
    return "";
  }

  function extractMoneyByLabels(labels, labelNames = []) {
    const values = labels instanceof Map ? labels : new Map(Object.entries(labels || {}));
    const searchLabels = labelNames.length ? labelNames : [
      ...OPENLANE_LABELS.buyNowPrice,
      ...OPENLANE_LABELS.currentBid,
      ...OPENLANE_LABELS.currentOffer,
      ...OPENLANE_LABELS.bestOffer,
      ...OPENLANE_LABELS.reservePrice,
    ];
    return moneyFrom(firstLabel(values, searchLabels));
  }

  function extractCarfaxLink(doc = document, href = safeCurrentHref()) {
    return extractCarfaxInfo(doc, href, extractVisibleText(doc)).carfaxUrl;
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
    const rejected = [];
    for (const img of Array.from(doc.images || [])) {
      const src = img.currentSrc || img.src || img.getAttribute?.("data-src") || img.getAttribute?.("data-original");
      addPhoto(photos, { url: src, thumbnailUrl: img.src || src, alt: img.alt, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, source: "img" }, href, rejected);
      for (const candidate of parseSrcset(img.srcset || img.getAttribute?.("srcset"))) addPhoto(photos, { url: candidate, thumbnailUrl: img.src || src, alt: img.alt, source: "srcset" }, href, rejected);
    }
    for (const source of Array.from(doc.querySelectorAll?.("picture source[srcset]") || [])) {
      for (const candidate of parseSrcset(source.getAttribute("srcset"))) addPhoto(photos, { url: candidate, source: "picture" }, href, rejected);
    }
    for (const node of Array.from(doc.querySelectorAll?.("[style*='background']") || [])) {
      const style = node.getAttribute("style") || "";
      const match = style.match(/url\((['"]?)(.*?)\1\)/i);
      if (match?.[2]) addPhoto(photos, { url: match[2], alt: normalizeSpace(node.getAttribute("aria-label") || ""), source: "background-image" }, href, rejected);
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
      if (looksLikeImage(url)) addPhoto(photos, { url, alt: normalizeSpace(link.innerText || link.getAttribute("aria-label") || ""), source: "link" }, href, rejected);
      if (looksLikeVideo(url)) addVideo(videos, { url, title: normalizeSpace(link.innerText || link.getAttribute("title") || ""), type: link.tagName?.toLowerCase() === "iframe" ? "iframe" : undefined, source: link.tagName?.toLowerCase() === "iframe" ? "iframe" : "link" }, href);
    }
    return { photos: dedupeByUrl(photos).slice(0, 80), videos: dedupeByUrl(videos).slice(0, 20), rejected };
  }

  function extractMediaFromHtml(html, href) {
    const photos = [];
    const videos = [];
    const rejected = [];
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const src = attr(match[0], "src") || attr(match[0], "currentSrc") || attr(match[0], "data-src") || attr(match[0], "data-original");
      addPhoto(photos, { url: src, thumbnailUrl: src, alt: attr(match[0], "alt"), width: numberFrom(attr(match[0], "width")), height: numberFrom(attr(match[0], "height")), source: "img" }, href, rejected);
      for (const candidate of parseSrcset(attr(match[0], "srcset"))) addPhoto(photos, { url: candidate, alt: attr(match[0], "alt"), source: "srcset" }, href, rejected);
    }
    for (const match of html.matchAll(/<source\b[^>]*srcset=["']([^"']+)["'][^>]*>/gi)) {
      for (const candidate of parseSrcset(match[1])) addPhoto(photos, { url: candidate, source: "picture" }, href, rejected);
    }
    for (const match of html.matchAll(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/gi)) {
      addPhoto(photos, { url: match[2], source: "background-image" }, href, rejected);
    }
    for (const match of html.matchAll(/<(video|source|iframe)\b[^>]*>/gi)) {
      const tag = match[1].toLowerCase();
      const url = attr(match[0], "src");
      if (url && (tag === "video" || tag === "source" || looksLikeVideo(url))) addVideo(videos, { url, posterUrl: attr(match[0], "poster"), title: attr(match[0], "title"), type: attr(match[0], "type") || tag, source: tag === "iframe" ? "iframe" : tag }, href);
    }
    for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
      if (looksLikeImage(match[1])) addPhoto(photos, { url: match[1], source: "link" }, href, rejected);
      if (looksLikeVideo(match[1])) addVideo(videos, { url: match[1], source: "link" }, href);
    }
    return { photos: dedupeByUrl(photos).slice(0, 80), videos: dedupeByUrl(videos).slice(0, 20), rejected };
  }

  function extractCarfaxInfo(doc, href, text = "") {
    const candidates = [];
    const add = (source, value) => {
      const raw = String(value || "");
      if (!/carfax/i.test(raw)) return;
      candidates.push({ source, text: raw.slice(0, 240), url: carfaxUrlCandidate(raw) });
    };
    for (const link of Array.from(doc.querySelectorAll?.("a[href]") || [])) {
      add("link", `${link.getAttribute("href")} ${link.innerText || ""} ${link.getAttribute("aria-label") || ""} ${link.getAttribute("title") || ""}`);
    }
    for (const node of Array.from(doc.querySelectorAll?.("[aria-label], [title], [data-href], [data-url], button, [role='button']") || [])) {
      add("dom_attribute", [
        node.getAttribute?.("aria-label"),
        node.getAttribute?.("title"),
        node.getAttribute?.("data-href"),
        node.getAttribute?.("data-url"),
        node.getAttribute?.("onclick"),
        node.innerText,
        node.textContent,
      ].filter(Boolean).join(" "));
    }
    add("safe_dom_attributes", extractSafeDomAttributeText(doc));
    for (const evidence of extractCarfaxEvidenceFromHtml(doc.__openlaneHtml || "")) add("html_node", evidence);
    add("html_attributes", extractAttributeText(doc.__openlaneHtml || ""));
    add("visible_text", text);
    const withUrl = candidates.find((candidate) => candidate.url);
    const carfaxUrl = withUrl ? absoluteUrl(withUrl.url, href) : undefined;
    const carfaxMentioned = candidates.length > 0 || /carfax/i.test(text);
    return {
      carfaxMentioned,
      carfaxAvailable: Boolean(carfaxUrl || carfaxMentioned),
      carfaxUrl,
      carfaxUrlStatus: carfaxUrl ? "url_found" : carfaxMentioned ? "text_only" : "missing",
      carfaxEvidence: candidates.slice(0, 8),
    };
  }

  function carfaxUrlCandidate(value) {
    const raw = String(value || "");
    const absolute = raw.match(/https?:\/\/[^\s"'<>)]*(?:carfax|report|history)[^\s"'<>)]*/i)?.[0];
    if (absolute && /\.(?:svg|png|jpe?g|webp|avif|css|js)(?:$|[?#])/i.test(absolute)) return undefined;
    if (absolute) return absolute;
    const relative = raw.match(/\/[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]*(?:carfax|report|history)[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]*/i)?.[0];
    if (relative && !/\.(?:svg|png|jpe?g|webp|avif|css|js)(?:$|[?#])/i.test(relative)) return relative;
    return undefined;
  }

  function extractCarfaxEvidenceFromHtml(html) {
    const evidence = [];
    for (const match of String(html || "").matchAll(/<([a-z][a-z0-9-]*)\b[^>]*(?:carfax|href=|data-href=|data-url=|onclick=)[^>]*>(?:[\s\S]*?<\/\1>)?/gi)) {
      const source = match[0];
      if (/carfax/i.test(source)) evidence.push(`${source.match(/<[^>]+>/)?.[0] || ""} ${stripTags(source)}`.slice(0, 500));
    }
    return evidence;
  }

  function extractConditionDetails(sectionMap, text, labels) {
    const zones = sectionMap?.zones || {};
    const knownHistoryText = zones.knownHistory?.text || findSectionByHeadings(text, ["Known history", "Antécédents connus", "Antecedents connus"]);
    const disclosureText = zones.disclosuresCondition?.text || findSectionByHeadings(text, ["Disclosures and conditions", "Disclosures", "Divulgations et condition"]);
    const dealerNotes = cleanConditionSection(zones.dealerNotes?.text || findSectionByHeadings(text, ["Note from selling dealer", "Note du concessionnaire vendeur", "Dealer notes"]));
    const qaSummary = cleanConditionSection(zones.qaSection?.text || findSectionByHeadings(text, ["Q and A", "Q&A", "Q et R"]));
    const sellerBroadcasts = cleanConditionSection(findSectionByHeadings(text, ["Seller broadcasts", "Broadcasts", "Messages du vendeur"]));
    const knownHistoryItems = conditionItems(knownHistoryText, ["Known history", "Antécédents connus", "Antecedents connus"]);
    const safetyDisclosures = conditionItems(subsectionText(disclosureText, ["In relation to safety", "En relation avec la sécurité", "En relation avec la securite"]));
    const mechanicalDisclosures = conditionItems(subsectionText(disclosureText, ["Mechanical", "Mécanique", "Mecanique"]));
    const exteriorDisclosures = conditionItems(subsectionText(disclosureText, ["Exterior", "Extérieur", "Exterieur"]));
    const interiorDisclosures = conditionItems(subsectionText(disclosureText, ["Interior", "Intérieur", "Interieur"]));
    const tireWheelDisclosures = conditionItems(subsectionText(disclosureText, ["Tires and wheels", "Pneus et roues"]));
    const obd2Text = subsectionText(disclosureText, ["OBD2 Reader", "Lecteur OBD2"]);
    const obd2Status = obd2Text ? (/nothing reported|rien n.a été signalé|rien n.a ete signale/i.test(obd2Text) ? "nothing_reported" : /non disponible|not available|not visible|unavailable/i.test(obd2Text) ? "not_visible" : "visible_text") : undefined;
    const fallbackDeclarations = conditionItems(labels.get("declarations"));
    const allConditionText = [
      knownHistoryItems.length ? `Known history: ${knownHistoryItems.join(" | ")}` : "",
      safetyDisclosures.length ? `Safety: ${safetyDisclosures.join(" | ")}` : "",
      mechanicalDisclosures.length ? `Mechanical: ${mechanicalDisclosures.join(" | ")}` : "",
      exteriorDisclosures.length ? `Exterior: ${exteriorDisclosures.join(" | ")}` : "",
      interiorDisclosures.length ? `Interior: ${interiorDisclosures.join(" | ")}` : "",
      tireWheelDisclosures.length ? `Tires and wheels: ${tireWheelDisclosures.join(" | ")}` : "",
      obd2Text ? `OBD2 Reader: ${cleanConditionSection(obd2Text)}` : "",
      dealerNotes ? `Dealer notes: ${dealerNotes}` : "",
      sellerBroadcasts ? `Seller broadcasts: ${sellerBroadcasts}` : "",
      qaSummary ? `Q and A: ${qaSummary}` : "",
      fallbackDeclarations.length ? `Declarations: ${fallbackDeclarations.join(" | ")}` : "",
    ].filter(Boolean).join(" | ").slice(0, 4000);
    const highRiskTerms = highRiskConditionTerms(allConditionText);
    const evidence = [
      knownHistoryText ? { source: "known_history_zone", sourceText: cleanConditionSection(knownHistoryText).slice(0, 500) } : undefined,
      disclosureText ? { source: "disclosures_condition_zone", sourceText: cleanConditionSection(disclosureText).slice(0, 800) } : undefined,
      dealerNotes ? { source: "dealer_notes_zone", sourceText: dealerNotes.slice(0, 500) } : undefined,
      qaSummary ? { source: "qa_zone", sourceText: qaSummary.slice(0, 500) } : undefined,
    ].filter(Boolean);

    return compact({
      knownHistoryItems: knownHistoryItems.length ? knownHistoryItems : fallbackDeclarations.length ? fallbackDeclarations : undefined,
      safetyDisclosures,
      mechanicalDisclosures,
      exteriorDisclosures,
      interiorDisclosures,
      tireWheelDisclosures,
      obd2Status,
      dealerNotes,
      sellerBroadcasts,
      qaSummary,
      conditionReportText: allConditionText || undefined,
      highRiskTerms,
      evidence,
    });
  }

  function findSectionByHeadings(text, headings) {
    for (const heading of headings) {
      const found = findSectionText(text, heading);
      if (found) return `${heading}\n${found}`;
    }
    return "";
  }

  function subsectionText(text, headings) {
    const source = String(text || "");
    const headingPattern = headings.map(escapeRegExp).join("|");
    const nextHeading = [
      "Known history", "Antécédents connus", "Disclosures and conditions", "Divulgations et condition",
      "In relation to safety", "En relation avec la sécurité", "Mechanical", "Mécanique", "Exterior", "Extérieur",
      "Interior", "Intérieur", "Tires and wheels", "Pneus et roues", "OBD2 Reader", "Lecteur OBD2",
      "Note from selling dealer", "Note du concessionnaire vendeur", "Q and A", "Q et R",
    ].map(escapeRegExp).join("|");
    const match = source.match(new RegExp(`(?:^|\\n)\\s*(?:${headingPattern})\\s*[:\\n]?\\s*([\\s\\S]{0,1200}?)(?=\\n\\s*(?:${nextHeading})\\b|$)`, "i"));
    return cleanConditionSection(match?.[1] || "");
  }

  function conditionItems(text, headingsToRemove = []) {
    const headingSet = new Set(headingsToRemove.map((heading) => normalizeSpace(heading).toLowerCase()));
    return cleanConditionSection(text)
      .split(/\n|\s+\|\s+/)
      .map((line) => normalizeSpace(line.replace(/^[-•]\s*/, "")))
      .filter((line) => line && !headingSet.has(line.toLowerCase()))
      .slice(0, 30);
  }

  function cleanConditionSection(text) {
    return normalizeSpace(String(text || "").replace(/\r/g, "\n"));
  }

  function highRiskConditionTerms(text) {
    const riskTerms = ["engine", "moteur", "transmission", "accident", "cracked windshield", "pare-brise", "rust", "rouille", "structural", "structurel", "check engine", "salvage", "rebuilt"];
    return riskTerms.filter((term) => new RegExp(escapeRegExp(term), "i").test(text));
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
    const priceCandidates = [];
    const buyPriceAuction = moneyNearLabel(text, "Buy price - auction", priceCandidates) || moneyNearLabel(text, "Selling price", priceCandidates);
    const transactionFee = moneyNearLabel(text, "Transaction Fee");
    const vehicleHistoryFee = moneyNearLabel(text, "Vehicle history - auction") || moneyNearLabel(text, "Vehicle History Fee");
    const subtotal = moneyNearLabel(text, "Subtotal");
    const taxes = moneyNearLabel(text, "Taxes");
    const totalInvoiceAmount = moneyNearLabel(text, "Total invoice") || moneyNearLabel(text, "Invoice total") || (classification.pageType === "fee_details" ? moneyNearLabel(text, "Total") : undefined);
    const finalAcquisitionCost = totalInvoiceAmount;
    const purchaseStatus = cleanStatusValue(valueNearTextLabel(text, "Status"));
    const verifiedWholesale = /\b(retrieved|paid|final|finalized|completed|purchase confirmed)\b/i.test(`${purchaseStatus || ""} ${text}`);
    const sellingPriceEvidence = buyPriceAuction ? purchaseEvidenceSnippet(text, "Selling price") || purchaseEvidenceSnippet(text, "Buy price - auction") : undefined;
    const priceSemantics = buyPriceAuction || transactionFee || vehicleHistoryFee || subtotal || taxes || totalInvoiceAmount ? compact({
      buyPriceAuction: buyPriceAuction ? (verifiedWholesale ? "verified_wholesale_label" : "candidate_wholesale_label") : undefined,
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
      outcomeEvidence: sellingPriceEvidence ? [{
        evidenceType: verifiedWholesale ? "purchase_document" : "visible_page_text",
        sourceText: sellingPriceEvidence,
        capturedAt: new Date().toISOString(),
        confidenceScore: classification.confidenceScore,
      }] : undefined,
      priceCandidates,
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

  function addPhoto(photos, photo, href, rejected = []) {
    const url = absoluteUrl(photo.url, href);
    const rejection = mediaRejectionReason(url, photo);
    if (!url || (photo.source === "link" && !looksLikeImage(url)) || rejection) {
      rejected.push({ url: url || String(photo.url || ""), reason: rejection || "not_image" });
      return;
    }
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

  function mediaRejectionReason(url, photo = {}) {
    const value = String(url || "");
    if (/^data:/i.test(value)) return "embedded_media_blob";
    if (!value || /\bnull\b|undefined/i.test(value) || /\/vdp\/null(?:$|[?#])/i.test(value)) return "null_or_placeholder";
    if (/\.svg(?:$|[?#])/i.test(value)) return "svg_ui_asset";
    if (/openlane-logo|favicon|icon|sprite|fonts\.gstatic\.com|translate/i.test(value)) return "ui_logo_icon";
    const width = Number(photo.width || 0);
    const height = Number(photo.height || 0);
    if (width && height && (width < 80 || height < 80) && !/pub-us\.kar-media\.com|kar-media|vehicle/i.test(value)) return "tiny_ui_asset";
    return "";
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

  function snippetAround(text, needle) {
    const value = String(text || "");
    const index = value.toUpperCase().indexOf(String(needle || "").toUpperCase());
    if (index < 0) return value.slice(0, 180);
    return value.slice(Math.max(0, index - 60), index + String(needle || "").length + 80).trim();
  }

  function extractTrim(text) {
    return normalizeSpace(String(text || "").match(/\bTrim\s*[:\n]?\s*([^\n]{2,80})/i)?.[1] || String(text || "").match(/\b(4dr\s+Sdn\.?|2dr\s+Coupe|Crew Cab|Extended Cab)[^\n]*/i)?.[0] || "") || undefined;
  }

  function extractAttributeText(html) {
    return Array.from(String(html || "").matchAll(/\s(?:aria-label|data-[a-z0-9_-]+|title|alt)=(["'])([\s\S]{0,1000}?)\1/gi))
      .map((match) => match[2])
      .join("\n");
  }

  function extractSafeDomAttributeText(doc = document) {
    const parts = [];
    for (const node of Array.from(doc.querySelectorAll?.("[data-vin], [data-vehicle], [data-testid], [aria-label], [title], button, [role='button']") || []).slice(0, 250)) {
      for (const attribute of Array.from(node.attributes || [])) {
        if (!isVehicleRelevantAttribute(attribute.name, attribute.value)) continue;
        parts.push(`${attribute.name}=${String(attribute.value || "").slice(0, 500)}`);
      }
      const text = normalizeSpace(`${node.innerText || ""} ${node.textContent || ""}`);
      if (text && !isSensitiveText(text)) parts.push(text.slice(0, 500));
    }
    const html = String(doc.__openlaneHtml || "");
    for (const match of html.matchAll(/\s([a-z0-9:_-]+)=(["'])([\s\S]{0,1000}?)\2/gi)) {
      const [, name, , value] = match;
      if (isVehicleRelevantAttribute(name, value)) parts.push(`${name}=${value.slice(0, 500)}`);
      if (parts.length >= 250) break;
    }
    return parts.join("\n").slice(0, 4000);
  }

  function isVehicleRelevantAttribute(name = "", value = "") {
    const key = String(name || "");
    const text = String(value || "");
    if (isSensitiveText(`${key} ${text}`)) return false;
    return /(^data-vin$|^data-vehicle$|vin|vehicle|vdp|listing|carfax|history|aria-label|title|data-testid)/i.test(key)
      || /\b[A-HJ-NPR-Z0-9]{17}\b/i.test(text);
  }

  function isSensitiveText(value = "") {
    return /\b(auth|authorization|cookie|token|secret|credential|session|password|csrf|jwt|bearer)\b/i.test(String(value || ""));
  }

  function moneyNearLabel(text, label, candidates) {
    const regex = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[:\\n]?\\s*([^\\n]*(?:\\n[^\\n]*){0,3})`, "ig");
    for (const match of String(text || "").matchAll(regex)) {
      const sourceText = normalizeSpace(`${label} ${match[1] || ""}`).slice(0, 240);
      const money = moneyFrom(match[1]?.match(moneyRegex())?.[0]);
      if (money) {
        candidates?.push({ label, value: money, sourceText });
        return money;
      }
    }
    const fallback = moneyFrom(valueNearTextLabel(text, label));
    if (fallback) candidates?.push({ label, value: fallback, sourceText: normalizeSpace(`${label} ${valueNearTextLabel(text, label)}`) });
    return fallback;
  }

  function purchaseEvidenceSnippet(text, label) {
    const match = String(text || "").match(new RegExp(`${escapeRegExp(label)}[\\s\\S]{0,160}`, "i"));
    if (!match) return undefined;
    return normalizeSpace(match[0]).replace(/\s+(Release Form|Title Status|Inspection|Transport)\b[\s\S]*$/i, "").slice(0, 300);
  }

  function moneyRegex() {
    return /(?:CA\$|CAD|\$)\s*[\d][\d,.\s]*(?:\.\d{2})?|\b[\d][\d,.\s]*(?:\.\d{2})?\s*\$|\bCAD\s*[\d,]+(?:\.\d{2})?/i;
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
