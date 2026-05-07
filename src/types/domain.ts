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

export type CompanyCashTransactionType =
  | "company_cash_added"
  | "company_cash_withdrawn"
  | "vehicle_cost_paid"
  | "paper_sale_received"
  | "external_transfer_received";

export type ExternalCashTransactionType =
  | "external_commission_earned"
  | "external_cash_transferred_to_company"
  | "external_cash_personally_removed";

export interface Organization {
  id: string;
  name: string;
  role: Role;
  inviteCode: string;
  defaultPlateCommissionAmount: number;
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
}

export interface VehicleExpense {
  id: string;
  organizationId: string;
  vehicleId: string;
  category: ExpenseCategory;
  amountBeforeTax: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  date: string;
  note?: string;
  createdAt: string;
  createdBy: string;
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
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
  deletionNote?: string;
}

export interface ExternalCashTransaction {
  id: string;
  organizationId: string;
  type: ExternalCashTransactionType;
  amount: number;
  date: string;
  note?: string;
  sourceVehicleId?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
  deletionNote?: string;
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
  activeOrganizationId: string;
  userName: string;
  userId?: string;
  userEmail?: string;
  vehicles: Vehicle[];
  expenses: VehicleExpense[];
  sales: Sale[];
  contacts: Contact[];
  attachments: Attachment[];
  companyCashTransactions: CompanyCashTransaction[];
  externalCashTransactions: ExternalCashTransaction[];
  activityLogs: ActivityLog[];
}
