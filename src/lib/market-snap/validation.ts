import { z } from "zod";
import { DEEP_CAPTURE_SCOPES } from "@/lib/market-snap/deep-capture-policy";

export const marketTypes = [
  "clean_retail_market",
  "clean_wholesale_market",
  "auction_market",
  "salvage_auction_market",
  "rebuilt_market",
  "parts_or_non_running_market",
] as const;

export const marketSourceTypes = ["retail", "wholesale", "auction", "salvage", "import", "extension"] as const;
export const openLanePageTypes = [
  "active_listing",
  "watchlist",
  "pending",
  "closing",
  "post_sale",
  "purchase_list",
  "purchase_detail",
  "fee_details",
  "purchase_info",
  "documents",
  "unknown",
] as const;
export const marketCaptureKinds = ["observation", "candidate_outcome", "verified_outcome", "manual_confirmation"] as const;
export const marketSnapCaptureLevels = ["basic_dom", "deep_capture"] as const;
export const marketSnapCaptureScopes = DEEP_CAPTURE_SCOPES;
export const outcomeConfidenceLevels = ["low", "medium", "high", "verified"] as const;
export const priceSemanticValues = [
  "observation",
  "candidate_wholesale_label",
  "verified_wholesale_label",
  "retail_label",
  "acquisition_cost_component",
  "final_acquisition_cost",
] as const;
export const priceSemanticFields = [
  "listedPrice",
  "currentBid",
  "currentOffer",
  "bestOffer",
  "buyNowPrice",
  "reservePrice",
  "soldPriceCandidate",
  "finalBidAmount",
  "negotiatedAmount",
  "counterOfferAmount",
  "acceptedAmount",
  "buyPriceAuction",
  "transactionFee",
  "vehicleHistoryFee",
  "otherFees",
  "subtotal",
  "taxes",
  "totalInvoiceAmount",
  "finalAcquisitionCost",
] as const;

const optionalText = z.string().trim().max(4000).optional().or(z.literal(""));
const shortText = z.string().trim().max(240).optional().or(z.literal(""));
const httpUrl = z.string().trim().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "URL must use http or https");
const optionalHttpUrl = httpUrl.optional().or(z.literal(""));
const money = z.coerce.number().finite().min(0).max(99_999_999).optional();
const score = z.coerce.number().finite().min(0).max(100).optional();
const conditionSeverity = z.enum(["none", "light", "moderate", "severe", "unknown"]);
const rustSeverity = z.enum(["none", "light", "moderate", "severe", "structural", "unknown"]);
const diagnosticSeverity = z.enum(["low", "medium", "high", "critical"]);
const textList = z.array(z.string().trim().min(1).max(80)).max(30).optional();
const longerTextList = z.array(z.string().trim().min(1).max(240)).max(50).optional();
const unsafeJsonKey = /(auth|authorization|cookie|token|secret|credential|session|password|csrf|jwt|bearer)/i;
const unsafeUrlProtocol = /^\s*(javascript|data|vbscript):/i;
const urlLikeKey = /\b(url|href|src|thumbnail|poster)\b/i;

const safeDeepRecord = (maxBytes: number, maxArrayLength = 120) => z.record(z.string(), z.unknown()).superRefine((value, context) => {
  const size = jsonByteLength(value);
  if (size > maxBytes) {
    context.addIssue({
      code: "custom",
      message: `Structured extraction payload is too large (${size} bytes, max ${maxBytes}).`,
    });
  }
  validateSafeJsonValue(value, context, { maxArrayLength });
});

