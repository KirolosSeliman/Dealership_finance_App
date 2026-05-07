import {
  OPENLANE_PURCHASE_TAX_RATE,
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
}) {
  if (input.category === "commission_plaque") {
    return {
      taxRate: 0,
      taxAmount: 0,
      totalAmount: roundMoney(input.amountBeforeTax),
    };
  }

  const isOpenLanePurchase =
    input.purchaseSource === "OpenLane" && input.category === "vehicle_purchase_price";
  const isOpenLaneFee = input.purchaseSource === "OpenLane" && input.category === "auction_fee";
  const taxRate = isOpenLanePurchase
    ? OPENLANE_PURCHASE_TAX_RATE
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
  const vehicleExpenses = expenses.filter((expense) => expense.vehicleId === vehicle.id);
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
      if (
        transaction.type === "external_cash_transferred_to_company" ||
        transaction.type === "external_cash_personally_removed"
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
  const vehiclesInStock = input.vehicles.filter((vehicle) =>
    ["purchased", "in_repair", "listed_for_sale"].includes(vehicle.status),
  );
  const soldVehicles = input.vehicles.filter((vehicle) => vehicle.status === "sold");
  const inventoryValue = vehiclesInStock.reduce(
    (sum, vehicle) => sum + calculateVehicleTotalCost(vehicle, input.expenses),
    0,
  );
  const totalExpenses =
    input.vehicles.reduce((sum, vehicle) => sum + vehicle.purchasePrice, 0) +
    input.expenses.reduce((sum, expense) => sum + normalizedExpenseAmount(expense), 0);
  const totalTaxableProfit = input.sales.reduce(
    (sum, sale) => sum + sale.taxableProfitAmount,
    0,
  );
  const totalProfitTaxDue = input.sales.reduce((sum, sale) => sum + sale.profitTaxDue, 0);
  const averageTimeToSell =
    soldVehicles.length === 0
      ? 0
      : soldVehicles.reduce((sum, vehicle) => {
          const sale = input.sales.find((item) => item.vehicleId === vehicle.id);
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
  const sales = filterByDate(input.sales, "saleDate", input.startDate, input.endDate);
  const expenses = filterByDate(input.expenses, "date", input.startDate, input.endDate);
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
    vehiclePurchaseCosts: roundMoney(
      input.vehicles.reduce((sum, vehicle) => sum + vehicle.purchasePrice, 0),
    ),
    auctionFees: roundMoney(
      expenses
        .filter((expense) => expense.category === "auction_fee")
        .reduce((sum, expense) => sum + expense.amountBeforeTax, 0),
    ),
    totalExpenses: roundMoney(
      input.vehicles.reduce((sum, vehicle) => sum + vehicle.purchasePrice, 0) +
        expenses.reduce((sum, expense) => sum + normalizedExpenseAmount(expense), 0),
    ),
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

function normalizedExpenseAmount(expense: VehicleExpense) {
  if (expense.category === "vehicle_purchase_price") {
    return expense.taxAmount;
  }
  return expense.totalAmount;
}
