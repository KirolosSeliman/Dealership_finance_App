import type { ExpenseCategory, PurchaseSource, Role, VehicleStatus } from "@/types/domain";

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

export const TAXABLE_PROFIT_TAX_RATE = 0.22;
export const OPENLANE_PURCHASE_TAX_RATE = 0.05;
export const QUEBEC_EXPENSE_TAX_RATE = 0.15;
export const DEFAULT_PLATE_COMMISSION_AMOUNT = 250;

export const TAX_DISCLAIMER =
  "These calculations are estimates and must be validated by an accountant or tax professional.";
