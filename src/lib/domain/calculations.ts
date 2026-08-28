import {
  ACCOUNTING_V2_PROFIT_TAX_RATE,
  ACCOUNTING_V2_SALES_TAX_RATE,
  getPurchaseTaxRate,
  QUEBEC_EXPENSE_TAX_RATE,
  TAXABLE_PROFIT_TAX_RATE,
} from "@/lib/domain/constants";
import type {
  CompanyCashTransaction,
  ExternalCashTransaction,
  Sale,
  Vehicle,
  VehicleExpense,
} from "@/types/domain";

export interface AccountingV2SaleBreakdown {
  salePriceBeforeTax: number;
  salesTaxRate: number;
  salesTaxAmount: number;
  customerTotal: number;
  companyPaymentAmount: number;
  externalPaymentAmount: number;
  companyCostBasis: number;
  companyGrossCashInvested: number;
  recoverableCompanyTax: number;
  taxSettlementAmount: number;
  profitTaxRate: number;
  grossProfit: number;
  externalVehicleCost: number;
  profitTaxDue: number;
  trackedNetProfit: number;
}

type AccountingV2SaleInput = {
  vehicle: Vehicle;
  expenses: VehicleExpense[];
  salePriceBeforeTax: number;
  salesTaxRate?: number;
  companyPaymentAmount: number;
  externalPaymentAmount: number;
  profitTaxRate?: number;
};

export function calculateVehicleCompanyCostBasis(vehicle: Vehicle, expenses: VehicleExpense[]) {
  const vehicleExpenses = getActiveVehicleExpenses(vehicle, expenses);
  const purchaseExpense = vehicleExpenses.find((expense) => expense.category === "vehicle_purchase_price");
  const purchaseFallback = purchaseExpense ? 0 : vehicle.purchasePrice;
  return roundMoney(
    vehicleExpenses
      .filter((expense) => expense.fundingSource !== "external_cash")
      .reduce((sum, expense) => sum + expense.amountBeforeTax, purchaseFallback),
  );
}

export function calculateVehicleCompanyGrossCashInvested(vehicle: Vehicle, expenses: VehicleExpense[]) {
  const vehicleExpenses = getActiveVehicleExpenses(vehicle, expenses);
  const purchaseExpense = vehicleExpenses.find((expense) => expense.category === "vehicle_purchase_price");
  const purchaseFallback = purchaseExpense ? 0 : vehicle.purchasePrice;
  return roundMoney(
    vehicleExpenses
      .filter((expense) => expense.fundingSource !== "external_cash")
      .reduce((sum, expense) => sum + expense.totalAmount, purchaseFallback),
  );
}

export function calculatePendingRecoverableCompanyTax(vehicle: Vehicle, expenses: VehicleExpense[]) {
  return roundMoney(
    getActiveVehicleExpenses(vehicle, expenses)
      .filter((expense) => expense.fundingSource !== "external_cash" && expense.taxAmount > 0)
      .reduce((sum, expense) => sum + expense.taxAmount, 0),
  );
}

export function calculateExternalVehicleCost(vehicle: Vehicle, expenses: VehicleExpense[]) {
  return roundMoney(
    getActiveVehicleExpenses(vehicle, expenses)
      .filter((expense) => expense.fundingSource === "external_cash")
      .reduce((sum, expense) => sum + expense.totalAmount, 0),
  );
}

export function calculateSaleTax(input: { salePriceBeforeTax: number; salesTaxRate?: number }) {
  const salePriceBeforeTax = normalizeCents(input.salePriceBeforeTax, "Sale price before tax");
  const salesTaxRate = normalizeRate(input.salesTaxRate ?? ACCOUNTING_V2_SALES_TAX_RATE, "Sales tax rate");
  const salesTaxAmount = roundMoney(salePriceBeforeTax * salesTaxRate);
  return {
    salePriceBeforeTax,
    salesTaxRate,
    salesTaxAmount,
    customerTotal: roundMoney(salePriceBeforeTax + salesTaxAmount),
  };
}