const marketListingPhotoSchema = z.object({
  url: httpUrl,
  thumbnailUrl: httpUrl.optional(),
  alt: z.string().trim().max(240).optional(),
  width: z.coerce.number().int().min(0).max(20000).optional(),
  height: z.coerce.number().int().min(0).max(20000).optional(),
  source: z.enum(["img", "srcset", "picture", "background-image", "link"]).optional(),
}).strict();
const marketListingVideoSchema = z.object({
  url: httpUrl,
  posterUrl: httpUrl.optional(),
  title: z.string().trim().max(240).optional(),
  type: z.string().trim().max(80).optional(),
  source: z.enum(["video", "source", "iframe", "link"]).optional(),
}).strict();
const captureEvidenceSchema = z.object({
  evidenceType: z.enum([
    "visible_page_text",
    "fee_details_page",
    "invoice",
    "purchase_document",
    "accepted_negotiation",
    "user_confirmation",
  ]),
  sourceText: z.string().trim().max(1000).optional(),
  sourceUrl: optionalHttpUrl,
  capturedAt: z.string().datetime().optional(),
  confidenceScore: score,
}).strict();
const sourceEvidenceSchema = z.object({
  scope: z.enum(marketSnapCaptureScopes),
  evidenceType: z.enum([
    "dom_text",
    "expanded_section",
    "network_response_summary",
    "fee_outcome",
    "post_sale_outcome",
    "media_url",
    "manual_confirmation",
  ]).optional(),
  sourceText: z.string().trim().max(1000).optional(),
  sourceUrl: optionalHttpUrl,
  endpointPattern: z.string().trim().min(1).max(240).optional(),
  capturedAt: z.string().datetime().optional(),
  confidenceScore: score,
}).strict();
const extractionFieldEvidenceSchema = z.object({
  field: z.string().trim().min(1).max(80),
  value: z.unknown(),
  normalizedValue: z.unknown().optional(),
  sourceType: z.enum([
    "dom_label",
    "dom_attribute",
    "section_map",
    "network_json",
    "safe_expansion",
    "fee_page",
    "post_sale_page",
    "manual_confirmation",
    "fallback_regex",
  ]),
  sourceName: z.string().trim().max(120).optional(),
  sourceText: z.string().trim().max(1000).optional(),
  endpointPattern: z.string().trim().max(240).optional(),
  pageType: z.string().trim().max(80).optional(),
  captureKind: z.string().trim().max(80).optional(),
  confidenceScore: z.coerce.number().finite().min(0).max(100),
  capturedAt: z.string().datetime(),
  consentId: z.string().uuid().optional(),
}).strict();

export const conditionFeaturesSchema = z.object({
  rust: z.object({
    rustDetected: z.boolean().optional(),
    rustSeverity: rustSeverity.optional(),
    rustLocations: textList,
    rustConfidenceScore: score,
  }).optional(),
  cosmetic: z.object({
    cosmeticDamageDetected: z.boolean().optional(),
    cosmeticDamageSeverity: conditionSeverity.optional(),
    damageTypes: textList,
  }).optional(),
  mechanical: z.object({
    mechanicalIssueDetected: z.boolean().optional(),
    mechanicalIssueSeverity: conditionSeverity.optional(),
    engineIssue: z.boolean().optional(),
    transmissionIssue: z.boolean().optional(),
    brakeIssue: z.boolean().optional(),
    suspensionIssue: z.boolean().optional(),
    steeringIssue: z.boolean().optional(),
    electricalIssue: z.boolean().optional(),
    coolingSystemIssue: z.boolean().optional(),
    exhaustIssue: z.boolean().optional(),
    batteryIssue: z.boolean().optional(),
    hybridBatteryIssue: z.boolean().optional(),
  }).optional(),
  title: z.object({
    cleanTitle: z.boolean().optional(),
    rebuiltTitle: z.boolean().optional(),
    salvageTitle: z.boolean().optional(),
    partsOnly: z.boolean().optional(),
    nonRepairable: z.boolean().optional(),
    theftRecovery: z.boolean().optional(),
    floodDamage: z.boolean().optional(),
    fireDamage: z.boolean().optional(),
    hailDamage: z.boolean().optional(),
  }).optional(),
}).strict().optional();

export const imageFeaturesSchema = z.object({
  imageCount: z.coerce.number().int().min(0).max(500).optional(),
  photoQualityScore: score,
  missingAngleScore: score,
  hasFrontPhoto: z.boolean().optional(),
  hasRearPhoto: z.boolean().optional(),
  hasLeftSidePhoto: z.boolean().optional(),
  hasRightSidePhoto: z.boolean().optional(),
  hasInteriorPhoto: z.boolean().optional(),
  hasDashboardPhoto: z.boolean().optional(),
  hasOdometerPhoto: z.boolean().optional(),
  hasEngineBayPhoto: z.boolean().optional(),
  hasUnderbodyPhoto: z.boolean().optional(),
  visualConditionScore: score,
  rustVisibleScore: score,
  damageVisibleScore: score,
  odometerDetected: z.boolean().optional(),
  odometerPhotoDetected: z.boolean().optional(),
  odometerReadingExtracted: z.coerce.number().int().min(0).max(2_000_000).optional(),
  mileageConsistencyScore: score,
  mileageMismatchWarning: z.boolean().optional(),
  imageProcessedAt: z.string().datetime().optional(),
  photoAnalysisStatus: z.enum(["not_started", "pending", "processed", "failed", "unknown"]).optional(),
  imageProcessingErrors: z.array(z.string().trim().min(1).max(240)).max(50).optional(),
}).strict().optional();

