import { z } from "zod";
import { EXPENSE_CATEGORIES, EXPENSE_FUNDING_SOURCES, EXPENSE_TAX_BEHAVIORS, PURCHASE_SOURCES, ROLES, VEHICLE_STATUSES } from "@/lib/domain/constants";

const optionalText = z.string().trim().optional().or(z.literal(""));
const money = z.coerce.number().finite().min(0).max(999_999_999);
const positiveMoney = z.coerce.number().finite().positive().max(999_999_999);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const organizationSchema = z.object({
  organizationName: z.string().trim().min(1).max(120),
});

export const invitationCodeSchema = z.object({
  inviteCode: z.string().trim().min(4).max(64),
});

export const vehicleSchema = z.object({
  vin: optionalText,
  year: z.coerce.number().int().min(1900).max(2100).optional().or(z.literal("")),
  make: optionalText,
  model: optionalText,
  trim: optionalText,
  color: optionalText,
  mileage: z.coerce.number().int().min(0).max(2_000_000).optional().or(z.literal("")),
  purchasePrice: money,
  purchaseDate: dateString,
  purchaseSource: z.enum(PURCHASE_SOURCES as [string, ...string[]]),
  status: z.enum(VEHICLE_STATUSES as [string, ...string[]]),
  listedPrice: money.optional().or(z.literal("")),
  notes: optionalText,
});

export const vehicleUpdateSchema = vehicleSchema.pick({
  vin: true,
  year: true,
  make: true,
  model: true,
  trim: true,
  color: true,
  mileage: true,
  notes: true,
});

export const deleteVehicleSchema = z.object({
  vehicleId: z.string().uuid(),
  confirmationText: z.string().trim().min(1).max(100),
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
  templateId: z.string().uuid(),
});

export const saleSchema = z.object({
  saleDate: dateString.optional().or(z.literal("")),
  taxableProfitAmount: money,
  realClientPayment: money,
  buyerName: optionalText,
  phone: optionalText,
  email: z.string().email().optional().or(z.literal("")),
  address: optionalText,
  notes: optionalText,
});

export const cashTransactionSchema = z.object({
  type: z.string().min(1).max(80),
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
  type: z.string().min(1).max(80),
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
  return error instanceof Error ? error.message : "Invalid input.";
}
