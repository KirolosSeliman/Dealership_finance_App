import type {
  ActivityLog,
  AppData,
  Attachment,
  CompanyCashTransaction,
  Contact,
  ExternalCashTransaction,
  OrganizationMembership,
  Organization,
  RecurringVehicleExpenseTemplate,
  Sale,
  Vehicle,
  VehicleExpense,
} from "@/types/domain";

type Row = Record<string, unknown>;

export const emptyAppData: AppData = {
  organizations: [],
  memberships: [],
  activeOrganizationId: "",
  userName: "",
  vehicles: [],
  expenses: [],
  recurringExpenseTemplates: [],
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
  };
}

export function dedupeOrganizationsByHighestRole(organizations: Organization[]) {
  const byId = new Map<string, Organization>();
  organizations.forEach((organization) => {
    const existing = byId.get(organization.id);
    if (!existing || rolePriority(organization.role) > rolePriority(existing.role)) {
      byId.set(organization.id, {
        ...organization,
        inviteCode: organization.inviteCode || existing?.inviteCode || "",
      });
      return;
    }
    if (!existing.inviteCode && organization.inviteCode) {
      byId.set(organization.id, { ...existing, inviteCode: organization.inviteCode });
    }
  });
  return Array.from(byId.values());
}

export function mapMembership(row: Row): OrganizationMembership {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userId: String(row.user_id),
    role: String(row.role ?? "viewer") as OrganizationMembership["role"],
    createdAt: dateTimeValue(row.created_at),
  };
}

function rolePriority(role: Organization["role"]) {
  return {
    viewer: 1,
    accountant: 2,
    member: 3,
    admin: 4,
    owner: 5,
  }[role] ?? 0;
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
    archivedAt: optionalString(row.archived_at),
    archivedBy: optionalString(row.archived_by),
    archiveReason: optionalString(row.archive_reason),
  };
}

export function mapExpense(row: Row): VehicleExpense {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    vehicleId: String(row.vehicle_id),
    recurringTemplateId: optionalString(row.recurring_template_id),
    category: String(row.category) as VehicleExpense["category"],
    amountBeforeTax: numberValue(row.amount_before_tax),
    taxRate: numberValue(row.tax_rate),
    taxAmount: numberValue(row.tax_amount),
    totalAmount: numberValue(row.total_amount),
    fundingSource: String(row.funding_source ?? "company_cash") as VehicleExpense["fundingSource"],
    date: dateValue(row.date),
    note: optionalString(row.note),
    createdAt: dateTimeValue(row.created_at),
    createdBy: String(row.created_by ?? ""),
  };
}

export function mapRecurringExpenseTemplate(row: Row): RecurringVehicleExpenseTemplate {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name ?? ""),
    description: optionalString(row.description),
    category: String(row.category ?? "other") as RecurringVehicleExpenseTemplate["category"],
    amountBeforeTax: numberValue(row.amount_before_tax),
    taxRate: numberValue(row.tax_rate),
    taxAmount: numberValue(row.tax_amount),
    totalAmount: numberValue(row.total_amount),
    taxBehavior: String(row.tax_behavior ?? "no_tax") as RecurringVehicleExpenseTemplate["taxBehavior"],
    defaultFundingSource: String(row.default_funding_source ?? "company_cash") as RecurringVehicleExpenseTemplate["defaultFundingSource"],
    autoApplyToNewVehicles: Boolean(row.auto_apply_to_new_vehicles),
    isActive: Boolean(row.is_active),
    createdAt: dateTimeValue(row.created_at),
    updatedAt: dateTimeValue(row.updated_at),
    createdBy: String(row.created_by ?? ""),
    deletedAt: optionalString(row.deleted_at),
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
    sourceExpenseId: optionalString(row.source_expense_id),
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
    sourceExpenseId: optionalString(row.source_expense_id),
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
