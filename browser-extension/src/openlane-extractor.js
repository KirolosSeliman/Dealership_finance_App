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
    const scopedLabelValues = buildScopedLabelValues(textRegions);
    const titleResult = bestTitle(doc, mainVisibleText);
    const title = titleResult.title;
    const decodedTitle = extractYearMakeModelTrim(title || mainVisibleText);
    const vinResult = extractBestVin(doc, rawVisibleText, mainVisibleText, href);
    const mileageResult = extractBestMileage(doc, mainVisibleText, rawVisibleText, labelValues);
    const media = options.includeMediaUrls === false ? { photos: [], videos: [] } : extractMedia(doc, href);
    const mediaRejected = [...(media.rejected || []), ...(doc.__openlaneMediaRejected || [])];
    const mediaCounts = extractMediaCounts(mainVisibleText);
    const carfax = extractCarfaxInfo(doc, href, rawVisibleText);
    const conditionDetails = extractConditionDetails(textRegions.sectionMap, mainVisibleText, scopedLabelValues.condition);
    const fallbackConditionReportText = hasCanonicalConditionSections(conditionDetails) ? "" : extractConditionText(mainVisibleText, scopedLabelValues.condition);
    const conditionReportText = [conditionDetails.conditionReportText, fallbackConditionReportText].filter(Boolean).join(" | ") || undefined;
    const purchaseEconomics = extractPurchaseEconomics(mainVisibleText, classification, textRegions.sectionMap, options.networkEvidence);
    const postSaleOutcome = extractPostSaleOutcome(mainVisibleText, classification);
    const isPurchaseOutcomePage = ["fee_details", "purchase_detail", "purchase_info", "purchase_list", "post_sale"].includes(classification.pageType);
    const currentBidResult = isPurchaseOutcomePage ? { value: undefined, candidates: [] } : extractCurrentBidFromBidPanel(textRegions, doc, {
      labelValues: scopedLabelValues.price,
      mainText: mainVisibleText,
      networkEvidence: options.networkEvidence,
    });
    const currentBid = currentBidResult.value;
    const currentOffer = isPurchaseOutcomePage ? undefined : extractMoneyByLabels(scopedLabelValues.price, OPENLANE_LABELS.currentOffer);
    const bestOffer = isPurchaseOutcomePage ? undefined : extractMoneyByLabels(scopedLabelValues.price, OPENLANE_LABELS.bestOffer);
    const buyNowPrice = isPurchaseOutcomePage ? undefined : extractMoneyByLabels(scopedLabelValues.price, OPENLANE_LABELS.buyNowPrice);
    const listedPriceResult = isPurchaseOutcomePage ? { value: undefined, semantic: undefined } : resolveActiveListedPrice({
      buyNowPrice,
      currentBid,
      currentBidEvidence: currentBidResult.evidence,
    });
    const listedPrice = listedPriceResult.value;
    const observationPriceSemantics = isPurchaseOutcomePage ? undefined : compact({
      currentBid: currentBid ? "observation" : undefined,
      currentOffer: currentOffer ? "observation" : undefined,
      bestOffer: bestOffer ? "observation" : undefined,
      buyNowPrice: buyNowPrice ? "observation" : undefined,
      listedPrice: listedPriceResult.semantic,
    });
    const mileageKm = mileageResult.mileageKm;
    const vin = vinResult.vin;
    const location = firstCanonicalLabel(scopedLabelValues.business, labelValues, OPENLANE_LABELS.location, "location", { allowFallback: true });
    const province = provinceFrom(location || mainVisibleText);
    const disclosureText = findDisclosureText(mainVisibleText);
    const declarations = conditionDetails.knownHistoryItems || conditionItems(labelValues.get("declarations") || findSectionText(mainVisibleText, "Declarations") || disclosureText);
    const damageAnnouncements = conditionDetails.exteriorDisclosures || conditionItems(findSectionText(mainVisibleText, "Damage"));
    const mechanicalAnnouncements = conditionDetails.mechanicalDisclosures || conditionItems(findSectionText(mainVisibleText, "Mechanical"));
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
      trim: decodedTitle.trim || firstCanonicalLabel(scopedLabelValues.specs, labelValues, OPENLANE_LABELS.trim, "trim", { allowFallback: true }) || extractTrim(mainVisibleText),
      vin,
      mileageKm,
      exteriorColor: firstCanonicalLabel(scopedLabelValues.specs, labelValues, OPENLANE_LABELS.exteriorColor, "exteriorColor", { allowFallback: true }),
      interiorColor: firstCanonicalLabel(scopedLabelValues.specs, labelValues, OPENLANE_LABELS.interiorColor, "interiorColor", { allowFallback: true }),
      drivetrain: firstCanonicalLabel(scopedLabelValues.specs, labelValues, OPENLANE_LABELS.drivetrain, "drivetrain", { allowFallback: true }),
      transmission: firstCanonicalLabel(scopedLabelValues.specs, labelValues, OPENLANE_LABELS.transmission, "transmission"),
      engine: firstCanonicalLabel(scopedLabelValues.specs, labelValues, OPENLANE_LABELS.engine, "engine"),
      fuelType: firstCanonicalLabel(scopedLabelValues.specs, labelValues, OPENLANE_LABELS.fuelType, "fuelType", { allowFallback: true }),
      bodyStyle: firstCanonicalLabel(scopedLabelValues.specs, labelValues, OPENLANE_LABELS.bodyStyle, "bodyStyle", { allowFallback: true }),
      doors: numberFrom(firstCanonicalLabel(scopedLabelValues.specs, labelValues, OPENLANE_LABELS.doors, "doors", { allowFallback: true })),
      cylinders: numberFrom(firstCanonicalLabel(scopedLabelValues.specs, labelValues, OPENLANE_LABELS.cylinders, "cylinders", { allowFallback: true })),
      location,
      province,
      sellerName: cleanSellerName(firstCanonicalLabel(scopedLabelValues.business, labelValues, OPENLANE_LABELS.sellerName, "sellerName")),
      sellerType: "auction",
      auctionStatus: purchaseEconomics.purchaseStatus || postSaleOutcome.negotiationStatus || firstCanonicalLabel(scopedLabelValues.business, labelValues, OPENLANE_LABELS.auctionStatus, "auctionStatus"),
      saleDate: firstCanonicalLabel(scopedLabelValues.business, labelValues, OPENLANE_LABELS.saleDate, "saleDate", { allowFallback: true }),
      runNumber: firstCanonicalLabel(scopedLabelValues.business, labelValues, OPENLANE_LABELS.runNumber, "runNumber", { allowFallback: true }),
      lane: firstCanonicalLabel(scopedLabelValues.business, labelValues, OPENLANE_LABELS.lane, "lane"),
      lotNumber: firstCanonicalLabel(scopedLabelValues.business, labelValues, OPENLANE_LABELS.lotNumber, "lotNumber", { allowFallback: true }),
      stockNumber: firstCanonicalLabel(scopedLabelValues.business, labelValues, OPENLANE_LABELS.stockNumber, "stockNumber"),
      listedPrice,
      currentBid,
      currentOffer,
      bestOffer,
      buyNowPrice,
      soldPriceCandidate: postSaleOutcome.soldPriceCandidate || purchaseEconomics.soldPriceCandidate,
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
      priceSemantics: mergeObjects(observationPriceSemantics, postSaleOutcome.priceSemantics, purchaseEconomics.priceSemantics),
      fieldEvidence: compact({
        currentBid: currentBidResult.evidence ? [currentBidResult.evidence] : undefined,
        ...(purchaseEconomics.fieldEvidence || {}),
      }),
      reservePrice: moneyFrom(firstLabel(labelValues, OPENLANE_LABELS.reservePrice)),
      estimatedAuctionFees: estimateAuctionFees(listedPrice),
      titleStatus: cleanStatusValue(firstCanonicalLabel(scopedLabelValues.condition, labelValues, OPENLANE_LABELS.titleStatus, "titleStatus", { allowFallback: true })),
      declarations,
      conditionReportText,
      damageAnnouncements,
      mechanicalAnnouncements,
      structuralAnnouncements,
      safetyDisclosures: conditionDetails.safetyDisclosures,
      interiorAnnouncements: conditionDetails.interiorDisclosures,
      odometerAnnouncements,
      tireCondition: conditionDetails.tireWheelDisclosures?.join(" | ") || conditionItems(firstCanonicalLabel(scopedLabelValues.condition, labelValues, OPENLANE_LABELS.tireCondition, "tireCondition", { allowFallback: true })).join(" | ") || undefined,
      keysAvailable: firstCanonicalLabel(scopedLabelValues.specs, labelValues, OPENLANE_LABELS.keysAvailable, "keysAvailable", { allowFallback: true }),
      carfaxMentioned: carfax.carfaxMentioned,
      carfaxUrl: carfax.carfaxUrl,
      carfaxAvailable: carfax.carfaxAvailable,
      carfaxActionable: carfax.carfaxActionable,
      carfaxAvailableLegacy: carfax.carfaxAvailableLegacy,
      carfaxUrlStatus: carfax.carfaxUrlStatus,
      carfax: carfax.carfax,
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
        carfaxDiagnostics: carfax.carfaxDiagnostics,
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
        currentBidEvidence: currentBidResult.evidence,
        debug: {
          classifierDecision: classification,
          decisiveEvidence: classification.decisiveEvidence || [],
          ignoredEvidence: classification.ignoredEvidence || [],
          titleCandidates: titleResult.candidates,
          vinCandidates: vinResult.candidates,
          mileageCandidates: mileageResult.candidates,
          candidateScores: titleResult.candidates,
          priceCandidates: [...(currentBidResult.candidates || []), ...(purchaseEconomics.priceCandidates || []), ...(postSaleOutcome.priceCandidates || [])],
          rejectedPurchaseOutcomeCandidates: purchaseEconomics.rejectedCandidates,
          rejectedOutcomePriceCandidates: purchaseEconomics.rejectedCandidates,
          purchaseEvidenceSource: purchaseEconomics.purchaseEvidenceSource,
          lowerBidCandidates: currentBidResult.lowerBidCandidates,
          staleCurrentBidCandidates: currentBidResult.staleCurrentBidCandidates,
          currentBidDiagnostics: currentBidResult.diagnostics,
          listedPriceDecision: listedPriceResult.decision,
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
      carfaxUrl: listing.carfaxUrl,
      carfaxAvailable: Boolean(listing.carfaxActionable || listing.carfaxUrl),
      carfaxUrlStatus: listing.carfaxUrlStatus || (/carfax/i.test(html) ? "text_only" : "missing"),
    };
  }

  function extractVisibleText(doc = document) {
    return extractTextRegions(doc).allText.slice(0, RAW_TEXT_LIMIT);
  }

  function extractTextRegions(doc = document) {
    if (doc.__openlaneTextRegions) return doc.__openlaneTextRegions;
    const classifierRegions = root.DealerFlowOpenLanePageClassifier?.extractDocumentRegions?.(doc);
    if (classifierRegions) return classifierRegions;
    const sectionMap = root.DealerFlowOpenLaneSectionMap?.buildOpenLaneSectionMap?.(doc);
    if (sectionMap) return root.DealerFlowOpenLaneSectionMap.regionsFromMap(sectionMap);
    const allText = normalizeSpace(doc.body?.innerText || doc.body?.textContent || "").slice(0, RAW_TEXT_LIMIT);
    return { allText, mainText: allText, sidebarText: "", footerText: "", marketGuideText: "" };
  }

  function extractHtmlTextRegions(html) {
    const classifierRegions = root.DealerFlowOpenLanePageClassifier?.extractHtmlRegions?.(html);
    if (classifierRegions) return classifierRegions;
    const sectionMap = root.DealerFlowOpenLaneSectionMap?.buildOpenLaneSectionMapFromHtml?.(html);
    if (sectionMap) return root.DealerFlowOpenLaneSectionMap.regionsFromMap(sectionMap);
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

  function buildScopedLabelValues(textRegions = {}) {
    const zones = textRegions.sectionMap?.zones || {};
    return {
      specs: extractLabelValuesFromText(zoneText(zones, ["vehicleHero", "vehicleSpecs"])),
      business: extractLabelValuesFromText(zoneText(zones, ["vehicleHero", "vehicleSpecs", "bidPanel", "purchasePanel", "feeDetailsPanel", "postSalePanel"])),
      price: extractLabelValuesFromText(zoneText(zones, ["bidPanel", "purchasePanel", "postSalePanel", "feeDetailsPanel"])),
      condition: extractLabelValuesFromText(zoneText(zones, ["knownHistory", "disclosuresCondition", "dealerNotes"])),
    };
  }

  function extractLabelValuesFromText(text = "") {
    const values = new Map();
    for (const [field, labels] of Object.entries(OPENLANE_LABELS)) {
      const value = labels.map((label) => valueNearTextLabel(text, label)).find(Boolean);
      if (value) values.set(field, value);
    }
    const declarations = findSectionText(text, "Declarations");
    if (declarations) values.set("declarations", declarations);
    return values;
  }

  function zoneText(zones = {}, names = []) {
    return normalizeSpace(names.map((name) => zones[name]?.text).filter(Boolean).join("\n"));
  }

  function firstCanonicalLabel(scopedValues, fallbackValues, labels, field, options = {}) {
    const scoped = cleanCanonicalValue(field, firstLabel(scopedValues, labels));
    if (scoped) return scoped;
    if (!options.allowFallback) return undefined;
    return cleanCanonicalValue(field, firstLabel(fallbackValues, labels));
  }

  function cleanCanonicalValue(field, value) {
    const text = normalizeSpace(value || "");
    if (!text || isForbiddenCanonicalValue(field, text)) return undefined;
    return text;
  }

  function isForbiddenCanonicalValue(field, value) {
    const text = normalizeSpace(value);
    if (["doors", "cylinders"].includes(field) && !/\d/.test(text)) return true;
    if (/\b(Q&A|Q&amp;A|Q and A|Questions? and answers?|Broadcasts?|Ownership|No questions asked yet|Ask a question|Terms? & conditions|OPENLANE wholesale|wholesale data|BUYING|SELLING|UNLESS STATED OTHERWISE)\b/i.test(text)) return true;
    if (/\b(transport|transport direct|rate info|delivery|pickup|shipping|estimate)\b/i.test(text)) return true;
    if (["engine", "transmission"].includes(field) && /\?|thanks\b|^and\s+\w+/i.test(text)) return true;
    if (field === "sellerName" && /^(Q&A|Questions?|Seller name)$/i.test(text)) return true;
    if (field === "auctionStatus" && /^(Ownership|Q&A|Broadcasts?)$/i.test(text)) return true;
    if (field === "lane" && (text.length > 12 || /\b(wholesale|data|past \d+ days|unless|openlane|montreal|toronto|qc|on)\b/i.test(text))) return true;
    if (field === "stockNumber" && /seller name|q&a|ownership/i.test(text)) return true;
    return false;
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
    const clean = title.replace(/\b(19|20)\d{2}\b/, "").replace(/[|,]/g, " ").trim();
    const words = clean.split(/\s+/).filter(Boolean);
    const knownModel = matchKnownModel(words[0], words.slice(1));
    return {
      year: Number.isFinite(year) ? year : undefined,
      make: words[0],
      model: knownModel?.model || words[1],
      trim: knownModel ? knownModel.trim : (words.slice(2, 7).join(" ") || undefined),
    };
  }

  const KNOWN_MODELS_BY_MAKE = {
    Hyundai: ["Santa Fe Sport", "Santa Fe"],
    Honda: ["Accord"],
    Mazda: ["Mazda3"],
    Kia: ["Stinger", "Forte"],
    "Mercedes-Benz": ["G-Class"],
    Nissan: ["Frontier", "Titan"],
    Toyota: ["Camry Hybrid", "Camry"],
  };

  function matchKnownModel(make, modelWords = []) {
    const models = KNOWN_MODELS_BY_MAKE[canonicalMake(make)] || [];
    for (const model of models) {
      const modelParts = model.split(/\s+/);
      const candidate = modelWords.slice(0, modelParts.length).join(" ");
      if (candidate.toLowerCase() !== model.toLowerCase()) continue;
      return {
        model,
        trim: modelWords.slice(modelParts.length, modelParts.length + 5).join(" ") || undefined,
      };
    }
    return undefined;
  }

  function canonicalMake(make) {
    const text = String(make || "").toLowerCase();
    return Object.keys(KNOWN_MODELS_BY_MAKE).find((item) => item.toLowerCase() === text) || "";
  }

  function extractYearMakeModelTrim(value, vinDecodedIdentity) {
    return mergeVinDecodedIdentity(parseTitle(String(value || "")), vinDecodedIdentity);
  }

  function mergeVinDecodedIdentity(parsed = {}, vinDecodedIdentity = {}) {
    if (!vinDecodedIdentity || typeof vinDecodedIdentity !== "object") return parsed;
    const decoded = {
      make: cleanDecodedIdentityText(vinDecodedIdentity.make),
      model: cleanDecodedIdentityText(vinDecodedIdentity.model),
      trim: cleanDecodedIdentityText(vinDecodedIdentity.trim),
    };
    return {
      ...parsed,
      make: decoded.make || parsed.make,
      model: decoded.model || parsed.model,
      trim: parsed.trim || decoded.trim || undefined,
    };
  }

  function cleanDecodedIdentityText(value) {
    const text = normalizeSpace(String(value || ""));
    if (!text || /[<>{}]|javascript:|\[redacted/i.test(text)) return "";
    return text.slice(0, 80);
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
    addCandidates("explicit_dom_attribute", extractExplicitVinAttributeText(doc), 94);
    addCandidates("header_vin_chip", extractHeaderVinChipText(doc), 92);
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
    addCandidates("copy_button", extractCopyVinButtonText(doc), 82);
    addCandidates("url", href, 72);
    addCandidates("label_value", firstLabel(extractLabelValueMap(doc, mainText), OPENLANE_LABELS.vin), 68);
    addCandidates("section-map:vehicleHero", sectionMap?.zones?.vehicleHero?.text, 50);
    addCandidates("section-map:vehicleSpecs", sectionMap?.zones?.vehicleSpecs?.text, 45);
    addCandidates("html_attributes", extractAttributeText(doc.__openlaneHtml || ""), 75);
    addCandidates("main_text", mainText, 40);
    addCandidates("visible_text", rawText, 10);
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
    if (/^(SIMULCASTPROLEADS|DISCOUNTAVAILABLE)$/i.test(candidate)) return "ui_token_not_identifier";
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(candidate)) return "invalid_vin_characters_or_length";
    if (/\b(no additional information|not available|unknown)\b/i.test(sourceText)) return "non_identifier_label_text";
    return "";
  }

  function extractExplicitVinAttributeText(doc) {
    const nodes = Array.from(doc.querySelectorAll?.("[data-vin], [data-vehicle], [data-openlane-vehicle], [data-listing], [data-testid], [aria-label], [title]") || []).slice(0, 250);
    return nodes.map((node) => {
      const values = [];
      for (const attribute of Array.from(node.attributes || [])) {
        const name = String(attribute.name || "");
        if (/^(data-vin|data-vehicle|data-openlane-vehicle|data-listing|aria-label|title|data-testid)$/i.test(name) || /vin|vehicle|listing/i.test(name)) {
          values.push(attribute.value);
        }
      }
      return values.join(" ");
    }).filter(Boolean).join("\n");
  }

  function extractHeaderVinChipText(doc) {
    const parts = [];
    const selectors = [
      "header",
      "[class*='vehicle']",
      "[class*='Vehicle']",
      "[class*='hero']",
      "[class*='Hero']",
      "[class*='vin']",
      "[class*='VIN']",
      "[data-testid*='vin']",
      "[data-testid*='VIN']",
    ];
    const nodes = Array.from(doc.querySelectorAll?.(selectors.join(",")) || []).slice(0, 120);
    parts.push(...nodes.map((node) => [
      node.getAttribute?.("data-vin"),
      node.getAttribute?.("aria-label"),
      node.getAttribute?.("title"),
      node.innerText,
      node.textContent,
    ].filter(Boolean).join(" ")).filter((text) => /\b(VIN|NIV)\b|[A-HJ-NPR-Z0-9]{17}/i.test(text)));
    const html = String(doc.__openlaneHtml || "");
    for (const match of html.matchAll(/<(?:header|section|div|span|button)\b[^>]*(?:vin|vehicle|hero|copy)[^>]*>[\s\S]{0,900}?(?:<\/(?:header|section|div|span|button)>|$)/gi)) {
      const text = stripTags(match[0]);
      if (/\b(VIN|NIV)\b|[A-HJ-NPR-Z0-9]{17}/i.test(text)) parts.push(text);
      if (parts.length >= 120) break;
    }
    return parts.join("\n");
  }

  function extractCopyVinButtonText(doc) {
    const nodes = Array.from(doc.querySelectorAll?.("button, [role='button'], [aria-label], [title], [data-testid]") || []).slice(0, 200);
    return nodes.map((node) => [
      node.getAttribute?.("aria-label"),
      node.getAttribute?.("title"),
      node.getAttribute?.("data-testid"),
      node.innerText,
      node.textContent,
    ].filter(Boolean).join(" ")).filter((text) => /\b(copy|clipboard|VIN|NIV)\b/i.test(text)).join("\n");
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

  function extractCurrentBidFromBidPanel(textRegions = {}, doc = document, options = {}) {
    return extractActiveListingCurrentBid({
      sectionMap: textRegions.sectionMap || doc.__openlaneSectionMap || {},
      doc,
      networkEvidence: options.networkEvidence,
      labelValues: options.labelValues,
      mainText: options.mainText,
      footerText: textRegions.footerText,
    });
  }

  function extractOpenLaneCurrentBidOnly(doc = document, href = safeCurrentHref(), options = {}) {
    root.DealerFlowOpenLaneSectionMap?.clearOpenLaneExtractionCache?.(doc);
    const textRegions = extractTextRegions(doc, href);
    const result = extractCurrentBidFromBidPanel(textRegions, doc, {
      mainText: textRegions.mainText,
      networkEvidence: options.networkEvidence,
    });
    return {
      currentBid: result.value,
      evidence: result.evidence,
      candidates: result.candidates,
      lowerBidCandidates: result.lowerBidCandidates,
      staleCurrentBidCandidates: result.staleCurrentBidCandidates,
      diagnostics: result.diagnostics,
    };
  }

  function extractActiveListingCurrentBid({ sectionMap = {}, doc = document, networkEvidence = [], labelValues, mainText, footerText } = {}) {
    const candidates = [];
    const zones = sectionMap.zones || {};
    addNetworkCurrentBidCandidates(candidates, networkEvidence);
    addCurrentBidTextCandidates(candidates, "section-map:activeBidBar", zones.activeBidBar?.text, 98);
    addCurrentBidTextCandidates(candidates, "section-map:bidPanel", zones.bidPanel?.text, 88);
    addCurrentBidTextCandidates(candidates, "section-map:purchasePanel", zones.purchasePanel?.text, 76);
    addCurrentBidTextCandidates(candidates, "section-map:footer", footerText, 52);
    addCurrentBidDomCandidates(candidates, doc);
    addCurrentBidLabelValueCandidates(candidates, labelValues);
    addCurrentBidTextCandidates(candidates, "visible_text", mainText, 36);
    const accepted = selectCurrentBidCandidate(candidates);
    const lowerBidCandidates = identifyLowerBidCandidates(candidates, accepted);
    const staleCurrentBidCandidates = identifyStaleCurrentBidCandidates(candidates, accepted);
    return {
      value: accepted?.value,
      evidence: accepted ? {
        field: "currentBid",
        value: accepted.value,
        normalizedValue: accepted.value,
        sourceType: accepted.sourceType,
        sourceName: accepted.sourceName,
        sourceText: accepted.sourceText,
        endpointPattern: accepted.endpointPattern,
        confidenceScore: accepted.confidenceScore,
        selectionScore: accepted.selectionScore,
        selectionReason: accepted.selectionReason,
        supersededCandidate: accepted.supersededCandidate,
        recencyText: accepted.recencyText,
        freshnessScore: accepted.freshnessScore,
        isStale: accepted.isStale,
        capturedAt: accepted.capturedAt || new Date().toISOString(),
      } : undefined,
      lowerBidCandidates,
      staleCurrentBidCandidates,
      diagnostics: {
        winningCurrentBid: accepted?.value,
        winningSourceType: accepted?.sourceType,
        winningSourceName: accepted?.sourceName,
        winningSourceText: accepted?.sourceText,
        winningSelectionScore: accepted ? currentBidSelectionScore(accepted) : undefined,
        selectionReason: accepted?.selectionReason,
        bidPanelTopCandidate: summarizeCurrentBidCandidate(findBestFreshBidPanelCandidate(candidates)),
        freshBidPanelCandidates: candidates.filter(isFreshBidPanelCandidate).sort((a, b) => currentBidSelectionScore(b) - currentBidSelectionScore(a)).slice(0, 4).map(summarizeCurrentBidCandidate),
        supersededActiveBidBarCandidate: accepted?.supersededCandidate,
        candidateCount: candidates.length,
        rejectedCandidateCount: candidates.filter((candidate) => candidate.rejectedReason).length,
        lowerBidCandidateCount: lowerBidCandidates.length,
        staleCurrentBidCandidateCount: staleCurrentBidCandidates.length,
      },
      candidates: candidates
        .sort((a, b) => Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0))
        .slice(0, 16),
    };
  }

  function resolveActiveListedPrice({ buyNowPrice, currentBid, currentBidEvidence } = {}) {
    if (buyNowPrice) {
      return {
        value: buyNowPrice,
        semantic: "observation",
        decision: {
          field: "listedPrice",
          source: "buy_now_price",
          semantics: "observation",
          reason: "explicit_buy_now_price",
        },
      };
    }
    if (currentBid && currentBidEvidence?.sourceText) {
      return {
        value: currentBid,
        semantic: "observation_alias_current_bid",
        decision: {
          field: "listedPrice",
          source: "current_bid",
          semantics: "observation_alias_current_bid",
          reason: "trusted_current_bid_alias_for_active_auction_preview",
          sourceText: currentBidEvidence.sourceText,
        },
      };
    }
    return {
      value: undefined,
      semantic: undefined,
      decision: {
        field: "listedPrice",
        source: "none",
        reason: "no_explicit_buy_now_or_trusted_current_bid",
      },
    };
  }

  function addNetworkCurrentBidCandidates(candidates, evidence = []) {
    const observations = Array.isArray(evidence) ? evidence : [];
    for (const observation of observations) {
      for (const candidate of observation?.candidates?.fieldCandidates || []) {
        if (candidate.field !== "currentBid") continue;
        const value = moneyFrom(candidate.value);
        if (!value) continue;
        candidates.push({
          field: "currentBid",
          value,
          sourceType: "network_json",
          sourceName: candidate.source || "OpenLane network JSON",
          endpointPattern: candidate.endpointPattern || observation.endpointPattern,
          sourceText: normalizeSpace(candidate.sourceText || candidate.source || "currentBid").slice(0, 240),
          confidenceScore: Math.max(Number(candidate.confidence || 0), 94),
          capturedAt: candidate.capturedAt || observation.capturedAt,
        });
      }
    }
  }

  function addCurrentBidDomCandidates(candidates, doc) {
    const selector = [
      "[class*='bid']",
      "[class*='Bid']",
      "[data-testid*='bid']",
      "[data-testid*='Bid']",
      "[aria-label*='bid' i]",
      "[title*='bid' i]",
    ].join(",");
    for (const node of Array.from(doc.querySelectorAll?.(selector) || []).slice(0, 80)) {
      const sourceText = [
        node.getAttribute?.("aria-label"),
        node.getAttribute?.("title"),
        node.getAttribute?.("data-testid"),
        node.innerText,
        node.textContent,
      ].filter(Boolean).join("\n");
      addCurrentBidTextCandidates(candidates, "dom:bidPanel", sourceText, 82);
    }
  }

  function addCurrentBidLabelValueCandidates(candidates, labels) {
    const values = labels instanceof Map ? labels : new Map(Object.entries(labels || {}));
    const value = firstLabel(values, OPENLANE_LABELS.currentBid);
    if (!value) return;
    addCurrentBidCandidate(candidates, {
      value: moneyFrom(value),
      token: value,
      sourceType: "label_value",
      sourceName: "Current bid label",
      sourceText: normalizeSpace(`Current bid ${value}`).slice(0, 240),
      confidenceScore: 60,
    });
  }

  function addCurrentBidTextCandidates(candidates, sourceName, text, baseScore) {
    const source = String(text || "");
    if (!source) return;
    addCurrentBidCounterCandidates(candidates, sourceName, source, baseScore);
    const labelWindows = currentBidLabelWindows(source);
    for (const window of labelWindows) {
      for (const match of parseMoneyCandidateMatches(window.text)) {
        const token = match[0];
        const value = currentBidMoneyFrom(token);
        const tokenIndex = window.start + (match.index || 0);
        const distance = Math.abs(tokenIndex - window.labelIndex);
        const sourceText = /activeBidBar|bidPanel/i.test(sourceName)
          ? normalizeSpace(window.text).slice(0, 240)
          : currentBidCandidateSnippet(source, tokenIndex, token.length);
        addCurrentBidCandidate(candidates, {
          value,
          token,
          relationToLabel: tokenIndex >= window.labelIndex ? "after_label" : "before_label",
          betweenLabelAndToken: source.slice(Math.min(window.labelIndex, tokenIndex), Math.max(window.labelIndex, tokenIndex)),
          sourceType: currentBidSourceType(sourceName),
          sourceName,
          sourceText,
          confidenceScore: baseScore + (tokenIndex >= window.labelIndex ? 7 : 4) + Math.max(0, 6 - Math.floor(distance / 25)),
        });
      }
    }
    if (!labelWindows.length && /\b(current bid|top bid|mise actuelle)\b/i.test(source)) {
      for (const match of parseMoneyCandidateMatches(source)) {
        const token = match[0];
        const tokenIndex = match.index || 0;
        addCurrentBidCandidate(candidates, {
          value: currentBidMoneyFrom(token),
          token,
          sourceType: currentBidSourceType(sourceName),
          sourceName,
          sourceText: currentBidCandidateSnippet(source, tokenIndex, token.length),
          confidenceScore: baseScore,
        });
      }
    }
  }

  function currentBidLabelWindows(text) {
    const windows = [];
    for (const label of OPENLANE_LABELS.currentBid) {
      const regex = new RegExp(`\\b${escapeRegExp(label)}\\b`, "ig");
      for (const match of String(text || "").matchAll(regex)) {
        const labelIndex = match.index || 0;
        const start = Math.max(0, labelIndex - 100);
        const end = Math.min(String(text || "").length, labelIndex + String(match[0]).length + 140);
        windows.push({ text: String(text || "").slice(start, end), start, labelIndex });
      }
    }
    return windows.slice(0, 12);
  }

  function addCurrentBidCounterCandidates(candidates, sourceName, text, baseScore) {
    for (const window of currentBidLabelWindows(text)) {
      const regex = /\b(\d{1,4})\b\s*(bids?|outbid|watchlist|if deals?|photos?|photo|disclosures?|disclosure|videos?|video|total|hours?|mins?|minutes?|days?|page\s*number|auction\s*id|distance|km|features?\s+listed)\b/ig;
      for (const match of window.text.matchAll(regex)) {
        const value = numberFrom(match[1]);
        if (value === undefined) continue;
        candidates.push({
          field: "currentBid",
          value,
          sourceType: currentBidSourceType(sourceName),
          sourceName,
          sourceText: normalizeSpace(match[0]).slice(0, 240),
          confidenceScore: Math.max(1, baseScore - 40),
          rejectedReason: rejectedPriceCounterReason(match[2]),
        });
      }
    }
  }

  function addCurrentBidCandidate(candidates, candidate) {
    if (!candidate.value) return;
    const rejectedReason = currentBidRejectedReason(candidate);
    const freshness = currentBidFreshness(candidate);
    const record = compact({
      field: "currentBid",
      value: candidate.value,
      sourceType: candidate.sourceType,
      sourceName: candidate.sourceName,
      sourceText: normalizeSpace(candidate.sourceText).slice(0, 240),
      recencyText: freshness.recencyText,
      freshnessScore: freshness.freshnessScore,
      isVisible: candidate.sourceType !== "network_json",
      isStale: freshness.isStale,
      endpointPattern: candidate.endpointPattern,
      confidenceScore: rejectedReason ? Math.min(Number(candidate.confidenceScore || 0), 20) : candidate.confidenceScore,
      capturedAt: candidate.capturedAt,
      rejectedReason,
    });
    record.selectionScore = currentBidSelectionScore(record);
    candidates.push(record);
  }

  function selectCurrentBidCandidate(candidates) {
    const valid = candidates
      .filter((candidate) => !candidate.rejectedReason && candidate.value)
      .sort((a, b) => currentBidSelectionScore(b) - currentBidSelectionScore(a)
        || Number(b.value || 0) - Number(a.value || 0));
    const activeBidBar = valid
      .filter(isActiveBidBarCandidate)
      .sort((a, b) => currentBidSelectionScore(b) - currentBidSelectionScore(a)
        || Number(b.value || 0) - Number(a.value || 0))[0];
    const freshBidPanelTop = valid
      .filter(isFreshBidPanelCandidate)
      .sort((a, b) => currentBidSelectionScore(b) - currentBidSelectionScore(a)
        || Number(b.value || 0) - Number(a.value || 0))[0];

    if (activeBidBar && freshBidPanelTop && Number(freshBidPanelTop.value) > Number(activeBidBar.value)) {
      return {
        ...freshBidPanelTop,
        selectionReason: "fresh_bid_panel_supersedes_lower_active_bid_bar",
        supersededCandidate: summarizeCurrentBidCandidate(activeBidBar),
      };
    }

    const accepted = valid[0];
    return accepted ? {
      ...accepted,
      selectionReason: accepted.selectionReason || "highest_scored_current_bid_candidate",
    } : undefined;
  }

  function currentBidSelectionScore(candidate = {}) {
    const sourceType = String(candidate.sourceType || "");
    let score = Number(candidate.confidenceScore || 0) + Number(candidate.freshnessScore || 0);
    if (sourceType === "network_json") score += 12;
    if (isBidPanelSource(candidate)) score += 10;
    if (sourceType === "active_bid_bar" && !candidate.isStale) score += 8;
    if (sourceType === "active_bid_bar" && candidate.isStale) score -= 36;
    return score;
  }

  function currentBidFreshness(candidate = {}) {
    const text = String(candidate.sourceText || "");
    const recencyText = text.match(/\b(under\s+1\s+min|just now|updated now|last refreshed earlier|refreshed earlier|earlier|stale|previous)\b/i)?.[0];
    const isStale = /\b(last refreshed earlier|refreshed earlier|stale|previous|earlier)\b/i.test(text);
    let freshnessScore = 0;
    if (/\b(under\s+1\s+min|just now|updated now)\b/i.test(text)) freshnessScore += 18;
    if (isBidPanelSource(candidate)) freshnessScore += 4;
    if (isStale) freshnessScore -= 32;
    return compact({ recencyText, freshnessScore, isStale });
  }

  function isBidPanelSource(candidate = {}) {
    return /bid[_\s-]?panel|bid[_\s-]?list|bid-list/i.test(`${candidate.sourceType || ""} ${candidate.sourceName || ""}`);
  }

  function isActiveBidBarCandidate(candidate = {}) {
    return String(candidate.sourceType || "") === "active_bid_bar" || /activeBidBar|active[_\s-]?bid[_\s-]?bar/i.test(String(candidate.sourceName || ""));
  }

  function isFreshBidPanelCandidate(candidate = {}) {
    const sourceText = String(candidate.sourceText || "");
    const hasFreshText = /\b(under\s+1\s+min|just now|updated now|\bnow\b|seconds?\s+ago)\b/i.test(sourceText);
    return Boolean(
      candidate.value
      && candidate.isVisible !== false
      && !candidate.isStale
      && isBidPanelSource(candidate)
      && (hasFreshText || Number(candidate.freshnessScore || 0) >= 18)
    );
  }

  function findBestFreshBidPanelCandidate(candidates = []) {
    return candidates
      .filter((candidate) => !candidate.rejectedReason && isFreshBidPanelCandidate(candidate))
      .sort((a, b) => currentBidSelectionScore(b) - currentBidSelectionScore(a)
        || Number(b.value || 0) - Number(a.value || 0))[0];
  }

  function summarizeCurrentBidCandidate(candidate) {
    if (!candidate) return undefined;
    return compact({
      field: "currentBid",
      value: candidate.value,
      sourceType: candidate.sourceType,
      sourceName: candidate.sourceName,
      sourceText: candidate.sourceText,
      recencyText: candidate.recencyText,
      confidenceScore: candidate.confidenceScore,
      selectionScore: candidate.selectionScore ?? currentBidSelectionScore(candidate),
      freshnessScore: candidate.freshnessScore,
      rejectedReason: candidate.rejectedReason,
    });
  }

  function identifyLowerBidCandidates(candidates, accepted) {
    if (!accepted?.value) return [];
    return dedupeCurrentBidCandidates(candidates
      .filter((candidate) => (!candidate.rejectedReason || candidate.rejectedReason === "lower_bid_history_candidate") && candidate.value && candidate.value < accepted.value)
      .map((candidate) => ({
        field: "currentBid",
        value: candidate.value,
        sourceType: candidate.sourceType,
        sourceName: candidate.sourceName,
        sourceText: candidate.sourceText,
        confidenceScore: candidate.confidenceScore,
        rejectedReason: candidate.rejectedReason === "lower_bid_history_candidate" || candidate.sourceType === "visible_text" || /history|bidder/i.test(`${candidate.sourceName || ""} ${candidate.sourceText || ""}`)
          ? "lower_bid_history_candidate"
          : "lower_current_bid_candidate",
      })))
      .slice(0, 8);
  }

  function identifyStaleCurrentBidCandidates(candidates, accepted) {
    if (!accepted?.value) return [];
    return dedupeCurrentBidCandidates(candidates
      .filter((candidate) => !candidate.rejectedReason && candidate.value && candidate !== accepted)
      .filter((candidate) => Number(candidate.value) !== Number(accepted.value))
      .filter((candidate) => candidate.isStale || (candidate.sourceType === "active_bid_bar" && Number(candidate.value) < Number(accepted.value)))
      .map((candidate) => ({
        field: "currentBid",
        value: candidate.value,
        sourceType: candidate.sourceType,
        sourceName: candidate.sourceName,
        sourceText: candidate.sourceText,
        recencyText: candidate.recencyText,
        confidenceScore: candidate.confidenceScore,
        selectionScore: candidate.selectionScore,
        freshnessScore: candidate.freshnessScore,
        rejectedReason: "stale_current_bid_candidate",
      })))
      .slice(0, 8);
  }

  function dedupeCurrentBidCandidates(candidates) {
    const seen = new Set();
    return candidates.filter((candidate) => {
      const key = `${candidate.value}|${candidate.sourceType}|${candidate.sourceText}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function currentBidRejectedReason(candidate) {
    if (candidate.sourceType === "network_json") return "";
    const token = String(candidate.token || "");
    const sourceText = String(candidate.sourceText || "");
    if (!hasMoneyMarker(token) && isRejectedPriceCounterContext(sourceText)) return "bid_count_not_money";
    if (!hasMoneyMarker(`${token} ${sourceText}`)) return "missing_money_context";
    if (isTransportPriceContext(sourceText)) return "transport_or_distance_not_current_bid";
    if (/\b(buy now|buy it now)\b/i.test(candidate.betweenLabelAndToken || "")) return "buy_now_not_current_bid";
    if (/\b(full bid history|bid history|bidder)\b/i.test(candidate.betweenLabelAndToken || "")) return "lower_bid_history_candidate";
    if (/\b(reserve|sold price|selling price|invoice total|subtotal|taxes|fees?)\b/i.test(sourceText)
      && !/\b(current bid|top bid|mise actuelle)\b/i.test(sourceText)) {
      return "non_current_bid_price_context";
    }
    return "";
  }

  function hasMoneyMarker(value) {
    return /(?:CA\$|CAD|\$|\d[\d,.\s]*\$)/i.test(String(value || ""));
  }

  function hasCounterPriceContext(value) {
    return /\b(bids?|outbid|watchlist|if deals?|photos?|photo|disclosures?|disclosure|videos?|video|total|hours?|mins?|minutes?|days?|page number|auction id|distance|km|features?\s+listed)\b/i.test(String(value || ""));
  }

  function currentBidMoneyFrom(value) {
    const parsed = parseMoneyCandidate(value);
    if (parsed !== undefined) return parsed;
    return undefined;
  }

  function parseMoneyCandidate(value) {
    const text = String(value || "");
    const leading = text.match(/(?:CA\$|CAD|\$)[ \t]*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.\d{2})?/i);
    const trailing = text.match(/\b([0-9]{1,3}(?:[,\s][0-9]{3})+|[0-9]+)(?:\.\d{2})?[ \t]*\$/i);
    const amount = leading?.[1] || trailing?.[1];
    return moneyFrom(amount);
  }

  function parseMoneyCandidateMatches(text) {
    return Array.from(String(text || "").matchAll(/(?:CA\$|CAD|\$)[ \t]*(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.\d{2})?|\b(?:[0-9]{1,3}(?:[,\s][0-9]{3})+|[0-9]+)(?:\.\d{2})?[ \t]*\$/ig));
  }

  function isRejectedPriceCounterContext(text) {
    return hasCounterPriceContext(text) || isTransportPriceContext(text);
  }

  function rejectedPriceCounterReason(label) {
    const value = String(label || "");
    if (/\b(bids?|outbid)\b/i.test(value)) return "bid_count_not_money";
    if (/\b(photos?|videos?|total)\b/i.test(value)) return "media_count_not_money";
    if (/\b(disclosures?|features?\s+listed)\b/i.test(value)) return "disclosure_count_not_money";
    if (/\b(km|distance)\b/i.test(value)) return "transport_estimate_not_vehicle_price";
    return "counter_not_money";
  }

  function currentBidSourceType(sourceName) {
    if (/activeBidBar/i.test(sourceName)) return "active_bid_bar";
    if (sourceName.startsWith("section-map")) return "section_map";
    if (sourceName.startsWith("dom:")) return "dom_text";
    return "visible_text";
  }

  function currentBidCandidateSnippet(source, index, length) {
    const text = String(source || "");
    const beforeBreak = text.lastIndexOf("\n", Math.max(0, index - 1));
    const afterBreak = text.indexOf("\n", index + length);
    const start = Math.max(0, beforeBreak >= 0 ? beforeBreak + 1 : index - 80);
    const end = Math.min(text.length, afterBreak >= 0 ? afterBreak : index + length + 80);
    return normalizeSpace(text.slice(start, end));
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
    const isOutcomePage = ["purchase_detail", "purchase_list", "post_sale", "fee_details", "purchase_info"].includes(String(listing.pageType || ""))
      || ["candidate_outcome", "verified_outcome"].includes(String(listing.captureKind || ""));
    const hasOutcomePrice = [
      listing.soldPriceCandidate,
      listing.buyPriceAuction,
      listing.finalBidAmount,
      listing.acceptedAmount,
      listing.negotiatedAmount,
      listing.totalInvoiceAmount,
      listing.finalAcquisitionCost,
    ].some((value) => value !== undefined && value !== null && value !== "");
    const requiredFields = isOutcomePage
      ? {
        vin: listing.vin,
        soldPriceCandidate: hasOutcomePrice ? true : undefined,
      }
      : {
        vin: listing.vin,
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
    const add = (source, value, metadata = {}) => {
      const raw = String(value || "");
      if (!/carfax/i.test(raw)) return;
      const url = carfaxUrlCandidate(raw);
      const safeRaw = sanitizeCarfaxEvidenceText(raw);
      candidates.push(compact({
        source,
        sourceText: safeRaw.slice(0, 240),
        text: safeRaw.slice(0, 240),
        url,
        urlStatus: url ? "url_found" : "text_only",
        rejectedReason: url ? undefined : rejectedCarfaxReason(raw),
        confidenceScore: carfaxConfidence(source, Boolean(url)),
        ...metadata,
      }));
    };
    for (const link of Array.from(doc.querySelectorAll?.("a[href]") || [])) {
      add("link_href", `${link.getAttribute("href")} ${link.innerText || ""} ${link.getAttribute("aria-label") || ""} ${link.getAttribute("title") || ""}`, { attributeName: "href" });
    }
    for (const node of Array.from(doc.querySelectorAll?.("[aria-label], [title], [data-href], [data-url], [data-report-url], button, [role='button']") || [])) {
      add("data_href", [node.getAttribute?.("data-href"), node.innerText, node.getAttribute?.("aria-label")].filter(Boolean).join(" "), { attributeName: "data-href" });
      add("data_url", [node.getAttribute?.("data-url"), node.innerText, node.getAttribute?.("aria-label")].filter(Boolean).join(" "), { attributeName: "data-url" });
      add("data_report_url", [node.getAttribute?.("data-report-url"), node.innerText, node.getAttribute?.("aria-label")].filter(Boolean).join(" "), { attributeName: "data-report-url" });
      add("dom_attribute", [
        node.getAttribute?.("aria-label"),
        node.getAttribute?.("title"),
        node.getAttribute?.("onclick"),
        node.innerText,
        node.textContent,
      ].filter(Boolean).join(" "));
    }
    add("safe_dom_attributes", extractSafeDomAttributeText(doc));
    for (const evidence of extractCarfaxAttributeEvidenceFromHtml(doc.__openlaneHtml || "", "href")) add("link_href", evidence, { attributeName: "href" });
    for (const evidence of extractCarfaxAttributeEvidenceFromHtml(doc.__openlaneHtml || "", "data-href")) add("data_href", evidence, { attributeName: "data-href" });
    for (const evidence of extractCarfaxAttributeEvidenceFromHtml(doc.__openlaneHtml || "", "data-url")) add("data_url", evidence, { attributeName: "data-url" });
    for (const evidence of extractCarfaxAttributeEvidenceFromHtml(doc.__openlaneHtml || "", "data-report-url")) add("data_report_url", evidence, { attributeName: "data-report-url" });
    for (const evidence of extractCarfaxHydrationJsonEvidenceFromHtml(doc.__openlaneHtml || "")) add("hydration_json", evidence);
    for (const evidence of extractCarfaxZoneEvidenceFromHtml(doc.__openlaneHtml || "")) add("html_carfax_zone", evidence);
    for (const evidence of extractCarfaxEvidenceFromHtml(doc.__openlaneHtml || "")) add("html_node", evidence);
    add("html_attributes", extractAttributeText(doc.__openlaneHtml || ""));
    add("visible_text", text);
    const withUrl = candidates.find((candidate) => candidate.url);
    const carfaxUrl = withUrl ? absoluteUrl(withUrl.url, href) : undefined;
    const carfaxMentioned = candidates.length > 0 || /carfax/i.test(text);
    const carfaxActionable = Boolean(carfaxUrl);
    const source = carfaxUrl ? carfaxCleanSource(withUrl?.source) : carfaxMentioned ? "visible_text" : "none";
    return {
      carfaxMentioned,
      carfaxAvailable: carfaxActionable,
      carfaxActionable,
      carfaxAvailableLegacy: carfaxMentioned,
      carfaxUrl,
      carfaxUrlStatus: carfaxUrl ? "url_found" : carfaxMentioned ? "text_only" : "missing",
      carfax: {
        mentioned: carfaxMentioned,
        visible: carfaxMentioned,
        urlResolved: carfaxActionable,
        actionable: carfaxActionable,
        urlStatus: carfaxUrl ? "resolved_url" : carfaxMentioned ? "text_only" : "not_found",
        url: carfaxUrl,
        source,
        confidenceScore: withUrl?.confidenceScore || (carfaxMentioned ? 50 : 0),
      },
      carfaxEvidence: candidates.slice(0, 8),
      carfaxDiagnostics: buildCarfaxDiagnostics(candidates, carfaxUrl, carfaxMentioned),
    };
  }

  function buildCarfaxDiagnostics(candidates = [], carfaxUrl, carfaxMentioned) {
    const count = (predicate) => candidates.filter(predicate).length;
    const urlFound = Boolean(carfaxUrl);
    return {
      carfaxDomCandidateCount: count((item) => /link|data_|dom_attribute|safe_dom_attributes|html_/i.test(item.source || "")),
      carfaxLinkCandidateCount: count((item) => item.source === "link_href"),
      carfaxHrefCandidateCount: count((item) => item.attributeName === "href" || item.source === "link_href"),
      carfaxDataHrefCandidateCount: count((item) => item.source === "data_href"),
      carfaxDataUrlCandidateCount: count((item) => item.source === "data_url"),
      carfaxDataReportUrlCandidateCount: count((item) => item.source === "data_report_url"),
      carfaxHydrationJsonCandidateCount: count((item) => item.source === "hydration_json"),
      carfaxHtmlZoneCandidateCount: count((item) => item.source === "html_carfax_zone"),
      carfaxSafeAttributeCandidateCount: count((item) => item.source === "safe_dom_attributes"),
      carfaxNetworkCandidateCount: 0,
      carfaxTextOnlyCandidateCount: urlFound ? 0 : (carfaxMentioned ? Math.max(1, count((item) => item.urlStatus === "text_only")) : 0),
      rejectedCandidates: candidates
        .filter((item) => item.rejectedReason)
        .map((item) => ({
          source: item.source,
          sourceText: item.sourceText,
          rejectedReason: item.rejectedReason,
        }))
        .slice(0, 12),
    };
  }

  function rejectedCarfaxReason(value) {
    const text = String(value || "");
    if (/\b(?:javascript|data|vbscript):/i.test(text)) return "unsafe_carfax_url";
    if (/\/vdp\/(?:null|undefined|#|$)/i.test(text)) return "placeholder_url_not_report";
    if (/\.(?:svg|png|jpe?g|webp|avif|css|js)(?:$|[?#\s])/i.test(text)) return "asset_url_not_report";
    const urlLike = text.match(/https?:\/\/[^\s"'<>)]*(?:carfax|report|history)[^\s"'<>)]*/i)?.[0];
    if (urlLike && !sanitizeCarfaxUrl(urlLike)) return "unsafe_carfax_url";
    return "carfax_text_without_safe_url";
  }

  function carfaxConfidence(source, hasUrl) {
    if (/link_href|data_href|data_url|data_report_url|safe_dom_attributes|html_carfax_zone|hydration_json/i.test(source)) return hasUrl ? 92 : 62;
    if (/html_node|html_attributes/i.test(source)) return hasUrl ? 84 : 58;
    return hasUrl ? 70 : 50;
  }

  function carfaxUrlCandidate(value) {
    const raw = String(value || "");
    const absolute = raw.match(/https?:\/\/[^\s"'<>)]*(?:carfax|report|history)[^\s"'<>)]*/i)?.[0];
    if (absolute && /\.(?:svg|png|jpe?g|webp|avif|css|js)(?:$|[?#])/i.test(absolute)) return undefined;
    if (absolute) return sanitizeCarfaxUrl(absolute);
    const relative = raw.match(/\/[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]*(?:carfax|report|history)[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]*/i)?.[0];
    if (relative && !/\.(?:svg|png|jpe?g|webp|avif|css|js)(?:$|[?#])/i.test(relative)) return sanitizeCarfaxUrl(relative);
    return undefined;
  }

  function sanitizeCarfaxUrl(value) {
    const raw = String(value || "");
    if (!raw || /^\s*(javascript|data|vbscript):/i.test(raw)) return undefined;
    try {
      const url = new URL(raw, "https://app.openlane.ca");
      if (!/^https?:$/i.test(url.protocol)) return undefined;
      if (!isTrustedCarfaxUrl(url)) return undefined;
      for (const key of Array.from(url.searchParams.keys())) {
        const paramValue = url.searchParams.get(key) || "";
        if (isSensitiveText(`${key} ${paramValue}`) || /\[redacted/i.test(`${key} ${paramValue}`)) url.searchParams.delete(key);
      }
      return /^https?:\/\//i.test(raw) ? `${url.origin}${url.pathname}${url.search}` : `${url.pathname}${url.search}`;
    } catch {
      return undefined;
    }
  }

  function isTrustedCarfaxUrl(url) {
    const hostname = String(url.hostname || "").toLowerCase();
    const pathname = String(url.pathname || "");
    if (/\/(?:null|undefined)(?:\/|$)/i.test(pathname)) return false;
    if (/(^|\.)carfax\.(ca|com)$/.test(hostname)) return /\b(?:report|vehicle-history|history|vhr)\b/i.test(pathname);
    if (/(^|\.)openlane\.(ca|com)$/.test(hostname)) return /\b(?:carfax|vehicle-history|reports?|history)\b/i.test(pathname);
    return false;
  }

  function carfaxCleanSource(source) {
    if (/link_href/i.test(String(source || ""))) return "dom_link";
    if (/data_href|data_url|data_report_url|safe_dom_attributes/i.test(String(source || ""))) return "data_attribute";
    if (/hydration_json|html_carfax_zone|html_node|html_attributes/i.test(String(source || ""))) return "router_or_hydration";
    if (/network/i.test(String(source || ""))) return "network";
    return "visible_text";
  }

  function sanitizeCarfaxEvidenceText(value) {
    return String(value || "")
      .replace(/\b(?:auth|authorization|cookie|token|secret|credential|session|password|csrf|jwt|bearer)\s*[:=]\s*[^,\s"'<>]+/gi, "[redacted]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
      .slice(0, 1000);
  }

  function extractCarfaxEvidenceFromHtml(html) {
    const evidence = [];
    for (const match of String(html || "").matchAll(/<([a-z][a-z0-9-]*)\b[^>]*(?:carfax|href=|data-href=|data-url=|onclick=)[^>]*>(?:[\s\S]*?<\/\1>)?/gi)) {
      const source = match[0];
      if (/carfax/i.test(source)) evidence.push(`${source.match(/<[^>]+>/)?.[0] || ""} ${stripTags(source)}`.slice(0, 500));
    }
    return evidence;
  }

  function extractCarfaxAttributeEvidenceFromHtml(html, attributeName) {
    const evidence = [];
    const pattern = new RegExp(`(?:^|[\\s<])${escapeRegExp(attributeName)}=["']([^"']+)["']`, "gi");
    for (const match of String(html || "").matchAll(pattern)) {
      const start = Math.max(0, (match.index || 0) - 240);
      const end = Math.min(String(html || "").length, (match.index || 0) + 500);
      const snippet = String(html || "").slice(start, end);
      if (/carfax/i.test(`${match[1]} ${snippet}`)) evidence.push(`${match[1]} ${stripTags(snippet)}`.slice(0, 500));
    }
    return evidence.slice(0, 8);
  }

  function extractCarfaxHydrationJsonEvidenceFromHtml(html) {
    const evidence = [];
    const source = String(html || "");
    for (const match of source.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]{0,60000}?)<\/script>/gi)) {
      const jsonText = stripJsonScript(match[1]);
      if (!/carfax/i.test(jsonText)) continue;
      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        continue;
      }
      walkJson(parsed, (value, path) => {
        if (evidence.length >= 8 || typeof value !== "string") return;
        const keyPath = path.join(".");
        if (isSensitiveText(keyPath)) return;
        if (!isCarfaxReportKey(keyPath, value)) return;
        const url = carfaxUrlCandidate(value);
        if (!url) return;
        evidence.push(`${keyPath}=${url} CARFAX`.slice(0, 500));
      });
    }
    return Array.from(new Set(evidence)).slice(0, 8);
  }

  function stripJsonScript(value) {
    return String(value || "").replace(/^\s*<!--/, "").replace(/-->\s*$/, "").trim();
  }

  function walkJson(value, visit, path = []) {
    visit(value, path);
    if (Array.isArray(value)) value.forEach((item, index) => walkJson(item, visit, path.concat(String(index))));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => walkJson(item, visit, path.concat(key)));
  }

  function isCarfaxReportKey(keyPath, value = "") {
    const normalized = String(keyPath || "").toLowerCase().replace(/[_\s-]/g, "");
    if (/(carfaxurl|carfaxreporturl|vehiclehistoryurl|historyreporturl)$/.test(normalized)) return true;
    if (!/(reporturl|reportlink|historyurl)$/.test(normalized)) return false;
    return /carfax|vehiclehistory|historyreport|historyurl/.test(normalized)
      || /carfax|vehicle-history|history-report|history\//i.test(String(value || ""));
  }

  function extractCarfaxZoneEvidenceFromHtml(html) {
    const source = String(html || "");
    const evidence = [];
    for (const match of source.matchAll(/carfax/gi)) {
      const snippet = source.slice(Math.max(0, match.index - 800), match.index + 1200);
      const combined = `${stripTags(snippet)}\n${extractAttributeText(snippet)}`;
      if (carfaxUrlCandidate(combined)) evidence.push(combined.slice(0, 800));
      if (evidence.length >= 8) break;
    }
    return Array.from(new Set(evidence));
  }

  function extractConditionDetails(sectionMap, text, labels) {
    const zones = sectionMap?.zones || {};
    const knownHistoryText = zones.knownHistory?.text || findSectionByHeadings(text, ["Known history", "Antécédents connus", "Antecedents connus"]);
    const disclosureText = zones.disclosuresCondition?.text || findSectionByHeadings(text, ["Disclosures and conditions", "Disclosures", "Divulgations et condition"]);
    const dealerNotesRaw = zones.dealerNotes?.text || findSectionByHeadings(text, ["Note from selling dealer", "Note du concessionnaire vendeur", "Dealer notes"]);
    const qaRaw = zones.qaSection?.text || findSectionByHeadings(text, ["Q and A", "Q&A", "Q et R"]);
    const conditionAst = buildConditionSectionAst(disclosureText);
    const dealerNotes = cleanConditionSection(dealerNotesRaw);
    const qaSummary = cleanConditionSection(qaRaw, { keepQuestions: true });
    const sellerBroadcasts = cleanConditionSection(findSectionByHeadings(text, ["Seller broadcasts", "Broadcasts", "Messages du vendeur"]));
    const astKnownHistoryItems = conditionSectionItems(conditionAst, ["knownHistory"], "", []);
    const knownHistoryItems = astKnownHistoryItems.length ? astKnownHistoryItems : conditionItems(knownHistoryText, ["Known history", "Antécédents connus", "Antecedents connus"]);
    const safetyDisclosures = conditionSectionItems(conditionAst, ["safetyRelated"], disclosureText, ["Safety-related", "In relation to safety", "En relation avec la sécurité", "En relation avec la securite"]);
    const mechanicalDisclosures = conditionSectionItems(conditionAst, ["mechanical"], disclosureText, ["Mechanical", "Mécanique", "Mecanique"]);
    const exteriorDisclosures = conditionSectionItems(conditionAst, ["exterior"], disclosureText, ["Exterior", "Extérieur", "Exterieur"]);
    const interiorDisclosures = conditionSectionItems(conditionAst, ["interior"], disclosureText, ["Interior", "Intérieur", "Interieur"]);
    const tireWheelDisclosures = conditionSectionItems(conditionAst, ["tiresAndWheels"], disclosureText, ["Tires and wheels", "Tire & wheels", "Tires & wheels", "Pneus et roues"]);
    const obd2Text = conditionSectionText(conditionAst, ["obd2"]) || subsectionText(disclosureText, ["OBD2 Reader", "OBD2 scan", "Lecteur OBD2"]);
    const obd2Status = obd2Text ? (/this vehicle was not scanned|not scanned|nothing reported|rien n.a été signalé|rien n.a ete signale/i.test(obd2Text) ? "not_scanned" : /non disponible|not available|not visible|unavailable/i.test(obd2Text) ? "not_visible" : "visible_text") : undefined;
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
      fallbackDeclarations.length ? `Declarations: ${fallbackDeclarations.join(" | ")}` : "",
    ].filter(Boolean).join(" | ").slice(0, 4000);
    const highRiskTerms = highRiskConditionTerms(allConditionText);
    const conditionDiagnostics = buildConditionDiagnostics({
      knownHistory: knownHistoryText,
      disclosuresCondition: disclosureText,
      dealerNotes: dealerNotesRaw,
      qaSection: qaRaw,
    }, conditionAst);
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
      conditionExtractorMode: conditionDiagnostics.conditionExtractorMode,
      conditionDiagnostics,
    });
  }

  function hasCanonicalConditionSections(conditionDetails = {}) {
    return (conditionDetails.conditionDiagnostics?.conditionSectionTree || [])
      .some((section) => section.lineCount > 0 && /knownHistory|safetyRelated|mechanical|exterior|interior|tiresAndWheels|obd2/i.test(section.canonicalKey || ""));
  }

  function findSectionByHeadings(text, headings) {
    for (const heading of headings) {
      const found = findSectionText(text, heading);
      if (found) return `${heading}\n${found}`;
    }
    return "";
  }

  function buildConditionDiagnostics(sectionTexts = {}, conditionAst = { sections: [], boundaries: [] }) {
    const rejectedConditionLines = [];
    for (const [sourceZone, value] of Object.entries(sectionTexts)) {
      for (const rawLine of conditionBoundaryText(value).split(/\n|\s+\|\s+/)) {
        const sourceText = cleanConditionLine(rawLine);
        if (!sourceText) continue;
        if (isConditionNoiseLine(sourceText, { keepQuestions: sourceZone === "qaSection" })) {
          rejectedConditionLines.push({
            sourceZone,
            sourceText: sourceText.slice(0, 240),
            rejectionReason: conditionNoiseReason(sourceText),
          });
        }
        if (rejectedConditionLines.length >= 20) break;
      }
      if (rejectedConditionLines.length >= 20) break;
    }
    return compact({
      conditionExtractorMode: "dom_ast",
      conditionSectionTree: (conditionAst.sections || []).map((section) => ({
        heading: section.heading,
        canonicalKey: section.canonicalKey,
        lineCount: section.lines.length,
      })).slice(0, 20),
      rejectedConditionLines,
      sectionBoundaryDecisions: (conditionAst.boundaries?.length ? conditionAst.boundaries : conditionSectionBoundaryDecisions(sectionTexts.disclosuresCondition)).slice(0, 12),
    });
  }

  function buildConditionSectionAst(text) {
    const sections = [];
    const boundaries = [];
    let current = null;
    for (const rawLine of conditionBoundaryText(text).split(/\n|\s+\|\s+/)) {
      const line = cleanConditionLine(rawLine);
      if (!line) continue;
      const canonicalKey = canonicalConditionSectionKey(line);
      if (canonicalKey) {
        const section = { heading: line, canonicalKey, lines: [] };
        if (current) boundaries.push({ sourceZone: "disclosuresCondition", startHeading: current.heading, stopHeading: line });
        sections.push(section);
        current = section;
        continue;
      }
      if (!current || isConditionNoiseLine(line)) continue;
      current.lines.push(line);
    }
    if (current) boundaries.push({ sourceZone: "disclosuresCondition", startHeading: current.heading, stopHeading: "section_end" });
    return { sections, boundaries };
  }

  function conditionSectionItems(ast, keys, fallbackText, fallbackHeadings) {
    if (ast.sections?.length) return conditionItems(conditionSectionText(ast, keys));
    return conditionItems(subsectionText(fallbackText, fallbackHeadings));
  }

  function conditionSectionText(ast, keys) {
    const keySet = new Set(keys || []);
    return (ast.sections || [])
      .filter((section) => keySet.has(section.canonicalKey))
      .flatMap((section) => section.lines)
      .join("\n");
  }

  function canonicalConditionSectionKey(heading) {
    const text = normalizeSpace(heading).toLowerCase();
    if (/^(disclosures? and conditions?|divulgations? et condition|condition report|rapport de condition)$/i.test(text)) return "conditionRoot";
    if (/^(known history|ant[eé]c[eé]dents connus|antecedents connus|vehicle history)$/i.test(text)) return "knownHistory";
    if (/^(safety-related|in relation to safety|en relation avec la s[eé]curit[eé]|en relation avec la securite)$/i.test(text)) return "safetyRelated";
    if (/^(mechanical|m[eé]canique|mecanique)$/i.test(text)) return "mechanical";
    if (/^(exterior|ext[eé]rieur|exterieur)$/i.test(text)) return "exterior";
    if (/^(interior|int[eé]rieur|interieur)$/i.test(text)) return "interior";
    if (/^(tires? (?:and|&) wheels?|tire (?:and|&) wheels?|pneus et roues)$/i.test(text)) return "tiresAndWheels";
    if (/^(obd2 reader|obd2 scan|lecteur obd2)$/i.test(text)) return "obd2";
    if (/^(note from selling dealer|note du concessionnaire vendeur|seller notes?|dealer notes?)$/i.test(text)) return "sellerNotes";
    if (/^(q and a|q&a|q et r)$/i.test(text)) return "qaSummary";
    if (/^(market insights?|market guide|add'l info|additional info)$/i.test(text)) return "marketInsights";
    return "";
  }

  function conditionSectionBoundaryDecisions(text) {
    const headings = conditionBoundaryHeadings();
    const source = conditionBoundaryText(text);
    const found = headings
      .map((heading) => ({ heading, index: source.search(new RegExp(`(?:^|\\n)\\s*${escapeRegExp(heading)}\\b`, "i")) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => a.index - b.index);
    return found.map((item, index) => ({
      sourceZone: "disclosuresCondition",
      startHeading: item.heading,
      stopHeading: found[index + 1]?.heading || "section_end",
    }));
  }

  function conditionNoiseReason(line) {
    const text = normalizeSpace(line);
    if (/\b(Full bid history|Bidder\s+\d+|Current bid|Highest proxy applied|\d+\s+Bids?)\b/i.test(text)) return "bid_history_noise";
    if (/\b(Transport estimate|Transport Direct|Rate info|Vehicle location)\b/i.test(text)) return "transport_or_location_noise";
    if (/\b(Market guide|wholesale data|Subscribe to Market guide)\b/i.test(text)) return "market_guide_noise";
    if (/\b(Terms & conditions|Privacy policy|OPENLANE Inc\. All rights reserved)\b/i.test(text)) return "legal_or_footer_noise";
    if (isConditionHeaderText(text) || /^(?:&|and)\s+wheels$/i.test(text) || /^and conditions$/i.test(text)) return "header_value_not_condition";
    if (/\b(vehicle-detail-page|current-bid-panel|data-testid|vdp-page)\b/i.test(text)) return "attribute_noise";
    if (/^(VIN|NIV)\b|^[A-HJ-NPR-Z0-9]{17}$/i.test(text)) return "identity_line_not_condition";
    if (/^Odometer\b|^Odom[eÃƒÂ¨]tre\b|^\d[\d,.\s]*\s*KM$/i.test(text)) return "odometer_line_not_condition";
    if (/^[QA]:\s/i.test(text)) return "qa_line_not_condition";
    return "condition_noise_line";
  }

  function subsectionText(text, headings) {
    const source = conditionBoundaryText(text);
    const headingPattern = headings.map(escapeRegExp).join("|");
    const nextHeading = conditionBoundaryHeadings().map(escapeRegExp).join("|");
    const unusedConditionBoundaryHeadings = [
      "Known history", "Antécédents connus", "Disclosures and conditions", "Divulgations et condition",
      "In relation to safety", "En relation avec la sécurité", "Mechanical", "Mécanique", "Exterior", "Extérieur",
      "Interior", "Intérieur", "Tires and wheels", "Pneus et roues", "OBD2 Reader", "Lecteur OBD2",
      "Note from selling dealer", "Note du concessionnaire vendeur", "Q and A", "Q et R",
    ];
    void unusedConditionBoundaryHeadings;
    const match = source.match(new RegExp(`(?:^|\\n)\\s*(?:${headingPattern})\\s*[:\\n]?\\s*([\\s\\S]{0,1200}?)(?=\\n\\s*(?:${nextHeading})\\b|$)`, "i"));
    return cleanConditionSection(match?.[1] || "");
  }

  function conditionBoundaryHeadings() {
    return [
      "Disclosures and conditions", "Divulgations et condition", "Known history", "Antecedents connus",
      "Antécédents connus", "Safety-related", "In relation to safety", "En relation avec la sécurité",
      "En relation avec la securite", "Mechanical", "Mécanique", "Mecanique",
      "Exterior", "Extérieur", "Exterieur", "Interior", "Intérieur", "Interieur", "Tires and wheels", "Pneus et roues",
      "OBD2 Reader", "OBD2 scan", "Lecteur OBD2", "Seller broadcasts", "Broadcasts", "Market insights",
      "Add'l info", "Additional info", "Note from selling dealer", "Note du concessionnaire vendeur",
      "Q and A", "Q&A", "Q et R",
    ].sort((a, b) => b.length - a.length);
  }

  function conditionBoundaryText(text) {
    let source = String(text || "").replace(/\r/g, "\n").replace(/&amp;/gi, "&");
    for (const heading of conditionBoundaryHeadings()) {
      source = source.replace(new RegExp(`\\b${escapeRegExp(heading)}\\b`, "gi"), "\n$&\n");
    }
    return source;
  }

  function conditionItems(text, headingsToRemove = []) {
    const headingSet = new Set(headingsToRemove.map((heading) => normalizeSpace(heading).toLowerCase()));
    return cleanConditionSection(text)
      .split(/\n|\s+\|\s+/)
      .map((line) => normalizeSpace(line.replace(/^[-•]\s*/, "")))
      .filter((line) => line && !headingSet.has(line.toLowerCase()))
      .slice(0, 30);
  }

  function cleanConditionSection(text, options = {}) {
    return normalizeSpace(String(text || "")
      .replace(/\r/g, "\n")
      .split(/\n|\s+\|\s+/)
      .map(cleanConditionLine)
      .filter((line) => line && !isConditionNoiseLine(line, options))
      .join("\n"));
  }

  function cleanConditionLine(line) {
    return normalizeSpace(String(line || "")
      .replace(/&amp;/gi, "&")
      .replace(/^[-â€¢]\s*/, ""));
  }

  function isConditionNoiseLine(line, options = {}) {
    const text = normalizeSpace(line);
    if (!text) return true;
    if (/^(BUYING|SELLING|Browse vehicles|Pending|Closing|Purchases|Create|Parked|Listings|Sold|Sent to Simulcast|PRO|Leads & customers|MyLot|Market guide|Terms & conditions|Privacy policy|Q&A|Q and A)$/i.test(text)) return true;
    if (/^(OPENLANE Inc\. All rights reserved\.?|Subscribe to Market guide\.?|Historical sales of similar vehicles\.?)$/i.test(text)) return true;
    if (/\b(Transport estimate|Transport Direct|Rate info|Vehicle location|Market guide|wholesale data, past \d+ days|Terms & conditions|Privacy policy|Subscribe to Market guide|OPENLANE Inc\. All rights reserved)\b/i.test(text)) return true;
    if (/\b(Full bid history|Bidder\s+\d+|Current bid|Highest proxy applied|\d+\s+Bids?)\b/i.test(text)) return true;
    if (/(?:CA\$|CAD|\$)\s*\d[\d,. ]*/i.test(text) && /\b(bid|bidder|transport|market guide|history)\b/i.test(text)) return true;
    if (/^(?:CA\$|CAD|\$)\s*\d[\d,. ]*(?:\.\d{2})?$/i.test(text)) return true;
    if (isConditionHeaderText(text) || /^(?:&|and)\s+wheels$/i.test(text) || /^and conditions$/i.test(text)) return true;
    if (/\b(vehicle-detail-page|current-bid-panel|data-testid|vdp-page)\b/i.test(text)) return true;
    if (/^\b(19|20)\d{2}\b\s+[A-Za-z][A-Za-z -]+\b/.test(text)) return true;
    if (/^(VIN|NIV)\b|^[A-HJ-NPR-Z0-9]{17}$/i.test(text)) return true;
    if (/^Odometer\b|^Odom[eÃ¨]tre\b|^\d[\d,.\s]*\s*KM$/i.test(text)) return true;
    if (/^[QA]:\s/i.test(text) && !options.keepQuestions) return true;
    return false;
  }

  function isConditionHeaderText(text) {
    const normalized = normalizeSpace(text).toLowerCase();
    const headerAliases = [
      ...conditionBoundaryHeadings(),
      "Tire & wheels",
      "Tire and wheels",
      "Tires & wheels",
      "Tires and wheels",
    ];
    return headerAliases.some((heading) => normalized === normalizeSpace(heading).toLowerCase());
  }

  function highRiskConditionTerms(text) {
    const riskTerms = ["engine", "moteur", "transmission", "accident", "cracked windshield", "pare-brise", "rust", "rouille", "structural", "structurel", "check engine", "salvage", "rebuilt"];
    return riskTerms.filter((term) => new RegExp(escapeRegExp(term), "i").test(text));
  }

  function extractConditionText(text, labels) {
    return [
      conditionItems(labels.get("declarations")),
      conditionItems(findSectionText(text, "Condition Report")),
      conditionItems(findSectionText(text, "Announcements")),
      conditionItems(findSectionText(text, "Damage")),
      conditionItems(findSectionText(text, "Mechanical")),
      conditionItems(findSectionText(text, "Structural")),
      conditionItems(findSectionText(text, "Odometer")),
    ].flat().filter(Boolean).join(" | ").slice(0, 4000) || undefined;
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

  function extractPurchaseEconomics(text, classification, sectionMap, networkEvidence) {
    if (!["fee_details", "purchase_detail", "purchase_info", "purchase_list"].includes(classification.pageType)) return {};
    const purchaseOutcomePrice = extractPurchaseOutcomePrice({
      pageContext: classification.pageType,
      captureKind: classification.captureKind,
      outcomeConfidence: classification.outcomeConfidence,
      confidenceScore: classification.confidenceScore,
      sectionMap,
      text,
      networkEvidence,
    });
    const priceCandidates = [...(purchaseOutcomePrice.candidates || [])];
    const soldPriceCandidate = purchaseOutcomePrice.soldPriceCandidate;
    const transactionFee = moneyNearLabel(text, "Transaction Fee");
    const vehicleHistoryFee = moneyNearLabel(text, "Vehicle history - auction") || moneyNearLabel(text, "Vehicle History Fee");
    const subtotal = moneyNearLabel(text, "Subtotal");
    const taxes = moneyNearLabel(text, "Taxes");
    const totalInvoiceAmount = moneyNearLabel(text, "Total invoice") || moneyNearLabel(text, "Invoice total") || (classification.pageType === "fee_details" ? moneyNearLabel(text, "Total") : undefined);
    const finalAcquisitionCost = totalInvoiceAmount;
    const purchaseStatus = cleanStatusValue(valueNearTextLabel(text, "Status"));
    const verifiedWholesale = purchaseOutcomePrice.verifiedWholesale || /\b(retrieved|mark as picked up|picked up|paid|final|finalized|completed|purchase confirmed|invoice)\b/i.test(`${purchaseStatus || ""} ${text}`);
    const buyPriceAuction = purchaseOutcomePrice.buyPriceAuction;
    const outcomeEvidence = purchaseOutcomePrice.evidence;
    const purchaseEvidenceSource = purchaseOutcomePrice.purchaseEvidenceSource;
    const priceSemantics = soldPriceCandidate || buyPriceAuction || transactionFee || vehicleHistoryFee || subtotal || taxes || totalInvoiceAmount ? compact({
      soldPriceCandidate: soldPriceCandidate ? "candidate_wholesale_label" : undefined,
      buyPriceAuction: buyPriceAuction ? (verifiedWholesale ? "verified_wholesale_label" : "candidate_wholesale_label") : undefined,
      transactionFee: transactionFee ? "acquisition_cost_component" : undefined,
      vehicleHistoryFee: vehicleHistoryFee ? "acquisition_cost_component" : undefined,
      subtotal: subtotal ? "acquisition_cost_component" : undefined,
      taxes: taxes ? "acquisition_cost_component" : undefined,
      totalInvoiceAmount: totalInvoiceAmount ? "final_acquisition_cost" : undefined,
      finalAcquisitionCost: finalAcquisitionCost ? "final_acquisition_cost" : undefined,
    }) : undefined;
    return compact({
      soldPriceCandidate,
      buyPriceAuction,
      transactionFee,
      vehicleHistoryFee,
      subtotal,
      taxes,
      totalInvoiceAmount,
      finalAcquisitionCost,
      purchaseStatus,
      priceSemantics,
      outcomeEvidence,
      purchaseEvidenceSource,
      fieldEvidence: purchaseOutcomePrice.fieldEvidence,
      priceCandidates,
      rejectedCandidates: purchaseOutcomePrice.rejectedCandidates,
      metadata: compact({
        purchaseEvidenceSource,
        currency: /\bCA\$|CAD\b/i.test(text) ? "CAD" : undefined,
        releaseFormStatus: cleanStatusValue(valueNearTextLabel(text, "Release Form")),
        titleStatus: cleanStatusValue(valueNearTextLabel(text, "Title Status")),
        inspectionStatus: cleanStatusValue(valueNearTextLabel(text, "Inspection")),
        transportStatus: cleanStatusValue(valueNearTextLabel(text, "Transport")),
      }),
    });
  }

  function extractPurchaseOutcomePrice({ pageContext, captureKind, outcomeConfidence, confidenceScore, sectionMap, text, networkEvidence } = {}) {
    if (!isPurchaseOutcomePriceContext(pageContext, captureKind)) return {};
    const sources = trustedPurchaseOutcomeSources(sectionMap, text, pageContext);
    if (!sources.length) return {};
    const rejectedCandidates = collectRejectedPurchaseOutcomeCandidates(sources, text);
    const soldCandidate = firstTrustedPurchaseMoneyCandidate(sources, ["Sold price", "Final price", "Purchase price", "Accepted price"], "soldPriceCandidate");
    const explicitBuyCandidate = firstTrustedPurchaseMoneyCandidate(sources, ["Buy price - auction", "Selling price"], "buyPriceAuction");
    const networkCandidate = firstNetworkPurchaseOutcomeCandidate(networkEvidence);
    const selectedSold = soldCandidate || networkCandidate;
    const verifiedWholesale = Boolean(selectedSold) && hasVerifiedPurchaseCompletionEvidence(sources, outcomeConfidence);
    const selectedBuy = explicitBuyCandidate || (verifiedWholesale ? selectedSold : undefined);
    const evidenceCandidate = selectedBuy || selectedSold;
    const purchaseEvidenceSource = evidenceCandidate?.sourceType;
    const evidence = evidenceCandidate ? [{
      evidenceType: verifiedWholesale ? "purchase_document" : evidenceTypeForPurchaseSource(evidenceCandidate.sourceType),
      sourceText: evidenceCandidate.sourceText,
      capturedAt: new Date().toISOString(),
      confidenceScore: evidenceCandidate.confidenceScore || confidenceScore || 70,
    }] : undefined;
    const fieldEvidence = compact({
      soldPriceCandidate: selectedSold ? [fieldEvidenceFromPurchaseCandidate(selectedSold, "soldPriceCandidate", confidenceScore)] : undefined,
      buyPriceAuction: selectedBuy ? [fieldEvidenceFromPurchaseCandidate(selectedBuy, "buyPriceAuction", confidenceScore)] : undefined,
    });
    const candidates = [
      selectedSold,
      selectedBuy && selectedBuy !== selectedSold ? selectedBuy : undefined,
      ...rejectedCandidates,
    ].filter(Boolean);

    return compact({
      soldPriceCandidate: selectedSold?.value,
      buyPriceAuction: selectedBuy?.value,
      finalBidAmount: undefined,
      evidence,
      confidence: selectedBuy ? "high" : selectedSold ? "medium" : undefined,
      candidates,
      fieldEvidence,
      verifiedWholesale,
      purchaseEvidenceSource,
      rejectedCandidates,
    });
  }

  function isPurchaseOutcomePriceContext(pageContext, captureKind) {
    return ["purchase_detail", "purchase_list", "post_sale", "fee_details", "purchase_info", "verified_outcome", "candidate_outcome"].includes(String(pageContext || ""))
      || ["verified_outcome", "candidate_outcome"].includes(String(captureKind || ""));
  }

  function trustedPurchaseOutcomeSources(sectionMap, text, pageContext) {
    const zones = sectionMap?.zones || {};
    const purchasePanelSourceType = pageContext === "purchase_list" ? "purchase_list_card" : "purchase_detail_panel";
    const sources = [
      purchaseSourceFromZone("purchasePanel", zones.purchasePanel, purchasePanelSourceType),
      purchaseSourceFromZone("postSalePanel", zones.postSalePanel, "post_sale_page"),
      purchaseSourceFromZone("feeDetailsPanel", zones.feeDetailsPanel, "fee_details_page"),
    ].filter(Boolean);
    if (sources.length) return sources;
    const fallbackText = normalizeSpace(text || "");
    return fallbackText ? [{ name: "mainText", sourceType: purchasePanelSourceType, text: fallbackText }] : [];
  }

  function purchaseSourceFromZone(name, zone, sourceType) {
    const text = normalizeSpace(zone?.text || "");
    if (!text) return undefined;
    return { name, sourceType, text };
  }

  function firstTrustedPurchaseMoneyCandidate(sources, labels, field) {
    for (const source of sources) {
      for (const label of labels) {
        const candidate = purchaseMoneyCandidateNearLabel(source.text, label);
        if (!candidate?.value) continue;
        if (isRejectedPurchasePriceSource(candidate.sourceText) && !hasPositivePurchasePriceLabel(candidate.sourceText)) continue;
        return {
          field,
          label,
          value: candidate.value,
          sourceText: candidate.sourceText,
          sourceName: source.name,
          sourceType: source.sourceType,
          confidenceScore: source.sourceType === "fee_details_page" ? 96 : 92,
        };
      }
    }
    return undefined;
  }

  function purchaseMoneyCandidateNearLabel(text, label) {
    const localCandidates = [];
    const value = moneyNearLabel(text, label, localCandidates);
    if (value) {
      const first = localCandidates[0];
      const sourceText = purchaseEvidenceSnippet(text, label, first?.sourceText) || first?.sourceText || `${label} ${value}`;
      return { label, value, sourceText };
    }
    const source = String(text || "");
    const labelRegex = new RegExp(escapeRegExp(label), "ig");
    for (const match of source.matchAll(labelRegex)) {
      const after = source.slice(match.index || 0, (match.index || 0) + 180);
      const moneyMatch = after.match(moneyRegex());
      const money = moneyFrom(moneyMatch?.[0]);
      if (!money) continue;
      const end = moneyMatch ? (moneyMatch.index || 0) + moneyMatch[0].length : after.length;
      const sourceText = normalizeSpace(after.slice(0, end)).slice(0, 240);
      return { label, value: money, sourceText };
    }
    return undefined;
  }

  function firstNetworkPurchaseOutcomeCandidate(networkEvidence) {
    for (const item of Array.isArray(networkEvidence) ? networkEvidence : []) {
      const candidates = item?.fieldCandidates || item?.candidates?.fieldCandidates || [];
      for (const candidate of Array.isArray(candidates) ? candidates : []) {
        if (!["soldPriceCandidate", "buyPriceAuction", "finalBidAmount"].includes(candidate.field)) continue;
        const value = numberFrom(candidate.value);
        if (!value || isRejectedPurchasePriceSource(candidate.sourceText)) continue;
        return {
          field: "soldPriceCandidate",
          label: candidate.field,
          value,
          sourceText: normalizeSpace(candidate.sourceText || candidate.label || candidate.field).slice(0, 240),
          sourceName: candidate.source || "OpenLane network JSON",
          sourceType: "network_json",
          endpointPattern: candidate.endpointPattern,
          confidenceScore: candidate.confidence || 88,
        };
      }
    }
    return undefined;
  }

  function collectRejectedPurchaseOutcomeCandidates(sources, fullText) {
    const rejected = [];
    const noisyLabels = [
      ["Current bid", "active_current_bid_not_purchase_outcome"],
      ["Bid", "bid_count_or_active_bid_not_purchase_outcome"],
      ["Transport estimate", "transport_estimate_not_purchase_outcome"],
      ["Market guide", "market_guide_not_purchase_outcome"],
      ["Estimated transportation", "transport_estimate_not_purchase_outcome"],
    ];
    const combinedText = normalizeSpace(`${sources.map((source) => source.text).join("\n")}\n${fullText || ""}`);
    for (const [label, rejectedReason] of noisyLabels) {
      const localCandidates = [];
      moneyNearLabel(combinedText, label, localCandidates);
      for (const candidate of localCandidates.slice(0, 3)) {
        rejected.push({ ...candidate, field: "soldPriceCandidate", rejectedReason });
      }
    }
    for (const match of combinedText.matchAll(/\b(\d{1,3})\s+Bids?\b/gi)) {
      rejected.push({
        field: "soldPriceCandidate",
        label: "Bids",
        value: numberFrom(match[1]),
        sourceText: normalizeSpace(match[0]),
        rejectedReason: "bid_count_not_purchase_outcome_price",
      });
      if (rejected.length >= 12) break;
    }
    return rejected.slice(0, 12);
  }

  function isRejectedPurchasePriceSource(sourceText) {
    const text = String(sourceText || "");
    return isTransportPriceContext(text)
      || /\b(current bid|watchlist|outbid|market guide|sales history|similar vehicles|q\s*&\s*a|questions? and answers?)\b/i.test(text)
      || /\b\d{1,3}\s+Bids?\b/i.test(text);
  }

  function hasPositivePurchasePriceLabel(sourceText) {
    return /\b(sold price|final price|purchase price|accepted price|buy price\s*-\s*auction|selling price)\b/i.test(String(sourceText || ""));
  }

  function hasVerifiedPurchaseCompletionEvidence(sources, outcomeConfidence) {
    if (outcomeConfidence === "verified") return true;
    return sources.some((source) => /\b(mark as picked up|picked up|paid|finalized|completed|retrieved|purchase confirmed|invoice)\b/i.test(source.text));
  }

  function evidenceTypeForPurchaseSource(sourceType) {
    if (sourceType === "network_json") return "network_json";
    if (sourceType === "fee_details_page") return "fee_details_page";
    if (sourceType === "post_sale_page") return "post_sale_page";
    if (sourceType === "purchase_list_card") return "purchase_list_card";
    return "visible_page_text";
  }

  function fieldEvidenceFromPurchaseCandidate(candidate, field, confidenceScore) {
    return compact({
      field,
      value: candidate.value,
      normalizedValue: candidate.value,
      sourceType: candidate.sourceType,
      sourceName: candidate.sourceName || "OpenLane purchase panel",
      sourceText: candidate.sourceText,
      endpointPattern: candidate.endpointPattern,
      confidenceScore: candidate.confidenceScore || confidenceScore || 90,
      capturedAt: new Date().toISOString(),
    });
  }

  function extractPostSaleOutcome(text, classification) {
    if (classification.pageType !== "post_sale") return {};
    const priceCandidates = [];
    const soldPriceCandidate = moneyNearLabel(text, "Sold Price", priceCandidates) || moneyNearLabel(text, "Post Sale Amount", priceCandidates);
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
      priceCandidates,
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
    return /(?:CA\$|CAD|\$)\s*[\d][\d,.]*(?:\.\d{2})?|\b[\d][\d,.]*(?:\.\d{2})?\s*\$|\bCAD\s*[\d,]+(?:\.\d{2})?/i;
  }

  function isTransportPriceContext(text) {
    return /\b(transport|transport direct|rate info|delivery|pickup|shipping|distance|estimate|livraison|ramassage)\b/i.test(String(text || ""))
      || /\bCAD\b[\s\S]{0,80}\/\s*\d[\d,. ]*\s*km\b/i.test(String(text || ""))
      || /\/\s*(?:km|kilomet(?:er|re)s?)\b/i.test(String(text || ""));
  }

  function valueNearTextLabel(text, label) {
    const match = String(text || "").match(new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\b\\s*[:#]?\\s*(?:\\n\\s*)?([^\\n]{1,160})`, "i"));
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
    extractOpenLaneCurrentBidOnly,
    extractPurchaseOutcomePrice,
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
