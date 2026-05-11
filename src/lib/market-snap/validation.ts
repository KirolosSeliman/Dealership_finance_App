import { z } from "zod";

export const marketTypes = [
  "clean_retail_market",
  "clean_wholesale_market",
  "auction_market",
  "salvage_auction_market",
  "rebuilt_market",
  "parts_or_non_running_market",
] as const;

export const marketSourceTypes = ["retail", "wholesale", "auction", "salvage", "import", "extension"] as const;

const optionalText = z.string().trim().max(4000).optional().or(z.literal(""));
const urlText = z.string().trim().url().optional().or(z.literal(""));
const money = z.coerce.number().finite().min(0).max(99_999_999).optional();
const score = z.coerce.number().finite().min(0).max(100).optional();
const conditionSeverity = z.enum(["none", "light", "moderate", "severe", "unknown"]);
const rustSeverity = z.enum(["none", "light", "moderate", "severe", "structural", "unknown"]);
const diagnosticSeverity = z.enum(["low", "medium", "high", "critical"]);
const textList = z.array(z.string().trim().min(1).max(80)).max(30).optional();

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

export const marketListingPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  sourceName: z.string().trim().min(1).max(120),
  sourceType: z.enum(marketSourceTypes).optional(),
  listingUrl: urlText,
  title: optionalText,
  description: optionalText,
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  make: optionalText,
  model: optionalText,
  trim: optionalText,
  mileageKm: z.coerce.number().int().min(0).max(2_000_000).optional(),
  listedPrice: money,
  auctionHammerPrice: money,
  location: optionalText,
  province: optionalText,
  sellerType: optionalText,
  titleStatus: optionalText,
  conditionReportText: optionalText,
  imageCount: z.coerce.number().int().min(0).max(500).optional(),
  conditionFeatures: conditionFeaturesSchema,
  imageFeatures: imageFeaturesSchema,
  diagnosticFeatures: diagnosticFeaturesSchema,
  capturedAt: z.string().datetime().optional(),
  marketType: z.enum(marketTypes).optional(),
});

export const valuationRequestSchema = z.object({
  organizationId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  listing: marketListingPayloadSchema.omit({ organizationId: true }).optional(),
});

export const saveListingSchema = z.object({
  organizationId: z.string().uuid(),
  listing: marketListingPayloadSchema.omit({ organizationId: true }),
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
  rows: z.array(marketListingPayloadSchema.omit({ organizationId: true, sourceName: true }).extend({
    sourceName: z.string().trim().min(1).max(120).optional(),
  })).min(1).max(1000),
});
