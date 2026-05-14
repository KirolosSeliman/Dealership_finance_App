import { NextResponse } from "next/server";
import { calculateCompanyCashBalance, calculateExternalCashBalance, isActiveSale } from "@/lib/domain/calculations";
import { assertSameOrigin, checkRateLimit } from "@/lib/server/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  archiveVehicle,
  createAttachment,
  createCashTransaction,
  createContact,
  createExpense,
  createOrganization,
  createRecurringExpenseTemplate,
  createVehicle,
  correctVehicleSale,
  deleteCashTransaction,
  deleteExpense,
  deleteRecurringExpenseTemplate,
  joinOrganization,
  loadAppData,
  recordVehicleSale,
  applyRecurringExpenseTemplate,
  updateCashTransaction,
  updateExpense,
  updateRecurringExpenseTemplate,
  updateVehicle,
  updateVehicleMainPhoto,
  voidVehicleSale,
} from "@/lib/supabase/repository";
import { mapAttachment, mapVehicle } from "@/lib/supabase/mappers";
import { isValidVehicleDeleteConfirmation } from "@/lib/vehicle-delete";
import {
  attachmentSchema,
  activityLogSchema,
  applyRecurringExpenseTemplateSchema,
  cashTransactionSchema,
  cashUpdateSchema,
  contactSchema,
  expenseSchema,
  formatValidationError,
  formDataToObject,
  normalizeVin,
  invitationCodeSchema,
  organizationSchema,
  regenerateInvitationSchema,
  recurringExpenseTemplateSchema,
  roleUpdateSchema,
  saleCorrectionSchema,
  saleSchema,
  saleVoidSchema,
  deleteVehicleSchema,
  vehicleAnyUpdateSchema,
  vehicleSchema,
} from "@/lib/validation";
import type { Role } from "@/types/domain";
import type { CompanyCashTransactionType, ExternalCashTransactionType } from "@/types/domain";

const LEGACY_MUTATION_HEADERS = { "x-dealer-flow-deprecated-route": "/api/mutations" };

