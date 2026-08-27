import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { calculateCompanyCashBalance, calculateExternalCashBalance, isActiveSale } from "@/lib/domain/calculations";
import {
  archiveVehicle,
  createCashTransaction,
  createExpense,
  createVehicle,
  correctVehicleSale,
  deleteCashTransaction,
  loadAppData,
  recordVehicleSale,
  updateCashTransaction,
  updateExpense,
  updateVehicle,
  voidVehicleExpense,
  voidVehicleSale,
} from "@/lib/supabase/repository";
import { mapVehicle } from "@/lib/supabase/mappers";
import {
  archiveVehicleSchema,
  cashTransactionSchema,
  cashUpdateSchema,
  expenseSchema,
  expenseVoidSchema,
  formatValidationError,
  formDataToObject,
  normalizeVin,
  saleCorrectionSchema,
  saleSchema,
  saleVoidSchema,
  vehicleAnyUpdateSchema,
  vehicleSchema,
} from "@/lib/validation";
import type { AppData, CompanyCashTransactionType, ExternalCashTransactionType, Role } from "@/types/domain";

export const DOMAIN_MUTATION_OPERATIONS = [
  "createVehicle",
  "updateVehicle",
  "deleteVehicle",
  "createExpense",
  "updateExpense",
  "voidExpense",
  "recordSale",
  "voidSale",
  "correctSale",
  "createCashTransaction",
  "updateCashTransaction",
  "deleteCashTransaction",
] as const;

export type DomainMutationOperation = typeof DOMAIN_MUTATION_OPERATIONS[number];

export function isDomainMutationOperation(operation: string): operation is DomainMutationOperation {
  return (DOMAIN_MUTATION_OPERATIONS as readonly string[]).includes(operation);
}

export async function handleDomainMutation(input: {
  client: SupabaseClient;
  user: User;
  operation: DomainMutationOperation;
  organizationId: string;
  formData: FormData;
  legacy?: boolean;
}) {
  try {
    const { client, user, operation, organizationId, formData } = input;

    switch (operation) {
      case "createVehicle": {
        await requireRole(client, user.id, organizationId, ["owner", "admin", "member"]);
        const parsed = vehicleSchema.parse(formDataToObject(formData));
        formData.set("vin", parsed.vin);
        await assertUniqueActiveVin(client, organizationId, parsed.vin);
        const id = await createVehicle(client, organizationId, formData);
        return mutationOk({ id }, input.legacy);
      }
      case "updateVehicle": {
        await requireRole(client, user.id, organizationId, ["owner", "admin", "member"]);
        const parsed = vehicleAnyUpdateSchema.parse(formDataToObject(formData));
        const vehicle = await getVehicle(client, organizationId, String(formData.get("vehicleId") || ""));
        if ("vin" in parsed) {
          formData.set("vin", parsed.vin);
          await assertUniqueActiveVin(client, organizationId, parsed.vin, vehicle.id);
        }
        await updateVehicle(client, vehicle, formData);
        return mutationOk(undefined, input.legacy);
      }
      case "deleteVehicle": {
        await requireRole(client, user.id, organizationId, ["owner", "admin"]);
        const parsed = archiveVehicleSchema.parse(formDataToObject(formData));
        await archiveVehicle(client, organizationId, parsed.vehicleId, parsed.reason);
        return mutationOk(undefined, input.legacy);
      }
      case "createExpense": {
        await requireRole(client, user.id, organizationId, ["owner", "admin", "member"]);
        expenseSchema.parse(formDataToObject(formData));
        const vehicle = await getVehicle(client, organizationId, String(formData.get("vehicleId") || ""));
        const id = await createExpense(client, vehicle, formData);
        return mutationOk({ id }, input.legacy);
      }
      case "updateExpense": {
        await requireRole(client, user.id, organizationId, ["owner", "admin", "member"]);
        expenseSchema.parse(formDataToObject(formData));
        const vehicle = await getVehicle(client, organizationId, String(formData.get("vehicleId") || ""));
        await updateExpense(client, vehicle, String(formData.get("expenseId") || ""), formData);
        return mutationOk(undefined, input.legacy);
      }
      case "voidExpense": {
        await requireRole(client, user.id, organizationId, ["owner", "admin", "member"]);
        const parsed = expenseVoidSchema.parse(formDataToObject(formData));
        const vehicle = await getVehicle(client, organizationId, parsed.vehicleId);
        await voidVehicleExpense(client, vehicle, parsed.expenseId, parsed.reason);
        return mutationOk(undefined, input.legacy);
      }
      case "recordSale": {
        await requireRole(client, user.id, organizationId, ["owner", "admin", "member"]);
        saleSchema.parse(formDataToObject(formData));
        const vehicle = await getVehicle(client, organizationId, String(formData.get("vehicleId") || ""));
        const appData = await loadAppData(client, user, organizationId);
        if (appData.sales.some((sale) => sale.vehicleId === vehicle.id && isActiveSale(sale))) {
          throw new ApiError(400, "This vehicle already has a sale record.");
        }
        await recordVehicleSale(client, appData, vehicle, formData);
        return mutationOk(undefined, input.legacy);
      }
      case "voidSale": {
        await requireRole(client, user.id, organizationId, ["owner", "admin", "member"]);
        saleVoidSchema.parse(formDataToObject(formData));
        await voidVehicleSale(client, organizationId, String(formData.get("saleId") || ""), String(formData.get("reason") || ""));
        return mutationOk(undefined, input.legacy);
      }
      case "correctSale": {
        await requireRole(client, user.id, organizationId, ["owner", "admin", "member"]);
        saleCorrectionSchema.parse(formDataToObject(formData));
        const id = await correctVehicleSale(client, organizationId, String(formData.get("saleId") || ""), formData);
        return mutationOk({ id }, input.legacy);
      }
      case "createCashTransaction": {
        await requireRole(client, user.id, organizationId, ["owner", "admin"]);
        cashTransactionSchema.parse(formDataToObject(formData));
        const appData = await loadAppData(client, user, organizationId);
        const type = String(formData.get("type")) as CompanyCashTransactionType | ExternalCashTransactionType;
        assertCashAccountMatchesType(String(formData.get("account") || ""), type);
        const amount = Number(formData.get("amount"));
        if (type === "company_cash_withdrawn" && amount > calculateCompanyCashBalance(appData.companyCashTransactions)) {
          throw new ApiError(400, "Company cash withdrawal exceeds available balance.");
        }
        if (
          (type === "external_cash_transferred_to_company" || type === "external_cash_personally_removed") &&
          amount > calculateExternalCashBalance(appData.externalCashTransactions)
        ) {
          throw new ApiError(400, "External cash action exceeds available balance.");
        }
        await createCashTransaction(
          client,
          organizationId,
          type,
          amount,
          String(formData.get("note") || ""),
          String(formData.get("date") || ""),
        );
        return mutationOk(undefined, input.legacy);
      }
      case "updateCashTransaction": {
        await requireRole(client, user.id, organizationId, ["owner", "admin"]);
        cashUpdateSchema.parse(formDataToObject(formData));
        const appData = await loadAppData(client, user, organizationId);
        assertCashUpdateKeepsBalance(
          appData,
          String(formData.get("account") || "") as "company" | "external",
          String(formData.get("transactionId") || ""),
          Number(formData.get("amount")),
        );
        await updateCashTransaction(
          client,
          organizationId,
          String(formData.get("account") || "") as "company" | "external",
          String(formData.get("transactionId") || ""),
          formData,
        );
        return mutationOk(undefined, input.legacy);
      }
      case "deleteCashTransaction": {
        await requireRole(client, user.id, organizationId, ["owner", "admin"]);
        await deleteCashTransaction(
          client,
          organizationId,
          String(formData.get("account") || "") as "company" | "external",
          String(formData.get("transactionId") || ""),
          String(formData.get("reason") || ""),
        );
        return mutationOk(undefined, input.legacy);
      }
    }
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 400;
    return NextResponse.json({ ok: false, message: toClientErrorMessage(error, input.operation) }, { status });
  }
}

