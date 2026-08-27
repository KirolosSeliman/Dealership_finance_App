import {
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
      if (transaction.type === "vehicle_cost_refunded") {
        return sum + transaction.amount;
      }
      if (
        transaction.type === "company_cash_withdrawn" ||
        transaction.type === "vehicle_cost_paid"
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
  const vehiclesById = indexVehiclesById(input.vehicles);
  const vehiclesInStock = input.vehicles.filter((vehicle) =>
    !vehicle.archivedAt && ["purchased", "in_repair", "listed_for_sale"].includes(vehicle.status),
  );
  const soldVehicles = input.vehicles.filter((vehicle) => vehicle.status === "sold" && activeSales.some((sale) => sale.vehicleId === vehicle.id));
  const inventoryValue = vehiclesInStock.reduce(
    (sum, vehicle) => sum + calculateVehicleTotalCost(vehicle, input.expenses),
    0,
  );
  const totalExpenses =
    input.vehicles.reduce((sum, vehicle) => sum + vehicle.purchasePrice, 0) +
    input.expenses
      .filter((expense) => !expense.voidedAt)
      .reduce((sum, expense) => sum + normalizedExpenseAmount(expense, vehiclesById.get(expense.vehicleId)), 0);
  const totalTaxableProfit = activeSales.reduce(
    (sum, sale) => sum + sale.taxableProfitAmount,
    0,
  );
  const totalProfitTaxDue = activeSales.reduce((sum, sale) => sum + sale.profitTaxDue, 0);
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
    netProfit: roundMoney(totalTaxableProfit - totalProfitTaxDue),
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
  const totalTaxableProfit = sales.reduce((sum, sale) => sum + sale.taxableProfitAmount, 0);
  const taxDue = sales.reduce((sum, sale) => sum + sale.profitTaxDue, 0);
  const vehiclePurchaseCosts = calculatePeriodPurchaseCosts(input.vehicles, input.startDate, input.endDate);
  const periodExpenses = calculatePeriodExpenses(input.vehicles, input.expenses, input.startDate, input.endDate);

  return {
    totalTaxableProfit: roundMoney(totalTaxableProfit),
    taxDue: roundMoney(taxDue),
    totalCompanySales: roundMoney(sales.reduce((sum, sale) => sum + sale.paperSalePrice, 0)),
    totalExternalCommission: roundMoney(
      sales.reduce((sum, sale) => sum + sale.externalCommission, 0),
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
    totalExpenses: roundMoney(vehiclePurchaseCosts + periodExpenses),
    taxesPaidOnPurchasesAndExpenses: roundMoney(
      expenses.reduce((sum, expense) => sum + expense.taxAmount, 0),
    ),
    netProfitAfterTax: roundMoney(totalTaxableProfit - taxDue),
    companyCashAdded: roundMoney(
      companyCash
        .filter((transaction) => transaction.type === "company_cash_added")
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    ),
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