type Operation =
  | "createOrganization"
  | "joinOrganization"
  | "createVehicle"
  | "updateVehicle"
  | "deleteVehicle"
  | "createExpense"
  | "updateExpense"
  | "deleteExpense"
  | "createRecurringExpenseTemplate"
  | "updateRecurringExpenseTemplate"
  | "deleteRecurringExpenseTemplate"
  | "applyRecurringExpenseTemplate"
  | "recordSale"
  | "voidSale"
  | "correctSale"
  | "createCashTransaction"
  | "updateCashTransaction"
  | "deleteCashTransaction"
  | "createContact"
  | "createAttachment"
  | "setVehicleMainPhoto"
  | "updateMemberRole"
  | "removeMember"
  | "logActivity"
  | "regenerateInvitationCode";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await checkRateLimit(request, "mutations", { limit: 90, windowMs: 60_000 });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number((error as { status: number }).status) : 400;
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Request failed." }, { status });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 503 });
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
  }
  try {
    await checkRateLimit(request, "mutations-user", { limit: 60, windowMs: 60_000, userId: userData.user.id });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number((error as { status: number }).status) : 400;
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Request failed." }, { status });
  }

  const formData = await request.formData();
  const operation = String(formData.get("operation") || "") as Operation;
  const organizationId = String(formData.get("organizationId") || "");

  try {
    switch (operation) {
      case "createOrganization": {
        organizationSchema.parse(formDataToObject(formData));
        await createOrganization(supabase, String(formData.get("organizationName") || ""));
        return ok();
      }
      case "joinOrganization": {
        invitationCodeSchema.parse(formDataToObject(formData));
        await joinOrganization(supabase, String(formData.get("inviteCode") || ""));
        return ok();
      }
      case "createVehicle": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin", "member"]);
        const parsed = vehicleSchema.parse(formDataToObject(formData));
        formData.set("vin", parsed.vin);
        await assertUniqueActiveVin(supabase, organizationId, parsed.vin);
        const id = await createVehicle(supabase, organizationId, formData);
        return ok({ id });
      }
      case "updateVehicle": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin", "member"]);
        const parsed = vehicleAnyUpdateSchema.parse(formDataToObject(formData));
        const vehicle = await getVehicle(supabase, organizationId, String(formData.get("vehicleId") || ""));
        if ("vin" in parsed) {
          formData.set("vin", parsed.vin);
          await assertUniqueActiveVin(supabase, organizationId, parsed.vin, vehicle.id);
        }
        await updateVehicle(supabase, vehicle, formData);
        return ok();
      }
      case "deleteVehicle": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin"]);
        deleteVehicleSchema.parse(formDataToObject(formData));
        const vehicleId = String(formData.get("vehicleId") || "");
        const confirmationText = String(formData.get("confirmationText") || "").trim();
        const archiveReason = String(formData.get("archiveReason") || "").trim();
        const vehicle = await getVehicleOptional(supabase, organizationId, vehicleId);
        if (!vehicle) throw new ApiError(404, "Vehicle was not found.");
        if (vehicle.archivedAt) throw new ApiError(400, "Vehicle is already archived.");
        assertVehicleDeleteConfirmation(vehicle, confirmationText);
        await archiveVehicle(supabase, organizationId, vehicle.id, archiveReason);
        return ok({ archived: true });
      }
      case "createExpense": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin", "member"]);
        expenseSchema.parse(formDataToObject(formData));
        const vehicle = await getVehicle(supabase, organizationId, String(formData.get("vehicleId") || ""));
        const id = await createExpense(supabase, vehicle, formData);
        return ok({ id });
      }
      case "updateExpense": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin", "member"]);
        expenseSchema.parse(formDataToObject(formData));
        const vehicle = await getVehicle(supabase, organizationId, String(formData.get("vehicleId") || ""));
        await updateExpense(supabase, vehicle, String(formData.get("expenseId") || ""), formData);
        return ok();
      }
      case "deleteExpense": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin", "member"]);
        const vehicle = await getVehicle(supabase, organizationId, String(formData.get("vehicleId") || ""));
        await deleteExpense(supabase, vehicle, String(formData.get("expenseId") || ""));
        return ok();
      }
      case "recordSale": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin", "member"]);
        saleSchema.parse(formDataToObject(formData));
        const vehicle = await getVehicle(supabase, organizationId, String(formData.get("vehicleId") || ""));
        const appData = await loadAppData(supabase, userData.user, organizationId);
        if (appData.sales.some((sale) => sale.vehicleId === vehicle.id && isActiveSale(sale))) {
          throw new ApiError(400, "This vehicle already has a sale record.");
        }
        await recordVehicleSale(supabase, appData, vehicle, formData);
        return ok();
      }
      case "voidSale": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin", "member"]);
        saleVoidSchema.parse(formDataToObject(formData));
        await voidVehicleSale(
          supabase,
          organizationId,
          String(formData.get("saleId") || ""),
          String(formData.get("reason") || ""),
        );
        return ok();
      }
      case "correctSale": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin", "member"]);
        saleCorrectionSchema.parse(formDataToObject(formData));
        const id = await correctVehicleSale(
          supabase,
          organizationId,
          String(formData.get("saleId") || ""),
          formData,
        );
        return ok({ id });
      }
      case "createRecurringExpenseTemplate": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin"]);
        recurringExpenseTemplateSchema.parse(formDataToObject(formData));
        await createRecurringExpenseTemplate(supabase, organizationId, formData);
        return ok();
      }
      case "updateRecurringExpenseTemplate": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin"]);
        recurringExpenseTemplateSchema.parse(formDataToObject(formData));
        await updateRecurringExpenseTemplate(supabase, organizationId, formData);
        return ok();
      }
      case "deleteRecurringExpenseTemplate": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin"]);
        await deleteRecurringExpenseTemplate(supabase, organizationId, String(formData.get("templateId") || ""));
        return ok();
      }
      case "applyRecurringExpenseTemplate": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin", "member"]);
        applyRecurringExpenseTemplateSchema.parse(formDataToObject(formData));
        const vehicle = await getVehicle(supabase, organizationId, String(formData.get("vehicleId") || ""));
        const id = await applyRecurringExpenseTemplate(supabase, vehicle, String(formData.get("templateId") || ""));
        return ok({ id });
      }
      case "createCashTransaction": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin"]);
        cashTransactionSchema.parse(formDataToObject(formData));
        const appData = await loadAppData(supabase, userData.user, organizationId);
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
          supabase,
          organizationId,
          type,
          amount,
          String(formData.get("note") || ""),
          String(formData.get("date") || ""),
        );
        return ok();
      }
      case "updateCashTransaction": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin"]);
        cashUpdateSchema.parse(formDataToObject(formData));
        const appData = await loadAppData(supabase, userData.user, organizationId);
        assertCashUpdateKeepsBalance(
          appData,
          String(formData.get("account") || "") as "company" | "external",
          String(formData.get("transactionId") || ""),
          Number(formData.get("amount")),
        );
        await updateCashTransaction(
          supabase,
          organizationId,
          String(formData.get("account") || "") as "company" | "external",
          String(formData.get("transactionId") || ""),
          formData,
        );
        return ok();
      }
      case "deleteCashTransaction": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin"]);
        await deleteCashTransaction(
          supabase,
          organizationId,
          String(formData.get("account") || "") as "company" | "external",
          String(formData.get("transactionId") || ""),
          String(formData.get("reason") || ""),
        );
        return ok();
      }
      case "createContact": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin", "member"]);
        contactSchema.parse(formDataToObject(formData));
        await createContact(supabase, organizationId, formData);
        return ok();
      }
      case "createAttachment": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin", "member"]);
        attachmentSchema.parse(formDataToObject(formData));
        const relation = {
          vehicleId: optionalId(formData.get("vehicleId")),
          expenseId: optionalId(formData.get("expenseId")),
          saleId: optionalId(formData.get("saleId")),
          contactId: optionalId(formData.get("contactId")),
          companyCashTransactionId: optionalId(formData.get("companyCashTransactionId")),
          externalCashTransactionId: optionalId(formData.get("externalCashTransactionId")),
        };
        await assertRelationBelongsToOrganization(supabase, organizationId, relation);
        await createAttachment(supabase, organizationId, formData, relation);
        return ok();
      }
      case "setVehicleMainPhoto": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin", "member"]);
        const vehicle = await getVehicle(supabase, organizationId, String(formData.get("vehicleId") || ""));
        const attachment = await getAttachment(supabase, organizationId, String(formData.get("attachmentId") || ""));
        await updateVehicleMainPhoto(supabase, vehicle, attachment);
        return ok();
      }
      case "updateMemberRole": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner"]);
        roleUpdateSchema.parse(formDataToObject(formData));
        await updateMemberRole(
          supabase,
          organizationId,
          String(formData.get("membershipId") || ""),
          String(formData.get("role") || "") as Role,
        );
        return ok();
      }
      case "removeMember": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner"]);
        await removeMember(supabase, organizationId, String(formData.get("membershipId") || ""));
        return ok();
      }
      case "logActivity": {
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin"]);
        activityLogSchema.parse(formDataToObject(formData));
        await logServerActivity(
          supabase,
          organizationId,
          String(formData.get("action") || ""),
          String(formData.get("entityType") || ""),
          undefined,
          String(formData.get("message") || ""),
        );
        return ok();
      }
      case "regenerateInvitationCode": {
        regenerateInvitationSchema.parse(formDataToObject(formData));
        await requireRole(supabase, userData.user.id, organizationId, ["owner", "admin"]);
        const inviteCode = await regenerateInvitationCode(supabase, organizationId);
        return ok({ inviteCode });
      }
      default:
        return NextResponse.json({ ok: false, message: "Unknown operation." }, { status: 400 });
    }
  } catch (error) {
    console.error("[mutations] operation failed", { operation, error });
    const status = error instanceof ApiError ? error.status : 400;
    return NextResponse.json({ ok: false, message: toClientErrorMessage(error, operation) }, { status });
  }
}