function mutationOk(extra?: Record<string, unknown>, legacy = false) {
  const body = { ok: true, ...extra };
  return legacy
    ? NextResponse.json(body, { headers: { "x-dealer-flow-deprecated-route": "/api/mutations" } })
    : NextResponse.json(body);
}

async function requireRole(client: SupabaseClient, userId: string, organizationId: string, roles: Role[]) {
  if (!organizationId) throw new ApiError(400, "Organization is required.");
  const { data, error } = await client
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .in("role", roles)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(403, "You do not have permission for this action.");
}

async function getVehicle(client: SupabaseClient, organizationId: string, vehicleId: string) {
  if (!vehicleId) throw new Error("Vehicle is required.");
  const { data, error } = await client
    .from("vehicles")
    .select("*")
    .eq("id", vehicleId)
    .eq("organization_id", organizationId)
    .single();
  if (error) throw error;
  return mapVehicle(data as Record<string, unknown>);
}

async function assertUniqueActiveVin(client: SupabaseClient, organizationId: string, vin: string, exceptVehicleId?: string) {
  const normalizedVin = normalizeVin(vin);
  if (!normalizedVin) return;
  const { data, error } = await client
    .from("vehicles")
    .select("id, vin")
    .eq("organization_id", organizationId)
    .is("archived_at", null);
  if (error) throw error;
  const duplicate = (data ?? []).find((row) => {
    const id = String((row as Record<string, unknown>).id ?? "");
    if (exceptVehicleId && id === exceptVehicleId) return false;
    return normalizeVin((row as Record<string, unknown>).vin) === normalizedVin;
  });
  if (duplicate) throw new ApiError(400, "Another active vehicle already uses this VIN.");
}

