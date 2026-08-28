import { z } from "zod";
import {
  CONTACT_TYPES,
  EXPENSE_CATEGORIES,
  EXPENSE_FUNDING_SOURCES,
  EXPENSE_TAX_BEHAVIORS,
  MANUAL_CASH_TRANSACTION_TYPES,
  PURCHASE_SOURCES,
  ROLES,
  VEHICLE_STATUSES,
} from "@/lib/domain/constants";

const optionalText = z.string().trim().optional().or(z.literal(""));
const money = z.coerce.number().finite().min(0).max(999_999_999);
const centMoney = money.refine((value) => Number.isInteger(value * 100), "Use no more than two decimal places.");
const taxRate = z.coerce.number().finite().min(0).max(1);
const positiveMoney = z.coerce.number().finite().positive().max(999_999_999);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const cashTransactionTypes = [...MANUAL_CASH_TRANSACTION_TYPES] as [string, ...string[]];
const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeVin(value: unknown) {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

export const vinSchema = z.preprocess(
  normalizeVin,
  z.string().refine((value) => value === "" || vinPattern.test(value), {
    message: "VIN must be 17 characters and cannot contain I, O, or Q.",
  }),
);

export const organizationSchema = z.object({
  organizationName: z.string().trim().min(1).max(120),
});

export const invitationCodeSchema = z.object({
  inviteCode: z.string().trim().min(4).max(64),
});

export const vehicleSchema = z.object({
  vin: vinSchema,
  year: z.coerce.number().int().min(1900).max(2100).optional().or(z.literal("")),
  make: optionalText,
  model: optionalText,
  trim: optionalText,
  color: optionalText,
  mileage: z.coerce.number().int().min(0).max(2_000_000).optional().or(z.literal("")),
  purchasePrice: money,
  purchaseDate: dateString,
  purchaseSource: z.enum(PURCHASE_SOURCES as [string, ...string[]]),
  purchaseTaxRate: taxRate.optional(),
  status: z.enum(VEHICLE_STATUSES as [string, ...string[]]),
  listedPrice: money.optional().or(z.literal("")),
  notes: optionalText,
});

export const vehicleV2Schema = vehicleSchema.extend({
  purchaseTaxRate: taxRate,
});

export const vehicleUpdateSchema = vehicleSchema.pick({
  vin: true,
  year: true,
  make: true,
  model: true,
  trim: true,
  color: true,
  mileage: true,
  listedPrice: true,
  notes: true,
}).extend({
  updateMode: z.literal("basic").optional(),
});

export const vehicleStatusUpdateSchema = z.object({
  updateMode: z.literal("status"),
  status: z.enum(VEHICLE_STATUSES as [string, ...string[]]),
  reason: optionalText,
});

export const vehiclePurchaseCorrectionSchema = z.object({
  updateMode: z.literal("purchase"),
  purchasePrice: money,
  purchaseDate: dateString,
  purchaseSource: z.enum(PURCHASE_SOURCES as [string, ...string[]]),
  purchaseTaxRate: taxRate,
  reason: z.string().trim().min(3).max(500),
});

export const vehicleAnyUpdateSchema = z.union([
  vehicleUpdateSchema,
  vehicleStatusUpdateSchema,
  vehiclePurchaseCorrectionSchema,
]);

export const archiveVehicleSchema = z.object({
  vehicleId: z.string().uuid(),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});

export const expenseVoidSchema = z.object({
  vehicleId: z.string().uuid(),
  expenseId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES as [string, ...string[]]),
  amountBeforeTax: money,
  addTax: z.string().optional(),
  fundingSource: z.enum(EXPENSE_FUNDING_SOURCES as [string, ...string[]]).optional(),
  date: dateString.optional().or(z.literal("")),
  note: optionalText,
});

export const recurringExpenseTemplateSchema = z.object({
  templateId: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(1).max(120),
  description: optionalText,
  category: z.enum(EXPENSE_CATEGORIES as [string, ...string[]]),
  amountBeforeTax: money,
  taxBehavior: z.enum(EXPENSE_TAX_BEHAVIORS as [string, ...string[]]),
  customTaxRate: z.coerce.number().finite().min(0).max(1).optional().or(z.literal("")),
  defaultFundingSource: z.enum(EXPENSE_FUNDING_SOURCES as [string, ...string[]]),
  autoApplyToNewVehicles: z.string().optional(),
  isActive: z.string().optional(),
});

export const applyRecurringExpenseTemplateSchema = z.object({
  vehicleId: z.string().uuid(),
  templateId: z.string().uuid(),
});