function ok(extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: true, ...extra }, { headers: LEGACY_MUTATION_HEADERS });
}

async function requireRole(client: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string, organizationId: string, roles: Role[]) {
  if (!client || !organizationId) throw new ApiError(400, "Organization is required.");
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

async function assertRelationBelongsToOrganization(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  relation: Record<string, string | undefined>,
) {
  if (!client) throw new ApiError(503, "Supabase is not configured.");
  const checks: Array<[string, string]> = [
    ["vehicleId", "vehicles"],
    ["expenseId", "vehicle_expenses"],
    ["saleId", "sales"],
    ["contactId", "contacts"],
    ["companyCashTransactionId", "company_cash_transactions"],
    ["externalCashTransactionId", "external_cash_transactions"],
  ];
  for (const [key, table] of checks) {
    const id = relation[key];
    if (!id) continue;
    const { data, error } = await client
      .from(table)
      .select("organization_id")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(400, "Attachment relation does not belong to this organization.");
  }
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function getVehicle(client: Awaited<ReturnType<typeof createSupabaseServerClient>>, organizationId: string, vehicleId: string) {
  if (!client || !vehicleId) throw new Error("Vehicle is required.");
  const { data, error } = await client
    .from("vehicles")
    .select("*")
    .eq("id", vehicleId)
    .eq("organization_id", organizationId)
    .single();
  if (error) throw error;
  return mapVehicle(data as Record<string, unknown>);
}

async function getVehicleOptional(client: Awaited<ReturnType<typeof createSupabaseServerClient>>, organizationId: string, vehicleId: string) {
  if (!client || !vehicleId) throw new ApiError(400, "Vehicle is required.");
  const { data, error } = await client
    .from("vehicles")
    .select("*")
    .eq("id", vehicleId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  return mapVehicle(data as Record<string, unknown>);
}

async function assertUniqueActiveVin(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  vin: string,
  exceptVehicleId?: string,
) {
  if (!client) throw new Error("Supabase is not configured.");
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

async function getAttachment(client: Awaited<ReturnType<typeof createSupabaseServerClient>>, organizationId: string, attachmentId: string) {
  if (!client || !attachmentId) throw new Error("Attachment is required.");
  const { data, error } = await client
    .from("attachments")
    .select("*")
    .eq("id", attachmentId)
    .eq("organization_id", organizationId)
    .single();
  if (error) throw error;
  return mapAttachment(data as Record<string, unknown>);
}

function optionalId(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function assertVehicleDeleteConfirmation(vehicle: { vin?: string; id: string }, confirmationText: string) {
  if (isValidVehicleDeleteConfirmation(confirmationText, vehicle.vin)) return;
  throw new ApiError(400, "Type DELETE or the vehicle VIN to confirm deletion.");
}

function toClientErrorMessage(error: unknown, operation: Operation) {
  if (error instanceof ApiError) return error.message;
  const message = formatValidationError(error);
  if (operation === "applyRecurringExpenseTemplate") {
    const normalized = message.toLowerCase();
    if (normalized.includes("template not found") || normalized.includes("0 rows")) return "Template not found.";
    if (normalized.includes("vehicle") && normalized.includes("required")) return "Vehicle not found.";
    if (normalized.includes("permission")) return "You are not allowed to apply this template.";
    if (normalized.includes("cash does not have enough")) return message;
    return "Template could not be applied. Please try again.";
  }
  if (operation === "deleteVehicle") {
    const normalized = message.toLowerCase();
    if (normalized.includes("not allowed")) return "You are not allowed to archive this vehicle.";
    if (normalized.includes("vehicle not found")) return "Vehicle not found.";
    if (normalized.includes("already archived")) return "Vehicle is already archived.";
    if (
      normalized.includes("archive_vehicle") ||
      normalized.includes("could not find the function") ||
      normalized.includes("does not exist")
    ) {
      console.error("[deleteVehicle] missing database RPC. Apply the latest vehicle archive migration in Supabase.");
      return "Vehicle archive database migration is missing. Run the latest vehicle archive migration in Supabase, then try again.";
    }
    if (normalized === "invalid input." || normalized.includes("invalid input syntax")) {
      return "Type DELETE or the vehicle VIN to confirm archive.";
    }
    return "Vehicle could not be archived. Please try again.";
  }
  if (operation === "deleteCashTransaction") {
    const normalized = message.toLowerCase();
    if (
      normalized.includes("reverse_company_cash_transaction") ||
      normalized.includes("reverse_external_cash_transaction") ||
      normalized.includes("could not find the function") ||
      normalized.includes("does not exist")
    ) {
      console.error("[deleteCashTransaction] missing database RPC. Apply the latest cash reversal migration in Supabase.");
      return "Cash reversal database migration is missing. Run the latest cash reversal migration in Supabase, then try again.";
    }
    if (normalized.includes("system-generated cash transactions")) {
      return "This linked cash transaction must be corrected through the vehicle or sale workflow.";
    }
    return message;
  }
  if (operation === "updateVehicle") {
    const normalized = message.toLowerCase();
    if (
      normalized.includes("correct_vehicle_purchase") ||
      normalized.includes("transition_vehicle_status") ||
      normalized.includes("could not find the function") ||
      normalized.includes("does not exist")
    ) {
      console.error("[updateVehicle] missing database RPC. Apply the latest vehicle correction migration in Supabase.");
      return "Vehicle correction database migration is missing. Run the latest vehicle correction migration in Supabase, then try again.";
    }
    return message;
  }
  if (operation === "voidSale" || operation === "correctSale") {
    const normalized = message.toLowerCase();
    if (
      normalized.includes("void_vehicle_sale_atomic") ||
      normalized.includes("correct_vehicle_sale_atomic") ||
      normalized.includes("could not find the function") ||
      normalized.includes("does not exist")
    ) {
      console.error("[saleCorrection] missing database RPC. Apply the latest sale correction migration in Supabase.");
      return "Sale correction database migration is missing. Run the latest sale correction migration in Supabase, then try again.";
    }
    return message;
  }
  return message;
}

function assertCashUpdateKeepsBalance(appData: Awaited<ReturnType<typeof loadAppData>>, account: "company" | "external", transactionId: string, amount: number) {
  if (!transactionId) throw new ApiError(400, "Transaction is required.");
  if (account === "company") {
    const current = appData.companyCashTransactions.find((transaction) => transaction.id === transactionId && !transaction.deletedAt);
    if (!current) throw new ApiError(404, "Company cash transaction was not found.");
    const nextTransactions = appData.companyCashTransactions.map((transaction) =>
      transaction.id === transactionId ? { ...transaction, amount } : transaction,
    );
    if (calculateCompanyCashBalance(nextTransactions) < 0) {
      throw new ApiError(400, "This edit would make company cash negative.");
    }
    return;
  }
  if (account === "external") {
    const current = appData.externalCashTransactions.find((transaction) => transaction.id === transactionId && !transaction.deletedAt);
    if (!current) throw new ApiError(404, "External cash transaction was not found.");
    const nextTransactions = appData.externalCashTransactions.map((transaction) =>
      transaction.id === transactionId ? { ...transaction, amount } : transaction,
    );
    if (calculateExternalCashBalance(nextTransactions) < 0) {
      throw new ApiError(400, "This edit would make external cash negative.");
    }
    return;
  }
  throw new ApiError(400, "Cash account is invalid.");
}

async function updateMemberRole(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  membershipId: string,
  role: Role,
) {
  if (!client) throw new Error("Supabase is not configured.");
  const membership = await getMembership(client, organizationId, membershipId);
  if (membership.role === "owner" && role !== "owner") {
    await assertAnotherOwnerExists(client, organizationId, membershipId);
  }
  const { error } = await client
    .from("organization_memberships")
    .update({ role })
    .eq("id", membershipId)
    .eq("organization_id", organizationId);
  if (error) throw error;
  await logServerActivity(client, organizationId, "role_changed", "organization_membership", membershipId, `Role changed to ${role}`);
}

async function removeMember(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  membershipId: string,
) {
  if (!client) throw new Error("Supabase is not configured.");
  const membership = await getMembership(client, organizationId, membershipId);
  if (membership.role === "owner") {
    await assertAnotherOwnerExists(client, organizationId, membershipId);
  }
  const { error } = await client
    .from("organization_memberships")
    .delete()
    .eq("id", membershipId)
    .eq("organization_id", organizationId);
  if (error) throw error;
  await logServerActivity(client, organizationId, "member_removed", "organization_membership", membershipId, "Organization member removed");
}

async function getMembership(client: Awaited<ReturnType<typeof createSupabaseServerClient>>, organizationId: string, membershipId: string) {
  if (!client || !membershipId) throw new Error("Membership is required.");
  const { data, error } = await client
    .from("organization_memberships")
    .select("id, role, user_id")
    .eq("id", membershipId)
    .eq("organization_id", organizationId)
    .single();
  if (error) throw error;
  return data as { id: string; role: Role; user_id: string };
}

async function assertAnotherOwnerExists(client: Awaited<ReturnType<typeof createSupabaseServerClient>>, organizationId: string, membershipId: string) {
  if (!client) throw new Error("Supabase is not configured.");
  const { data, error } = await client
    .from("organization_memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .neq("id", membershipId)
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("An organization must keep at least one owner.");
}

async function logServerActivity(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  action: string,
  entityType: string,
  entityId: string | undefined,
  message: string,
) {
  if (!client) return;
  const { data: userData } = await client.auth.getUser();
  await client.from("activity_logs").insert({
    organization_id: organizationId,
    action,
    entity_type: entityType,
    entity_id: entityId ?? null,
    message,
    created_by: userData.user?.id,
  });
}

async function regenerateInvitationCode(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
) {
  if (!client) throw new Error("Supabase is not configured.");
  const { data: userData } = await client.auth.getUser();
  const inviteCode = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const { data: existingInvitation, error: readError } = await client
    .from("organization_invitations")
    .select("id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) throw readError;

  if (existingInvitation?.id) {
    const { error } = await client
      .from("organization_invitations")
      .update({ access_code: inviteCode, default_role: "viewer", expires_at: null })
      .eq("id", existingInvitation.id)
      .eq("organization_id", organizationId);
    if (error) throw error;
  } else {
    const { error } = await client.from("organization_invitations").insert({
      organization_id: organizationId,
      access_code: inviteCode,
      default_role: "viewer",
      created_by: userData.user?.id,
    });
    if (error) throw error;
  }

  await logServerActivity(
    client,
    organizationId,
    "invitation_regenerated",
    "organization_invitation",
    existingInvitation?.id,
    "Organization invitation code regenerated.",
  );
  return inviteCode;
}