function assertCashUpdateKeepsBalance(appData: AppData, account: "company" | "external", transactionId: string, amount: number) {
  if (!transactionId) throw new ApiError(400, "Transaction is required.");
  if (account === "company") {
    const current = appData.companyCashTransactions.find((transaction) => transaction.id === transactionId && !transaction.deletedAt);
    if (!current) throw new ApiError(404, "Company cash transaction was not found.");
    assertCashTransactionManuallyEditable(current);
    const nextTransactions = appData.companyCashTransactions.map((transaction) => transaction.id === transactionId ? { ...transaction, amount } : transaction);
    if (calculateCompanyCashBalance(nextTransactions) < 0) throw new ApiError(400, "This edit would make company cash negative.");
    return;
  }
  if (account === "external") {
    const current = appData.externalCashTransactions.find((transaction) => transaction.id === transactionId && !transaction.deletedAt);
    if (!current) throw new ApiError(404, "External cash transaction was not found.");
    assertCashTransactionManuallyEditable(current);
    const nextTransactions = appData.externalCashTransactions.map((transaction) => transaction.id === transactionId ? { ...transaction, amount } : transaction);
    if (calculateExternalCashBalance(nextTransactions) < 0) throw new ApiError(400, "This edit would make external cash negative.");
    return;
  }
  throw new ApiError(400, "Cash account is invalid.");
}

function assertCashAccountMatchesType(account: string, type: CompanyCashTransactionType | ExternalCashTransactionType) {
  if (account !== "company" && account !== "external") {
    throw new ApiError(400, "Cash account is invalid.");
  }
  const expectedAccount = type.startsWith("external_") ? "external" : "company";
  if (account !== expectedAccount) {
    throw new ApiError(400, "Cash account does not match the transaction type.");
  }
}

function assertCashTransactionManuallyEditable(transaction: {
  transferPairId?: string;
  sourceVehicleId?: string;
  sourceExpenseId?: string;
  sourceSaleId?: string;
  correctionOfTransactionId?: string;
  reversedTransactionId?: string;
  voidedAt?: string;
}) {
  if (transaction.sourceVehicleId || transaction.sourceExpenseId || transaction.sourceSaleId) {
    throw new ApiError(400, "System-generated cash transactions cannot be edited.");
  }
  if (transaction.transferPairId) {
    throw new ApiError(400, "Paired external transfers cannot be edited directly. Reverse the transfer and create a new one.");
  }
  if (transaction.correctionOfTransactionId || transaction.reversedTransactionId || transaction.voidedAt) {
    throw new ApiError(400, "Reversal entries cannot be edited.");
  }
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function toClientErrorMessage(error: unknown, operation: DomainMutationOperation) {
  const message = formatValidationError(error);
  const normalized = message.toLowerCase();
  if (operation === "createVehicle" || operation === "updateVehicle") {
    if (normalized.includes("another active vehicle already uses this vin") || normalized.includes("vehicles_org_active_vin")) {
      return "Another active vehicle already uses this VIN.";
    }
  }
  if (operation === "deleteVehicle") {
    if (normalized.includes("not allowed")) return "You do not have permission to archive this vehicle.";
    if (normalized.includes("vehicle not found")) return "Vehicle not found.";
    if (normalized.includes("already archived") || normalized.includes("sold vehicles with an active sale")) return message;
    if (normalized.includes("archive_vehicle") || normalized.includes("could not find the function") || normalized.includes("does not exist")) {
      return "Vehicle archive database migration is missing. Run the latest vehicle archive migration in Supabase, then try again.";
    }
    return "Vehicle could not be archived. Please try again.";
  }
  if (operation === "deleteCashTransaction") {
    if (normalized.includes("reverse_company_cash_transaction") || normalized.includes("reverse_external_cash_transaction") || normalized.includes("does not exist")) {
      return "Cash reversal database migration is missing. Run the latest cash reversal migration in Supabase, then try again.";
    }
    if (normalized.includes("system-generated cash transactions")) return "This linked cash transaction must be corrected through the vehicle or sale workflow.";
  }
  if (operation === "updateCashTransaction" && (normalized.includes("update_manual_company_cash_transaction") || normalized.includes("update_manual_external_cash_transaction") || normalized.includes("does not exist"))) {
    return "Cash edit database migration is missing. Run the latest cash ledger hardening migration in Supabase, then try again.";
  }
  if (operation === "updateVehicle" && (normalized.includes("correct_vehicle_purchase") || normalized.includes("transition_vehicle_status") || normalized.includes("does not exist"))) {
    return "Vehicle correction database migration is missing. Run the latest vehicle correction migration in Supabase, then try again.";
  }
  if ((operation === "voidSale" || operation === "correctSale") && (normalized.includes("void_vehicle_sale_atomic") || normalized.includes("correct_vehicle_sale_atomic") || normalized.includes("does not exist"))) {
    return "Sale correction database migration is missing. Run the latest sale correction migration in Supabase, then try again.";
  }
  if (operation === "voidExpense" && (normalized.includes("void_vehicle_expense_with_cash_reversal") || normalized.includes("does not exist"))) {
    return "Expense correction database migration is missing. Run the latest expense correction migration in Supabase, then try again.";
  }
  return message;
}