export function calculateAccountingV2SaleBreakdown(input: AccountingV2SaleInput): AccountingV2SaleBreakdown {
  const saleTax = calculateSaleTax(input);
  const companyPaymentAmount = normalizeCents(input.companyPaymentAmount, "Company payment amount");
  const externalPaymentAmount = normalizeCents(input.externalPaymentAmount, "External payment amount");
  if (toCents(companyPaymentAmount) + toCents(externalPaymentAmount) !== toCents(saleTax.customerTotal)) {
    throw new Error("Payment routing must equal the customer total exactly in cents.");
  }

  const companyCostBasis = calculateVehicleCompanyCostBasis(input.vehicle, input.expenses);
  const companyGrossCashInvested = calculateVehicleCompanyGrossCashInvested(input.vehicle, input.expenses);
  const recoverableCompanyTax = calculatePendingRecoverableCompanyTax(input.vehicle, input.expenses);
  const externalVehicleCost = calculateExternalVehicleCost(input.vehicle, input.expenses);
  const profitTaxRate = normalizeRate(input.profitTaxRate ?? ACCOUNTING_V2_PROFIT_TAX_RATE, "Profit tax rate");
  const grossProfit = roundMoney(saleTax.salePriceBeforeTax - companyCostBasis);
  const profitTaxDue = Math.max(0, roundMoney(grossProfit * profitTaxRate));
  return {
    ...saleTax,
    companyPaymentAmount,
    externalPaymentAmount,
    companyCostBasis,
    companyGrossCashInvested,
    recoverableCompanyTax,
    taxSettlementAmount: roundMoney(recoverableCompanyTax - saleTax.salesTaxAmount),
    profitTaxRate,
    grossProfit,
    externalVehicleCost,
    profitTaxDue,
    trackedNetProfit: roundMoney(grossProfit - profitTaxDue - externalVehicleCost),
  };
}

export function calculateExpenseTax(input: {
  purchaseSource?: string;
  category: string;
  amountBeforeTax: number;
  addFifteenPercentTax?: boolean;
  taxBehavior?: "no_tax" | "add_15_percent" | "custom";
  customTaxRate?: number;
}) {
  if (input.taxBehavior) {
    const taxRate =
      input.taxBehavior === "custom"
        ? Math.max(0, Math.min(1, input.customTaxRate ?? 0))
        : input.taxBehavior === "add_15_percent"
          ? QUEBEC_EXPENSE_TAX_RATE
          : 0;
    const taxAmount = roundMoney(input.amountBeforeTax * taxRate);
    return {
      taxRate,
      taxAmount,
      totalAmount: roundMoney(input.amountBeforeTax + taxAmount),
    };
  }

  if (input.category === "commission_plaque") {
    return {
      taxRate: 0,
      taxAmount: 0,
      totalAmount: roundMoney(input.amountBeforeTax),
    };
  }

  const purchaseTaxRate = input.category === "vehicle_purchase_price"
    ? getPurchaseTaxRate(input.purchaseSource)
    : 0;
  const isOpenLaneFee = input.purchaseSource === "OpenLane" && input.category === "auction_fee";
  const taxRate = purchaseTaxRate > 0
    ? purchaseTaxRate
    : isOpenLaneFee || input.addFifteenPercentTax
      ? QUEBEC_EXPENSE_TAX_RATE
      : 0;
  const taxAmount = roundMoney(input.amountBeforeTax * taxRate);
  return {
    taxRate,
    taxAmount,
    totalAmount: roundMoney(input.amountBeforeTax + taxAmount),
  };
}

export function calculateVehicleTotalCost(vehicle: Vehicle, expenses: VehicleExpense[]) {
  const vehicleExpenses = expenses.filter((expense) => expense.vehicleId === vehicle.id && !expense.voidedAt);
  const expenseTotal = vehicleExpenses.reduce((sum, expense) => {
    if (expense.category === "vehicle_purchase_price" && vehicle.purchasePrice > 0) {
      return sum + expense.taxAmount;
    }
    return sum + expense.totalAmount;
  }, 0);
  return roundMoney(vehicle.purchasePrice + expenseTotal);
}

export function calculateSaleBreakdown(input: {
  vehicleTotalCost: number;
  taxableProfitAmount: number;
  realClientPayment: number;
}) {
  const paperSalePrice = roundMoney(input.vehicleTotalCost + input.taxableProfitAmount);
  const profitTaxDue = roundMoney(input.taxableProfitAmount * TAXABLE_PROFIT_TAX_RATE);
  const externalCommission = roundMoney(input.realClientPayment - paperSalePrice);
  return {
    paperSalePrice,
    profitTaxDue,
    externalCommission,
    netProfitAfterTax: roundMoney(input.taxableProfitAmount - profitTaxDue),
  };
}

