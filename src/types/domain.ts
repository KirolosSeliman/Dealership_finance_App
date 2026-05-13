export type Language = "en" | "fr";

export type Role = "owner" | "admin" | "member" | "accountant" | "viewer";

export type VehicleStatus = "purchased" | "in_repair" | "listed_for_sale" | "sold";

export type PurchaseSource =
  | "OpenLane"
  | "dealerAuction"
  | "IAA"
  | "Copart"
  | "FacebookMarketplace"
  | "trade"
  | "other";

export type ExpenseCategory =
  | "vehicle_purchase_price"
  | "commission_plaque"
  | "auction_fee"
  | "transport"
  | "repair"
  | "inspection"
  | "detailing"
  | "parts"
  | "registration"
  | "storage"
  | "other";

export type ContactType =
  | "buyer"
  | "interested_in_buy_resell"
  | "export_contact"
  | "seller"
  | "partner"
  | "other";

export type AttachmentType = "file" | "photo" | "link";
export type ExpenseFundingSource = "company_cash" | "external_cash";
export type ExpenseTaxBehavior = "no_tax" | "add_15_percent" | "custom";

export type CompanyCashTransactionType =
  | "company_cash_added"
  | "company_cash_withdrawn"
  | "vehicle_cost_paid"
  | "paper_sale_received"
  | "external_transfer_received";

export type ExternalCashTransactionType =
  | "external_commission_earned"
  | "external_cash_transferred_to_company"
  | "external_cash_personally_removed"
  | "external_vehicle_expense_paid";

export interface Organization {
  id: string;
  name: string;
  role: Role;
  inviteCode: string;
}

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  organizationId: string;
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  color?: string;
  mileage?: number;
  purchasePrice: number;
  purchaseDate: string;
  purchaseSource: PurchaseSource;
  status: VehicleStatus;
  listedPrice?: number;
  notes?: string;
  mainPhotoPath?: string;
  mainPhotoUrl?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
}

export interface VehicleExpense {
  id: string;
  organizationId: string;
  vehicleId: string;
  recurringTemplateId?: string;
  category: ExpenseCategory;
  amountBeforeTax: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  fundingSource?: ExpenseFundingSource;
  date: string;
  note?: string;
  createdAt: string;
  createdBy: string;
}

export interface RecurringVehicleExpenseTemplate {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  category: ExpenseCategory;
  amountBeforeTax: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  taxBehavior: ExpenseTaxBehavior;
  defaultFundingSource: ExpenseFundingSource;
  autoApplyToNewVehicles: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deletedAt?: string;
}

export interface Sale {
  id: string;
  organizationId: string;
  vehicleId: string;
  contactId?: string;
  saleDate: string;
  vehicleTotalCost: number;
  taxableProfitAmount: number;
  profitTaxDue: number;
  paperSalePrice: number;
  realClientPayment: number;
  externalCommission: number;
  notes?: string;
  status?: "active" | "voided" | "corrected";
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  correctedBySaleId?: string;
  correctionOfSaleId?: string;
  createdAt: string;
  createdBy: string;
}

export interface Contact {
  id: string;
  organizationId: string;
  type: ContactType;
  customTypeDescription?: string;
  fullName: string;
  phone: string;
  email?: string;
  address?: string;
  notes?: string;
  desiredVehicleTypes?: string;
  budgetMin?: number;
  budgetMax?: number;
  commissionAgreement?: string;
  location?: string;
  followUpNotes?: string;
  lastContactedDate?: string;
  exportRegion?: string;
  exportShippingNotes?: string;
  preferredCommunicationMethod?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface Attachment {
  id: string;
  organizationId: string;
  type: AttachmentType;
  title: string;
  urlOrPath: string;
  previewUrl?: string;
  vehicleId?: string;
  expenseId?: string;
  saleId?: string;
  contactId?: string;
  companyCashTransactionId?: string;
  externalCashTransactionId?: string;
  notes?: string;
  isSensitive: boolean;
  createdAt: string;
  createdBy: string;
}

export interface CompanyCashTransaction {
  id: string;
  organizationId: string;
  type: CompanyCashTransactionType;
  amount: number;
  date: string;
  note?: string;
  sourceVehicleId?: string;
  sourceExpenseId?: string;
  sourceSaleId?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
  deletionNote?: string;
  reversedTransactionId?: string;
  correctionOfTransactionId?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

export interface ExternalCashTransaction {
  id: string;
  organizationId: string;
  type: ExternalCashTransactionType;
  amount: number;
  date: string;
  note?: string;
  sourceVehicleId?: string;
  sourceExpenseId?: string;
  sourceSaleId?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
  deletionNote?: string;
  reversedTransactionId?: string;
  correctionOfTransactionId?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

export interface ActivityLog {
  id: string;
  organizationId: string;
  action: string;
  entityType: string;
  entityId?: string;
  message: string;
  createdAt: string;
  createdBy: string;
}

export interface AppData {
  organizations: Organization[];
  memberships: OrganizationMembership[];
  activeOrganizationId: string;
  userName: string;
  userId?: string;
  userEmail?: string;
  vehicles: Vehicle[];
  expenses: VehicleExpense[];
  recurringExpenseTemplates: RecurringVehicleExpenseTemplate[];
  sales: Sale[];
  contacts: Contact[];
  attachments: Attachment[];
  companyCashTransactions: CompanyCashTransaction[];
  externalCashTransactions: ExternalCashTransaction[];
  activityLogs: ActivityLog[];
}