export const diagnosticFeaturesSchema = z.object({
  diagnosticCodesAvailable: z.boolean().optional(),
  obdCodes: z.array(z.object({
    code: z.string().trim().regex(/^[A-Z][0-9A-Z]{4}$/i).transform((value) => value.toUpperCase()),
    systemCategory: z.string().trim().max(80).optional(),
    description: z.string().trim().max(240).optional(),
    severity: diagnosticSeverity.optional(),
    possibleCauses: textList,
    estimatedRepairCostLow: money,
    estimatedRepairCostHigh: money,
    valuationImpact: money,
    riskImpact: score,
  }).strict()).max(50).optional(),
  codeCount: z.coerce.number().int().min(0).max(200).optional(),
  codeSeverityScore: score,
  highestCodeSeverity: diagnosticSeverity.optional(),
  estimatedRepairCostFromCodes: money,
}).strict().optional();

function jsonByteLength(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function validateSafeJsonValue(value: unknown, context: z.RefinementCtx, options: { maxArrayLength: number }, path: string[] = [], depth = 0) {
  if (depth > 8) {
    context.addIssue({ code: "custom", path, message: "Structured extraction payload is nested too deeply." });
    return;
  }

  if (typeof value === "string") {
    if (value.length > 4000) {
      context.addIssue({ code: "custom", path, message: "Structured extraction strings must be capped at 4,000 characters." });
    }
    if (unsafeUrlProtocol.test(value)) {
      context.addIssue({ code: "custom", path, message: "Structured extraction payload cannot contain script, data, or vbscript URLs." });
    }
    if (urlLikeKey.test(path.at(-1) ?? "") && looksLikeUrl(value)) {
      const protocol = safeProtocol(value);
      if (protocol && protocol !== "http:" && protocol !== "https:") {
        context.addIssue({ code: "custom", path, message: "Structured extraction URL fields must use http or https." });
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > options.maxArrayLength) {
      context.addIssue({ code: "custom", path, message: `Structured extraction arrays are capped at ${options.maxArrayLength} items.` });
    }
    value.slice(0, options.maxArrayLength + 1).forEach((item, index) => validateSafeJsonValue(item, context, options, path.concat(String(index)), depth + 1));
    return;
  }

  if (!value || typeof value !== "object") return;

  const entries = Object.entries(value);
  if (entries.length > 120) {
    context.addIssue({ code: "custom", path, message: "Structured extraction objects are capped at 120 keys." });
  }
  for (const [key, item] of entries.slice(0, 121)) {
    if (unsafeJsonKey.test(key)) {
      context.addIssue({ code: "custom", path: path.concat(key), message: "Structured extraction payload cannot contain credential or session fields." });
    }
    validateSafeJsonValue(item, context, options, path.concat(key), depth + 1);
  }
}

function looksLikeUrl(value: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || /^https?:\/\//i.test(value);
}

function safeProtocol(value: string) {
  try {
    return new URL(value).protocol;
  } catch {
    return "";
  }
}

const marketListingPayloadBaseSchema = z.object({
  organizationId: z.string().uuid(),
  sourceName: z.string().trim().min(1).max(120),
  sourceType: z.enum(marketSourceTypes).optional(),
  pageType: z.enum(openLanePageTypes).optional(),
  captureKind: z.enum(marketCaptureKinds).optional(),
  captureLevel: z.enum(marketSnapCaptureLevels).optional(),
  captureScopes: z.array(z.enum(marketSnapCaptureScopes)).max(marketSnapCaptureScopes.length).optional(),
  deepCaptureConsentId: z.string().uuid().optional(),
  sourceEvidence: z.array(sourceEvidenceSchema).max(50).optional(),
  outcomeConfidence: z.enum(outcomeConfidenceLevels).optional(),
  priceSemantics: z.partialRecord(z.enum(priceSemanticFields), z.enum(priceSemanticValues)).optional(),
  outcomeEvidence: z.array(captureEvidenceSchema).max(20).optional(),
  listingUrl: optionalHttpUrl,
  title: optionalText,
  description: optionalText,
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  make: optionalText,
  model: optionalText,
  trim: optionalText,
  vin: z.string().trim().regex(/^[A-HJ-NPR-Z0-9]{17}$/i).transform((value) => value.toUpperCase()).optional(),
  mileageKm: z.coerce.number().int().min(0).max(2_000_000).optional(),
  exteriorColor: shortText,
  interiorColor: shortText,
  drivetrain: shortText,
  transmission: shortText,
  engine: shortText,
  fuelType: shortText,
  bodyStyle: shortText,
  doors: z.coerce.number().int().min(0).max(10).optional(),
  cylinders: z.coerce.number().int().min(0).max(24).optional(),
  listedPrice: money,
  currentBid: money,
  currentOffer: money,
  bestOffer: money,
  buyNowPrice: money,
  reservePrice: money,
  soldPriceCandidate: money,
  finalBidAmount: money,
  negotiatedAmount: money,
  counterOfferAmount: money,
  acceptedAmount: money,
  negotiationStatus: shortText,
  negotiatedAt: shortText,
  acceptedAt: shortText,
  userConfirmedFinalPrice: z.boolean().optional(),
  confirmedAt: z.string().datetime().optional(),
  confirmationNote: optionalText,
  buyPriceAuction: money,
  transactionFee: money,
  vehicleHistoryFee: money,
  otherFees: money,
  subtotal: money,
  taxes: money,
  totalInvoiceAmount: money,
  finalAcquisitionCost: money,
  estimatedAuctionFees: money,
  auctionHammerPrice: money,
  location: optionalText,
  province: optionalText,
  sellerName: shortText,
  sellerType: optionalText,
  auctionStatus: shortText,
  saleDate: shortText,
  runNumber: shortText,
  lane: shortText,
  lotNumber: shortText,
  stockNumber: shortText,
  titleStatus: optionalText,
  declarations: longerTextList,
  damageAnnouncements: longerTextList,
  mechanicalAnnouncements: longerTextList,
  structuralAnnouncements: longerTextList,
  odometerAnnouncements: longerTextList,
  tireCondition: shortText,
  keysAvailable: z.union([z.boolean(), z.string().trim().max(240)]).optional().or(z.literal("")),
  carfaxUrl: optionalHttpUrl,
  carfaxMentioned: z.boolean().optional(),
  carfaxAvailable: z.boolean().optional(),
  carfaxUrlStatus: z.enum(["url_found", "text_only", "missing"]).optional(),
  photos: z.array(marketListingPhotoSchema).max(200).optional(),
  videos: z.array(marketListingVideoSchema).max(50).optional(),
  videoCount: z.coerce.number().int().min(0).max(100).optional(),
  rawVisibleText: z.string().trim().max(12_000).optional().or(z.literal("")),
  pageContext: safeDeepRecord(12_000).optional(),
  identity: safeDeepRecord(12_000).optional(),
  auctionObservation: safeDeepRecord(12_000).optional(),
  purchaseOutcome: safeDeepRecord(12_000).optional(),
  condition: safeDeepRecord(20_000).optional(),
  media: safeDeepRecord(40_000, 240).optional(),
  carfax: safeDeepRecord(12_000).optional(),
  debug: safeDeepRecord(30_000, 160).optional(),
  fieldEvidence: z.record(z.string(), z.array(extractionFieldEvidenceSchema).max(20)).optional(),
  openlaneMetadata: safeDeepRecord(40_000, 200).optional(),
  extractedFields: safeDeepRecord(30_000, 160).optional(),
  missingData: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  warnings: z.array(z.string().trim().min(1).max(240)).max(50).optional(),
  extractionConfidenceScore: score,
  conditionReportText: optionalText,
  imageCount: z.coerce.number().int().min(0).max(500).optional(),
  conditionFeatures: conditionFeaturesSchema,
  imageFeatures: imageFeaturesSchema,
  diagnosticFeatures: diagnosticFeaturesSchema,
  capturedAt: z.string().datetime().optional(),
  marketType: z.enum(marketTypes).optional(),
});

function enforceCaptureContract(value: Partial<z.infer<typeof marketListingPayloadBaseSchema>>, context: z.RefinementCtx) {
  const activeObservationPages = new Set(["active_listing", "watchlist"]);
  const outcomePriceFields = [
    "soldPriceCandidate",
    "finalBidAmount",
    "negotiatedAmount",
    "counterOfferAmount",
    "acceptedAmount",
    "buyPriceAuction",
    "transactionFee",
    "vehicleHistoryFee",
    "otherFees",
    "subtotal",
    "taxes",
    "totalInvoiceAmount",
    "finalAcquisitionCost",
  ] as const;
  const verifiedOutcomeFields = [
    "finalBidAmount",
    "negotiatedAmount",
    "acceptedAmount",
    "buyPriceAuction",
    "totalInvoiceAmount",
    "finalAcquisitionCost",
  ] as const;
  const hasOutcomePrice = outcomePriceFields.some((field) => value[field] !== undefined);
  const hasVerifiedOutcomePrice = verifiedOutcomeFields.some((field) => value[field] !== undefined);

  if (activeObservationPages.has(value.pageType ?? "") && value.captureKind && value.captureKind !== "observation") {
    context.addIssue({
      code: "custom",
      path: ["captureKind"],
      message: "Active OpenLane listing captures must remain observations, not outcome labels.",
    });
  }

  if (activeObservationPages.has(value.pageType ?? "") && hasOutcomePrice) {
    context.addIssue({
      code: "custom",
      path: ["pageType"],
      message: "Active OpenLane listing pages cannot carry final or candidate outcome price fields.",
    });
  }

  if (value.captureKind === "observation" && hasOutcomePrice) {
    context.addIssue({
      code: "custom",
      path: ["captureKind"],
      message: "Observation captures cannot include outcome price fields.",
    });
  }

  if (value.captureKind === "verified_outcome" && !hasVerifiedOutcomePrice) {
    context.addIssue({
      code: "custom",
      path: ["captureKind"],
      message: "Verified outcome captures require a verified outcome price field.",
    });
  }

  if ((value.captureKind === "verified_outcome" || value.outcomeConfidence === "verified") && !value.outcomeEvidence?.length) {
    context.addIssue({
      code: "custom",
      path: ["outcomeEvidence"],
      message: "Verified outcome captures require visible evidence.",
    });
  }

  for (const field of ["currentBid", "currentOffer", "bestOffer"] as const) {
    if (value.priceSemantics?.[field] && value.priceSemantics[field] !== "observation") {
      context.addIssue({
        code: "custom",
        path: ["priceSemantics", field],
        message: `${field} is an observation feature only and cannot be marked as a label.`,
      });
    }
  }

  for (const field of outcomePriceFields) {
    const semantic = value.priceSemantics?.[field];
    if (value[field] !== undefined && semantic === "observation") {
      context.addIssue({
        code: "custom",
        path: ["priceSemantics", field],
        message: `${field} is an outcome/acquisition field and cannot be marked as an observation.`,
      });
    }
  }
}

export const marketListingPayloadSchema = marketListingPayloadBaseSchema.superRefine(enforceCaptureContract);
const listingWithoutOrganizationSchema = marketListingPayloadBaseSchema
  .omit({ organizationId: true })
  .superRefine(enforceCaptureContract);
const importListingRowSchema = marketListingPayloadBaseSchema
  .omit({ organizationId: true, sourceName: true })
  .extend({
    sourceName: z.string().trim().min(1).max(120).optional(),
  })
  .superRefine(enforceCaptureContract);

export const valuationRequestSchema = z.object({
  organizationId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  listing: listingWithoutOrganizationSchema.optional(),
});

export const saveListingSchema = z.object({
  organizationId: z.string().uuid(),
  listing: listingWithoutOrganizationSchema,
  valuation: z.record(z.string(), z.unknown()).optional(),
});

export const dealRadarQuerySchema = z.object({
  organizationId: z.string().uuid(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const importPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  sourceName: z.string().trim().min(1).max(120),
  rows: z.array(importListingRowSchema).min(1).max(1000),
});

export const deepCaptureConsentActionSchema = z.object({
  organizationId: z.string().uuid(),
  action: z.enum([
    "status",
    "accept",
    "withdraw",
    "list_events",
    "export_audit",
    "delete_eligible_captures",
    "disable_model_improvement",
  ]),
  captureScopes: z.array(z.enum(marketSnapCaptureScopes)).max(marketSnapCaptureScopes.length).optional(),
  modelImprovementOptIn: z.boolean().optional(),
  extensionInstallationId: z.string().trim().min(8).max(120).optional().or(z.literal("")),
  source: z.enum(["web_app_settings", "extension_options", "onboarding"]).default("extension_options"),
});

export const authorizedExtractionRequestSchema = z.object({
  organizationId: z.string().uuid(),
  html: z.string().min(1).max(1_000_000),
  sourceName: z.string().trim().min(1).max(120),
  sourceUrl: optionalHttpUrl,
  sourceType: z.enum(marketSourceTypes).optional(),
  permissionBasis: z.string().trim().min(3).max(500),
  robotsAllowed: z.boolean().optional(),
});

export const authorizedExtractionResponseSchema = z.object({
  ok: z.boolean(),
  listing: marketListingPayloadBaseSchema.omit({ organizationId: true }).partial().extend({
    imageUrls: z.array(z.string().url()).max(30).optional(),
  }).optional().nullable(),
  warnings: z.array(z.string()).default([]),
  missingFields: z.array(z.string()).default([]),
  degraded: z.boolean().default(false),
  extractionQualityScore: z.coerce.number().min(0).max(100).default(0),
  policyDecision: z.string().default("unknown"),
  policyReasons: z.array(z.string()).default([]),
  fallbackStrategies: z.array(z.string()).default([]),
  rawVisibleTextPreview: z.string().optional(),
});
