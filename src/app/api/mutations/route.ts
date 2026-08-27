import { NextResponse } from "next/server";
import { assertSameOrigin, checkRateLimit } from "@/lib/server/security";
import { handleDomainMutation, isDomainMutationOperation } from "@/lib/server/domain-mutation-handlers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createAttachment,
  createContact,
  createOrganization,
  createRecurringExpenseTemplate,
  deleteRecurringExpenseTemplate,
  joinOrganization,
  applyRecurringExpenseTemplate,
  updateRecurringExpenseTemplate,
  updateVehicleMainPhoto,
} from "@/lib/supabase/repository";
import { mapAttachment, mapVehicle } from "@/lib/supabase/mappers";
import {
  attachmentSchema,
  activityLogSchema,
  applyRecurringExpenseTemplateSchema,
  contactSchema,
  formatValidationError,
  formDataToObject,
  invitationCodeSchema,
  organizationSchema,
  regenerateInvitationSchema,
  recurringExpenseTemplateSchema,
  roleUpdateSchema,
} from "@/lib/validation";
import type { Role } from "@/types/domain";

const LEGACY_MUTATION_HEADERS = { "x-dealer-flow-deprecated-route": "/api/mutations" };

type Operation =
  | "createOrganization"
  | "joinOrganization"
  | "createVehicle"
  | "updateVehicle"
  | "deleteVehicle"
  | "createExpense"
  | "updateExpense"
  | "voidExpense"
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

  if (isDomainMutationOperation(operation)) {
    return handleDomainMutation({
      client: supabase,
      user: userData.user,
      operation,
      organizationId,
      formData,
      legacy: true,
    });
  }

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
  return message;
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