export function calculateCompanyCashBalance(transactions: CompanyCashTransaction[]) {
  return roundMoney(
    transactions.filter((transaction) => !transaction.deletedAt).reduce((sum, transaction) => {
      if (["vehicle_cost_refunded", "vehicle_tax_refund_received"].includes(transaction.type)) {
        return sum + transaction.amount;
      }
      if (
        transaction.type === "company_cash_withdrawn" ||
        transaction.type === "vehicle_cost_paid" ||
        transaction.type === "vehicle_tax_payment_made" ||
        transaction.type === "profit_tax_paid"
      ) {
        return sum - transaction.amount;
      }
      return sum + transaction.amount;
    }, 0),
  );
}

export function calculateExternalCashBalance(transactions: ExternalCashTransaction[]) {
  return roundMoney(
    transactions.filter((transaction) => !transaction.deletedAt).reduce((sum, transaction) => {
      if (transaction.type === "external_vehicle_expense_refunded") {
        return sum + transaction.amount;
      }
      if (
        transaction.type === "external_cash_transferred_to_company" ||
        transaction.type === "external_cash_personally_removed" ||
        transaction.type === "external_vehicle_expense_paid"
      ) {
        return sum - transaction.amount;
      }
      return sum + transaction.amount;
    }, 0),
  );
}

export function calculateDashboardMetrics(input: {
  vehicles: Vehicle[];
  expenses: VehicleExpense[];
  sales: Sale[];
  companyCashTransactions: CompanyCashTransaction[];
  externalCashTransactions: ExternalCashTransaction[];
}) {
  const activeSales = input.sales.filter(isActiveSale);
  const vehiclesInStock = input.vehicles.filter((vehicle) =>
    !vehicle.archivedAt && ["purchased", "in_repair", "listed_for_sale"].includes(vehicle.status),
  );
  const soldVehicles = input.vehicles.filter((vehicle) => vehicle.status === "sold" && activeSales.some((sale) => sale.vehicleId === vehicle.id));
  const inventoryValue = vehiclesInStock.reduce(
    (sum, vehicle) => sum + (isV2Vehicle(vehicle, activeSales)
      ? calculateVehicleCompanyCostBasis(vehicle, input.expenses)
      : calculateVehicleTotalCost(vehicle, input.expenses)),
    0,
  );
  const totalExpenses = input.vehicles.reduce((sum, vehicle) => {
    if (isV2Vehicle(vehicle, activeSales)) {
      return sum + calculateVehicleCompanyGrossCashInvested(vehicle, input.expenses) + calculateExternalVehicleCost(vehicle, input.expenses);
    }
    return sum + vehicle.purchasePrice + input.expenses
      .filter((expense) => expense.vehicleId === vehicle.id && !expense.voidedAt)
      .reduce((expenseSum, expense) => expenseSum + normalizedExpenseAmount(expense, vehicle), 0);
  }, 0);
  const netProfit = activeSales.reduce((sum, sale) => {
    if (sale.accountingModelVersion === 2) {
      return sum + (sale.trackedNetProfit ?? roundMoney((sale.grossProfit ?? 0) - sale.profitTaxDue - (sale.externalVehicleCost ?? 0)));
    }
    return sum + sale.taxableProfitAmount - sale.profitTaxDue;
  }, 0);
  const averageTimeToSell =
    soldVehicles.length === 0
      ? 0
      : soldVehicles.reduce((sum, vehicle) => {
          const sale = activeSales.find((item) => item.vehicleId === vehicle.id);
          if (!sale) return sum;
          return sum + daysBetween(vehicle.purchaseDate, sale.saleDate);
        }, 0) / soldVehicles.length;

  return {
    companyCash: calculateCompanyCashBalance(input.companyCashTransactions),
    externalCash: calculateExternalCashBalance(input.externalCashTransactions),
    netProfit: roundMoney(netProfit),
    totalExpenses: roundMoney(totalExpenses),
    vehiclesInStock: vehiclesInStock.length,
    vehiclesSold: soldVehicles.length,
    inventoryValue: roundMoney(inventoryValue),
    averageTimeToSell: Math.round(averageTimeToSell),
  };
}