const legacySaleSchema = z.object({
  saleDate: dateString.optional().or(z.literal("")),
  taxableProfitAmount: money,
  realClientPayment: money,
  buyerName: optionalText,
  phone: optionalText,
  email: z.string().email().optional().or(z.literal("")),
  address: optionalText,
  notes: optionalText,
});

const saleV2Fields = z.object({
  saleDate: dateString.optional().or(z.literal("")),
  salePriceBeforeTax: centMoney,
  salesTaxRate: taxRate,
  companyPaymentAmount: centMoney,
  externalPaymentAmount: centMoney,
  buyerName: optionalText,
  phone: optionalText,
  email: z.string().email().optional().or(z.literal("")),
  address: optionalText,
  notes: optionalText,
});

function refineSaleV2Payments(value: z.infer<typeof saleV2Fields>, context: z.RefinementCtx) {
  const salesTaxAmount = Math.round(value.salePriceBeforeTax * value.salesTaxRate * 100) / 100;
  const customerTotalCents = Math.round((value.salePriceBeforeTax + salesTaxAmount) * 100);
  if (Math.round((value.companyPaymentAmount + value.externalPaymentAmount) * 100) !== customerTotalCents) {
    context.addIssue({
      code: "custom",
      path: ["companyPaymentAmount"],
      message: "Company and external payments must equal the customer total exactly.",
    });
  }
}

export const saleV2Schema = saleV2Fields.superRefine(refineSaleV2Payments);

// Keep the legacy shape parseable for historical correction/import callers.
export const saleSchema = z.union([saleV2Schema, legacySaleSchema]);

export const saleVoidSchema = z.object({
  saleId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export const saleCorrectionSchema = z.union([
  saleV2Fields.extend({
    saleId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
  }).superRefine(refineSaleV2Payments),
  legacySaleSchema.extend({
    saleId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
  }),
]);

export const cashTransactionSchema = z.object({
  type: z.enum(cashTransactionTypes),
  amount: positiveMoney,
  date: dateString.optional().or(z.literal("")),
  note: optionalText,
});

export const cashUpdateSchema = z.object({
  amount: positiveMoney,
  date: dateString,
  note: optionalText,
});

export const contactSchema = z.object({
  type: z.enum(CONTACT_TYPES as [string, ...string[]]),
  customTypeDescription: optionalText,
  fullName: z.string().trim().min(1).max(160),
  phone: optionalText,
  email: z.string().email().optional().or(z.literal("")),
  address: optionalText,
  notes: optionalText,
  desiredVehicleTypes: optionalText,
  budgetMin: money.optional().or(z.literal("")),
  budgetMax: money.optional().or(z.literal("")),
  commissionAgreement: optionalText,
  location: optionalText,
  followUpNotes: optionalText,
  lastContactedDate: dateString.optional().or(z.literal("")),
  exportRegion: optionalText,
  exportShippingNotes: optionalText,
  preferredCommunicationMethod: optionalText,
});

export const attachmentSchema = z.object({
  type: z.enum(["file", "photo", "link"]).optional().or(z.literal("")),
  title: z.string().trim().min(1).max(180),
  urlOrPath: optionalText,
  notes: optionalText,
  isSensitive: z.string().optional(),
}).superRefine((value, context) => {
  if (value.urlOrPath) {
    try {
      const url = new URL(value.urlOrPath);
      if (!["http:", "https:"].includes(url.protocol)) {
        context.addIssue({ code: "custom", path: ["urlOrPath"], message: "Only http and https links are allowed." });
      }
    } catch {
      context.addIssue({ code: "custom", path: ["urlOrPath"], message: "Enter a valid URL." });
    }
  }
});

export const roleUpdateSchema = z.object({
  membershipId: z.string().uuid(),
  role: z.enum(ROLES as [string, ...string[]]),
});

export const backupRequestSchema = z.object({
  organizationId: z.string().uuid(),
});

export const taxExportSchema = z.object({
  organizationId: z.string().uuid(),
  startDate: dateString.optional().or(z.literal("")),
  endDate: dateString.optional().or(z.literal("")),
  format: z.enum(["pdf", "csv", "json"]),
}).superRefine((value, context) => {
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after start date." });
  }
});

export const activityLogSchema = z.object({
  organizationId: z.string().uuid(),
  action: z.enum(["backup_verified"]),
  entityType: z.enum(["backup"]),
  message: z.string().trim().min(1).max(240),
});

export const regenerateInvitationSchema = z.object({
  organizationId: z.string().uuid(),
});

export function formDataToObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export function formatValidationError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "field"}: ${issue.message}`).join(" ");
  }
  if (typeof error === "object" && error !== null && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    const message = String((error as { message: string }).message).trim();
    if (message) return message;
  }
  return error instanceof Error ? error.message : "Invalid input.";
}
