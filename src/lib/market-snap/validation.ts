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
  rows: z.array(marketListingPayloadSchema.omit({ organizationId: true })).min(1).max(1000),
});