export function generateTaxReport(input: {
  vehicles: Vehicle[];
  expenses: VehicleExpense[];
  sales: Sale[];
  companyCashTransactions: CompanyCashTransaction[];
  externalCashTransactions: ExternalCashTransaction[];
  startDate?: string;
  endDate?: string;
}) {
  const sales = filterByDate(input.sales.filter(isActiveSale), "saleDate", input.startDate, input.endDate);
  const expenses = filterByDate(input.expenses.filter((expense) => !expense.voidedAt), "date", input.startDate, input.endDate);
  const companyCash = filterByDate(
    input.companyCashTransactions.filter((transaction) => !transaction.deletedAt),
    "date",
    input.startDate,
    input.endDate,
  );
  const externalCash = filterByDate(
    input.externalCashTransactions.filter((transaction) => !transaction.deletedAt),
    "date",
    input.startDate,
    input.endDate,
  );
  const totalTaxableProfit = sales.reduce((sum, sale) => sum + (sale.accountingModelVersion === 2 ? sale.grossProfit ?? 0 : sale.taxableProfitAmount), 0);
  const taxDue = sales.reduce((sum, sale) => sum + sale.profitTaxDue, 0);
  const vehiclePurchaseCosts = calculatePeriodPurchaseCosts(input.vehicles, input.startDate, input.endDate);
  const periodExpenses = calculatePeriodExpenses(input.vehicles, input.expenses, input.startDate, input.endDate);

  const v2Sales = sales.filter((sale) => sale.accountingModelVersion === 2);
  const v2VehicleIds = new Set(v2Sales.map((sale) => sale.vehicleId));
  const v2Expenses = expenses.filter((expense) => v2VehicleIds.has(expense.vehicleId));
  const v2CompanyGrossCashInvested = roundMoney(v2Expenses
    .filter((expense) => expense.fundingSource !== "external_cash")
    .reduce((sum, expense) => sum + expense.totalAmount, 0));
  const v2ExternalVehicleCost = roundMoney(v2Expenses
    .filter((expense) => expense.fundingSource === "external_cash")
    .reduce((sum, expense) => sum + expense.totalAmount, 0));
  const legacySales = sales.filter((sale) => sale.accountingModelVersion !== 2);
  const legacyVehicles = input.vehicles.filter((vehicle) => !v2VehicleIds.has(vehicle.id));
  const legacyExpenses = expenses.filter((expense) => !v2VehicleIds.has(expense.vehicleId));
  const legacyTotalExpenses = calculatePeriodPurchaseCosts(legacyVehicles, input.startDate, input.endDate)
    + calculatePeriodExpenses(legacyVehicles, legacyExpenses, input.startDate, input.endDate);
  const report = {
    totalTaxableProfit: roundMoney(totalTaxableProfit),
    taxDue: roundMoney(taxDue),
    totalCompanySales: roundMoney(legacySales.reduce((sum, sale) => sum + sale.paperSalePrice, 0)),
    totalExternalCommission: roundMoney(
      legacySales.reduce((sum, sale) => sum + sale.externalCommission, 0),
    ),
    externalTransferredToCompany: roundMoney(
      externalCash
        .filter((transaction) => transaction.type === "external_cash_transferred_to_company")
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    ),
    externalPersonallyRemoved: roundMoney(
      externalCash
        .filter((transaction) => transaction.type === "external_cash_personally_removed")
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    ),
    vehiclePurchaseCosts,
    auctionFees: roundMoney(
      expenses
        .filter((expense) => expense.category === "auction_fee")
        .reduce((sum, expense) => sum + expense.amountBeforeTax, 0),
    ),
    totalExpenses: roundMoney(v2Sales.length > 0
      ? legacyTotalExpenses + v2CompanyGrossCashInvested + v2ExternalVehicleCost
      : vehiclePurchaseCosts + periodExpenses),
    taxesPaidOnPurchasesAndExpenses: roundMoney(
      expenses.reduce((sum, expense) => sum + expense.taxAmount, 0),
    ),
    netProfitAfterTax: roundMoney(sales.reduce((sum, sale) => sale.accountingModelVersion === 2
      ? sum + (sale.trackedNetProfit ?? 0)
      : sum + sale.taxableProfitAmount - sale.profitTaxDue, 0)),
    companyCashAdded: roundMoney(
      companyCash
        .filter((transaction) => transaction.type === "company_cash_added")
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    ),
  };
  if (v2Sales.length === 0) return report;
  return {
    ...report,
    totalSalePriceBeforeTax: roundMoney(v2Sales.reduce((sum, sale) => sum + (sale.salePriceBeforeTax ?? 0), 0)),
    totalSalesTaxCollected: roundMoney(v2Sales.reduce((sum, sale) => sum + (sale.salesTaxAmount ?? 0), 0)),
    totalCustomerSales: roundMoney(v2Sales.reduce((sum, sale) => sum + (sale.customerTotal ?? 0), 0)),
    totalCompanyPayment: roundMoney(v2Sales.reduce((sum, sale) => sum + (sale.companyPaymentAmount ?? 0), 0)),
    totalExternalPayment: roundMoney(v2Sales.reduce((sum, sale) => sum + (sale.externalPaymentAmount ?? 0), 0)),
    totalCompanyCostBasis: roundMoney(v2Sales.reduce((sum, sale) => sum + (sale.companyCostBasis ?? 0), 0)),
    totalCompanyGrossCashInvested: roundMoney(v2Sales.reduce((sum, sale) => sum + (sale.companyGrossCashInvested ?? 0), 0)),
    totalRecoverableCompanyTax: roundMoney(v2Sales.reduce((sum, sale) => sum + (sale.recoverableCompanyTax ?? 0), 0)),
    totalTaxSettlement: roundMoney(v2Sales.reduce((sum, sale) => sum + (sale.taxSettlementAmount ?? 0), 0)),
    totalExternalVehicleCost: roundMoney(v2Sales.reduce((sum, sale) => sum + (sale.externalVehicleCost ?? 0), 0)),
    totalTrackedNetProfit: roundMoney(v2Sales.reduce((sum, sale) => sum + (sale.trackedNetProfit ?? 0), 0)),
  };
}

