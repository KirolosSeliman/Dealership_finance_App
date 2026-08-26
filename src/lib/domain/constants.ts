import type {
  CompanyCashTransactionType,
  ContactType,
  ExpenseCategory,
  ExpenseFundingSource,
  ExpenseTaxBehavior,
  ExternalCashTransactionType,
  PurchaseSource,
  Role,
  VehicleStatus,
} from "@/types/domain";

export const VEHICLE_STATUSES: VehicleStatus[] = [
  "purchased",
  "in_repair",
  "listed_for_sale",
  "sold",
];

export const PURCHASE_SOURCES: PurchaseSource[] = [
  "OpenLane",
  "dealerAuction",
  "IAA",
  "Copart",
  "FacebookMarketplace",
  "trade",
  "other",
];

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "vehicle_purchase_price",
  "commission_plaque",
  "auction_fee",
  "transport",
  "repair",
  "inspection",
  "detailing",
  "parts",
  "registration",
  "storage",
  "other",
];

export const ROLES: Role[] = ["owner", "admin", "member", "accountant", "viewer"];
export const EXPENSE_FUNDING_SOURCES: ExpenseFundingSource[] = ["company_cash", "external_cash"];
export const EXPENSE_TAX_BEHAVIORS: ExpenseTaxBehavior[] = ["no_tax", "add_15_percent", "custom"];
export const CONTACT_TYPES: ContactType[] = ["buyer", "interested_in_buy_resell", "export_contact", "seller", "partner", "other"];
export const COMPANY_CASH_TRANSACTION_TYPES: CompanyCashTransactionType[] = [
  "company_cash_added",
  "company_cash_withdrawn",
  "vehicle_cost_paid",
  "vehicle_cost_refunded",
  "paper_sale_received",
  "external_transfer_received",
];
export const EXTERNAL_CASH_TRANSACTION_TYPES: ExternalCashTransactionType[] = [
  "external_cash_added",
  "external_commission_earned",
  "external_cash_transferred_to_company",
  "external_transfer_returned",
  "external_cash_personally_removed",
  "external_vehicle_expense_paid",
  "external_vehicle_expense_refunded",
];

export const TAXABLE_PROFIT_TAX_RATE = 0.22;
export const OPENLANE_PURCHASE_TAX_RATE = 0.05;
export const QUEBEC_EXPENSE_TAX_RATE = 0.15;
export const PURCHASE_TAX_RATE_BY_SOURCE: Record<PurchaseSource, number> = {
  OpenLane: OPENLANE_PURCHASE_TAX_RATE,
  dealerAuction: 0,
  IAA: 0,
  Copart: 0,
  FacebookMarketplace: 0,
  trade: 0,
  other: 0,
};

export const TAX_DISCLAIMER =
  "These calculations are estimates and must be validated by an accountant or tax professional.";

export function getPurchaseTaxRate(purchaseSource?: string) {
  return PURCHASE_TAX_RATE_BY_SOURCE[purchaseSource as PurchaseSource] ?? 0;
}

export function getAllowedVehicleStatusTransitions(status: VehicleStatus): VehicleStatus[] {
  if (status === "purchased") return ["in_repair"];
  if (status === "in_repair") return ["listed_for_sale"];
  return [];
}
