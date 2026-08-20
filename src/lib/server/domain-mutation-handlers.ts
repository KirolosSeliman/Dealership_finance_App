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
  deleteExpense,
  loadAppData,
  recordVehicleSale,
  updateCashTransaction,
  updateExpense,
  updateVehicle,
  voidVehicleSale,
} from "@/lib/supabase/repository";
import { mapVehicle } from "@/lib/supabase/mappers";
import { isValidVehicleDeleteConfirmation } from "@/lib/vehicle-delete";
import {
  cashTransactionSchema,
  cashUpdateSchema,
  deleteVehicleSchema,
  expenseSchema,
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
  "deleteExpense",
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
        deleteVehicleSchema.parse(formDataToObject(formData));
        const vehicleId = String(formData.get("vehicleId") || "");
        const confirmationText = String(formData.get("confirmationText") || "").trim();
        const archiveReason = String(formData.get("archiveReason") || "").trim();
        const vehicle = await getVehicleOptional(client, organizationId, vehicleId);
        if (!vehicle) throw new ApiError(404, "Vehicle was not found.");
        if (vehicle.archivedAt) throw new ApiError(400, "Vehicle is already archived.");
        assertVehicleDeleteConfirmation(vehicle, confirmationText);
        await archiveVehicle(client, organizationId, vehicle.id, archiveReason);
        return mutationOk({ archived: true }, input.legacy);
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
      case "deleteExpense": {
        await requireRole(client, user.id, organizationId, ["owner", "admin", "member"]);
        const vehicle = await getVehicle(client, organizationId, String(formData.get("vehicleId") || ""));
        await deleteExpense(client, vehicle, String(formData.get("expenseId") || ""));
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

function mutationOk(extra: Record<string, unknown> | undefined, legacy = false) {
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

async function getVehicleOptional(client: SupabaseClient, organizationId: string, vehicleId: string) {
  if (!vehicleId) throw new ApiError(400, "Vehicle is required.");
  const { data, error } = await client
    .from("vehicles")
    .select("*")
    .eq("id", vehicleId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapVehicle(data as Record<string, unknown>) : undefined;
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

function assertVehicleDeleteConfirmation(vehicle: { vin?: string; id: string }, confirmationText: string) {
  if (isValidVehicleDeleteConfirmation(confirmationText, vehicle.vin)) return;
  throw new ApiError(400, "Type DELETE or the vehicle VIN to confirm archive.");
}

function assertCashUpdateKeepsBalance(appData: AppData, account: "company" | "external", transactionId: string, amount: number) {
  if (!transactionId) throw new ApiError(400, "Transaction is required.");
  if (account === "company") {
    const current = appData.companyCashTransactions.find((transaction) => transaction.id === transactionId && !transaction.deletedAt);
    if (!current) throw new ApiError(404, "Company cash transaction was not found.");
    const nextTransactions = appData.companyCashTransactions.map((transaction) => transaction.id === transactionId ? { ...transaction, amount } : transaction);
    if (calculateCompanyCashBalance(nextTransactions) < 0) throw new ApiError(400, "This edit would make company cash negative.");
    return;
  }
  if (account === "external") {
    const current = appData.externalCashTransactions.find((transaction) => transaction.id === transactionId && !transaction.deletedAt);
    if (!current) throw new ApiError(404, "External cash transaction was not found.");
    const nextTransactions = appData.externalCashTransactions.map((transaction) => transaction.id === transactionId ? { ...transaction, amount } : transaction);
    if (calculateExternalCashBalance(nextTransactions) < 0) throw new ApiError(400, "This edit would make external cash negative.");
    return;
  }
  throw new ApiError(400, "Cash account is invalid.");
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function toClientErrorMessage(error: unknown, operation: DomainMutationOperation) {
  if (error instanceof ApiError) return error.message;
  const message = formatValidationError(error);
  const normalized = message.toLowerCase();
  if (operation === "deleteVehicle") {
    if (normalized.includes("not allowed")) return "You are not allowed to archive this vehicle.";
    if (normalized.includes("vehicle not found")) return "Vehicle not found.";
    if (normalized.includes("already archived")) return "Vehicle is already archived.";
    if (normalized.includes("archive_vehicle") || normalized.includes("could not find the function") || normalized.includes("does not exist")) {
      return "Vehicle archive database migration is missing. Run the latest vehicle archive migration in Supabase, then try again.";
    }
    if (normalized === "invalid input." || normalized.includes("invalid input syntax")) return "Type DELETE or the vehicle VIN to confirm archive.";
    return "Vehicle could not be archived. Please try again.";
  }
  if (operation === "deleteCashTransaction" && normalized.includes("system-generated cash transactions")) {
    return "This linked cash transaction must be corrected through the vehicle or sale workflow.";
  }
  if (operation === "updateVehicle" && (normalized.includes("correct_vehicle_purchase") || normalized.includes("transition_vehicle_status"))) {
    return "Vehicle correction database migration is missing. Run the latest vehicle correction migration in Supabase, then try again.";
  }
  if ((operation === "voidSale" || operation === "correctSale") && (normalized.includes("void_vehicle_sale_atomic") || normalized.includes("correct_vehicle_sale_atomic"))) {
    return "Sale correction database migration is missing. Run the latest sale correction migration in Supabase, then try again.";
  }
  return message;
}