export function isActiveSale(sale: Sale) {
  return !sale.voidedAt && (sale.status ?? "active") === "active";
}

export function filterVehiclesByPurchaseDate(vehicles: Vehicle[], startDate?: string, endDate?: string) {
  return filterByDate(vehicles, "purchaseDate", startDate, endDate);
}

export function calculatePeriodPurchaseCosts(vehicles: Vehicle[], startDate?: string, endDate?: string) {
  return roundMoney(
    filterVehiclesByPurchaseDate(vehicles, startDate, endDate)
      .reduce((sum, vehicle) => sum + vehicle.purchasePrice, 0),
  );
}

export function calculatePeriodExpenses(
  vehicles: Vehicle[],
  expenses: VehicleExpense[],
  startDate?: string,
  endDate?: string,
) {
  const vehiclesById = indexVehiclesById(vehicles);
  return roundMoney(
    filterByDate(expenses.filter((expense) => !expense.voidedAt), "date", startDate, endDate)
      .reduce((sum, expense) => sum + normalizedExpenseAmount(expense, vehiclesById.get(expense.vehicleId)), 0),
  );
}

export function makeSeries(input: { label: string; value: number }[]) {
  return input.map((item, index) => ({ ...item, index }));
}

function filterByDate<T extends object>(
  rows: T[],
  key: keyof T,
  startDate?: string,
  endDate?: string,
) {
  return rows.filter((row) => {
    const value = String(row[key] ?? "");
    if (startDate && value < startDate) return false;
    if (endDate && value > endDate) return false;
    return true;
  });
}

export function daysBetween(startDate: string, endDate: string) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function indexVehiclesById(vehicles: Vehicle[]) {
  return new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
}

function normalizedExpenseAmount(expense: VehicleExpense, vehicle?: Vehicle) {
  if (expense.category === "vehicle_purchase_price") {
    return vehicle && vehicle.purchasePrice <= 0 ? expense.totalAmount : expense.taxAmount;
  }
  return expense.totalAmount;
}

function getActiveVehicleExpenses(vehicle: Vehicle, expenses: VehicleExpense[]) {
  return expenses.filter((expense) => expense.vehicleId === vehicle.id && !expense.voidedAt);
}

function isV2Vehicle(vehicle: Vehicle, sales: Sale[]) {
  return vehicle.accountingModelVersion === 2 || sales.some((sale) => sale.vehicleId === vehicle.id && sale.accountingModelVersion === 2);
}

function toCents(value: number) {
  return Math.round(value * 100);
}

function normalizeCents(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a nonnegative finite amount.`);
  const cents = toCents(value);
  if (cents !== value * 100) throw new Error(`${label} must use at most two decimal places.`);
  return cents / 100;
}

function normalizeRate(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0% and 100%.`);
  return value;
}
