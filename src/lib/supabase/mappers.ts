import type {
  ActivityLog,
  AppData,
  Attachment,
  CompanyCashTransaction,
  Contact,
  ExternalCashTransaction,
  Organization,
  Sale,
  Vehicle,
  VehicleExpense,
} from "@/types/domain";
import { DEFAULT_PLATE_COMMISSION_AMOUNT } from "@/lib/domain/constants";

type Row = Record<string, unknown>;

export const emptyAppData: AppData = {
  organizations: [],
  activeOrganizationId: "",
  userName: "",
  vehicles: [],
  expenses: [],
  sales: [],
  contacts: [],
  attachments: [],
  companyCashTransactions: [],
  externalCashTransactions: [],
  activityLogs: [],
};

export function mapOrganization(row: Row): Organization {
  const organization = row.organizations as Row | null | undefined;
  return {
    id: String(row.organization_id ?? row.id),
    name: String(organization?.name ?? row.name ?? "Organization"),
    role: String(row.role ?? "viewer") as Organization["role"],
    inviteCode: String(row.access_code ?? row.invite_code ?? ""),
    defaultPlateCommissionAmount: numberValue(
      organization?.default_plate_commission_amount ?? row.default_plate_commission_amount ?? DEFAULT_PLATE_COMMISSION_AMOUNT,
    ),
  };
}

export function mapVehicle(row: Row): Vehicle {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    vin: String(row.vin ?? ""),
    year: optionalNumber(row.year),
    make: optionalString(row.make),
    model: optionalString(row.model),
    trim: optionalString(row.trim),
    color: optionalString(row.color),
    mileage: optionalNumber(row.mileage),
    purchasePrice: numberValue(row.purchase_price),
    purchaseDate: dateValue(row.purchase_date),
    purchaseSource: String(row.purchase_source ?? "other") as Vehicle["purchaseSource"],
    status: String(row.status ?? "purchased") as Vehicle["status"],
    listedPrice: optionalNumber(row.listed_price),
    notes: optionalString(row.notes),
    mainPhotoPath: optionalString(row.main_photo_path),
    mainPhotoUrl: optionalString(row.main_photo_path),
    createdAt: dateTimeValue(row.created_at),
    updatedAt: dateTimeValue(row.updated_at),
    createdBy: String(row.created_by ?? ""),
  };
}

export function mapExpense(row: Row): VehicleExpense {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    vehicleId: String(row.vehicle_id),
    category: String(row.category) as VehicleExpense["category"],
    amountBeforeTax: numberValue(row.amount_before_tax),
    taxRate: numberValue(row.tax_rate),
    taxAmount: numberValue(row.tax_amount),
    totalAmount: numberValue(row.total_amount),
    date: dateValue(row.date),
    note: optionalString(row.note),
    createdAt: dateTimeValue(row.created_at),
    createdBy: String(row.created_by ?? ""),
  };
}

export function mapSale(row: Row): Sale {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    vehicleId: String(row.vehicle_id),
    contactId: optionalString(row.contact_id),
    saleDate: dateValue(row.sale_date),
    vehicleTotalCost: numberValue(row.vehicle_total_cost),
    taxableProfitAmount: numberValue(row.taxable_profit_amount),
    profitTaxDue: numberValue(row.profit_tax_due),
    paperSalePrice: numberValue(row.paper_sale_price),
    realClientPayment: numberValue(row.real_client_payment),
    externalCommission: numberValue(row.external_commission),
    notes: optionalString(row.notes),
    createdAt: dateTimeValue(row.created_at),
    createdBy: String(row.created_by ?? ""),
  };
}

export function mapContact(row: Row): Contact {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    type: String(row.type ?? "other") as Contact["type"],
    customTypeDescription: optionalString(row.custom_type_description),
    fullName: String(row.full_name ?? ""),
    phone: String(row.phone ?? ""),
    email: optionalString(row.email),
    address: optionalString(row.address),
    notes: optionalString(row.notes),
    desiredVehicleTypes: optionalString(row.desired_vehicle_types),
    budgetMin: optionalNumber(row.budget_min),
    budgetMax: optionalNumber(row.budget_max),
    commissionAgreement: optionalString(row.commission_agreement),
    location: optionalString(row.location),
    followUpNotes: optionalString(row.follow_up_notes),
    lastContactedDate: optionalString(row.last_contacted_date),
    exportRegion: optionalString(row.export_region),
    exportShippingNotes: optionalString(row.export_shipping_notes),
    preferredCommunicationMethod: optionalString(row.preferred_communication_method),
    createdAt: dateTimeValue(row.created_at),
    updatedAt: dateTimeValue(row.updated_at),
    createdBy: String(row.created_by ?? ""),
  };
}

export function mapAttachment(row: Row): Attachment {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    type: String(row.type ?? "file") as Attachment["type"],
    title: String(row.title ?? ""),
    urlOrPath: String(row.url_or_path ?? ""),
    previewUrl: optionalString(row.preview_url),
    vehicleId: optionalString(row.vehicle_id),
    expenseId: optionalString(row.expense_id),
    saleId: optionalString(row.sale_id),
    contactId: optionalString(row.contact_id),
    companyCashTransactionId: optionalString(row.company_cash_transaction_id),
    externalCashTransactionId: optionalString(row.external_cash_transaction_id),
    notes: optionalString(row.notes),
    isSensitive: Boolean(row.is_sensitive),
    createdAt: dateTimeValue(row.created_at),
    createdBy: String(row.created_by ?? ""),
  };
}

export function mapCompanyCashTransaction(row: Row): CompanyCashTransaction {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    type: String(row.type) as CompanyCashTransaction["type"],
    amount: numberValue(row.amount),
    date: dateValue(row.date),
    note: optionalString(row.note),
    sourceVehicleId: optionalString(row.source_vehicle_id),
    createdAt: dateTimeValue(row.created_at),
    createdBy: String(row.created_by ?? ""),
    updatedAt: optionalString(row.updated_at),
    deletedAt: optionalString(row.deleted_at),
    deletedBy: optionalString(row.deleted_by),
    deletionNote: optionalString(row.deletion_note),
  };
}

export function mapExternalCashTransaction(row: Row): ExternalCashTransaction {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    type: String(row.type) as ExternalCashTransaction["type"],
    amount: numberValue(row.amount),
    date: dateValue(row.date),
    note: optionalString(row.note),
    sourceVehicleId: optionalString(row.source_vehicle_id),
    createdAt: dateTimeValue(row.created_at),
    createdBy: String(row.created_by ?? ""),
    updatedAt: optionalString(row.updated_at),
    deletedAt: optionalString(row.deleted_at),
    deletedBy: optionalString(row.deleted_by),
    deletionNote: optionalString(row.deletion_note),
  };
}

export function mapActivityLog(row: Row): ActivityLog {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    action: String(row.action),
    entityType: String(row.entity_type),
    entityId: optionalString(row.entity_id),
    message: String(row.message ?? ""),
    createdAt: dateTimeValue(row.created_at),
    createdBy: String(row.created_by ?? ""),
  };
}

function optionalString(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateValue(value: unknown) {
  return String(value ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
}

function dateTimeValue(value: unknown) {
  return String(value ?? new Date().toISOString());
}
