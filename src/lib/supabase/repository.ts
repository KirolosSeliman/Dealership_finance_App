import type { SupabaseClient, User } from "@supabase/supabase-js";
import { calculateExpenseTax } from "@/lib/domain/calculations";
import { MANUAL_CASH_TRANSACTION_TYPES } from "@/lib/domain/constants";
import { assertAllowedUpload, sanitizeStorageFileName } from "@/lib/security";
import { dedupeOrganizationsByHighestRole, emptyAppData, mapActivityLog, mapAttachment, mapCompanyCashTransaction, mapContact, mapExpense, mapExternalCashTransaction, mapMembership, mapOrganization, mapRecurringExpenseTemplate, mapSale, mapVehicle } from "@/lib/supabase/mappers";
import { normalizeVin } from "@/lib/validation";
import type {
  AppData,
  Attachment,
  AttachmentType,
  CompanyCashTransaction,
  ContactType,
  ExpenseCategory,
  ExpenseFundingSource,
  ExpenseTaxBehavior,
  ExternalCashTransaction,
  PurchaseSource,
  Vehicle,
  VehicleStatus,
} from "@/types/domain";

type Client = SupabaseClient;

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function getCurrentUser(client: Client) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function signIn(client: Client, email: string, password: string) {
  const { error } = await client.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  });
  if (error) throw error;
}

export async function signUp(client: Client, email: string, password: string, fullName: string) {
  const { error } = await client.auth.signUp({
    email: normalizeEmail(email),
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw error;
}

export async function signOut(client: Client) {
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function loadAppData(client: Client, user: User, activeOrganizationId?: string): Promise<AppData> {
  await ensureProfile(client, user);
  const memberships = await selectRows(client, "organization_memberships", "organization_id, role, organizations(id, name)");
  const invitationRows = await selectRows(client, "organization_invitations", "organization_id, access_code");
  const organizations = dedupeOrganizationsByHighestRole(memberships.map((row) => {
    const organization = mapOrganization(row);
    organization.inviteCode = String(
      invitationRows.find((invite) => invite.organization_id === organization.id)?.access_code ?? "",
    );
    return organization;
  }));

  const preferences = await selectRows(client, "user_preferences", "active_organization_id, selected_language");
  const preferredOrgId = String(preferences[0]?.active_organization_id ?? "");
  const activeOrg =
    organizations.find((organization) => organization.id === activeOrganizationId) ??
    organizations.find((organization) => organization.id === preferredOrgId) ??
    organizations[0];

  if (!activeOrg) {
    return {
      ...emptyAppData,
      userId: user.id,
      userEmail: user.email,
      userName: user.user_metadata?.full_name ?? user.email ?? "",
    };
  }

  const organizationId = activeOrg.id;
  const [
    vehicles,
    expenses,
    sales,
    contacts,
    attachments,
    companyCashTransactions,
    externalCashTransactions,
    recurringExpenseTemplates,
    activityLogs,
  ] = await Promise.all([
    selectOrgRows(client, "vehicles", organizationId),
    selectOrgRows(client, "vehicle_expenses", organizationId),
    selectOrgRows(client, "sales", organizationId),
    selectOrgRows(client, "contacts", organizationId),
    selectOrgRows(client, "attachments", organizationId),
    selectOrgRows(client, "company_cash_transactions", organizationId),
    selectOrgRows(client, "external_cash_transactions", organizationId),
    selectOrgRows(client, "recurring_vehicle_expense_templates", organizationId),
    selectOrgRows(client, "activity_logs", organizationId),
  ]);

  const mappedVehicles = vehicles.map(mapVehicle);
  const mappedAttachments = attachments.map(mapAttachment);
  await Promise.all(
    mappedAttachments.map(async (attachment) => {
      if (attachment.type !== "photo" && attachment.type !== "file") return;
      if (!attachment.urlOrPath || attachment.urlOrPath.startsWith("http")) return;
      const { data: signed } = await client.storage
        .from("dealer-flow-private")
        .createSignedUrl(attachment.urlOrPath, 60 * 10);
      attachment.previewUrl = signed?.signedUrl;
    }),
  );
  await Promise.all(
    mappedVehicles.map(async (vehicle) => {
      if (!vehicle.mainPhotoPath || vehicle.mainPhotoPath.startsWith("http")) return;
      const attachmentPreview = mappedAttachments.find((attachment) => attachment.urlOrPath === vehicle.mainPhotoPath)?.previewUrl;
      if (attachmentPreview) {
        vehicle.mainPhotoUrl = attachmentPreview;
        return;
      }
      const { data: signed } = await client.storage
        .from("dealer-flow-private")
        .createSignedUrl(vehicle.mainPhotoPath, 60 * 10);
      vehicle.mainPhotoUrl = signed?.signedUrl ?? vehicle.mainPhotoPath;
    }),
  );

  return {
    organizations,
    memberships: memberships.map(mapMembership),
    activeOrganizationId: organizationId,
    userId: user.id,
    userEmail: user.email,
    userName: user.user_metadata?.full_name ?? user.email ?? "",
    vehicles: mappedVehicles,
    expenses: expenses.map(mapExpense),
    recurringExpenseTemplates: recurringExpenseTemplates.map(mapRecurringExpenseTemplate),
    sales: sales.map(mapSale),
    contacts: contacts.map(mapContact),
    attachments: mappedAttachments,
    companyCashTransactions: companyCashTransactions.map(mapCompanyCashTransaction),
    externalCashTransactions: externalCashTransactions.map(mapExternalCashTransaction),
    activityLogs: activityLogs.map(mapActivityLog),
  };
}

export async function createOrganization(client: Client, name: string) {
  const { data, error } = await client.rpc("create_organization_with_owner", { organization_name: name });
  if (error) throw error;
  const organizationId = String(data ?? "");
  if (organizationId) {
    await logActivity(client, organizationId, "organization_created", "organization", organizationId, "Organization created");
    await logActivity(client, organizationId, "invitation_created", "organization_invitation", undefined, "Default invitation code created");
  }
}

export async function joinOrganization(client: Client, accessCode: string) {
  const { data, error } = await client.rpc("join_organization_by_access_code", { invitation_code: accessCode });
  if (error) throw error;
  const organizationId = String(data ?? "");
  if (organizationId) {
    await logActivity(client, organizationId, "organization_joined", "organization_membership", undefined, "User joined organization by invitation code");
  }
}

export async function saveLanguagePreference(client: Client, language: "en" | "fr", activeOrganizationId?: string) {
  const user = await getCurrentUser(client);
  if (!user) return;
  const { error } = await client.from("user_preferences").upsert({
    user_id: user.id,
    selected_language: language,
    active_organization_id: activeOrganizationId || null,
  }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function createVehicle(client: Client, organizationId: string, formData: FormData) {
  const { data, error } = await client.rpc("create_vehicle_with_defaults", {
    p_organization_id: organizationId,
    p_vin: normalizeVin(formData.get("vin")),
    p_year: optionalNumber(formData.get("year")),
    p_make: optionalString(formData.get("make")),
    p_model: optionalString(formData.get("model")),
    p_trim: optionalString(formData.get("trim")),
    p_color: optionalString(formData.get("color")),
    p_mileage: optionalNumber(formData.get("mileage")),
    p_purchase_price: numberValue(formData.get("purchasePrice")),
    p_purchase_date: stringValue(formData.get("purchaseDate")) || today(),
    p_purchase_source: (stringValue(formData.get("purchaseSource")) || "other") as PurchaseSource,
    p_status: (stringValue(formData.get("status")) || "purchased") as VehicleStatus,
    p_listed_price: optionalNumber(formData.get("listedPrice")),
    p_notes: optionalString(formData.get("notes")),
  });
  if (error) throw error;
  return String(data);
}

export async function updateVehicle(client: Client, vehicle: Vehicle, formData: FormData) {
  const updateMode = stringValue(formData.get("updateMode")) || "basic";
  if (updateMode === "purchase") {
    const { error } = await client.rpc("correct_vehicle_purchase", {
      p_organization_id: vehicle.organizationId,
      p_vehicle_id: vehicle.id,
      p_purchase_price: numberValue(formData.get("purchasePrice")),
      p_purchase_date: stringValue(formData.get("purchaseDate")) || today(),
      p_purchase_source: stringValue(formData.get("purchaseSource")) as PurchaseSource,
      p_reason: stringValue(formData.get("reason")),
    });
    if (error) throw error;
    return;
  }
  if (updateMode === "status") {
    const { error } = await client.rpc("transition_vehicle_status", {
      p_organization_id: vehicle.organizationId,
      p_vehicle_id: vehicle.id,
      p_next_status: stringValue(formData.get("status")) as VehicleStatus,
      p_reason: optionalString(formData.get("reason")),
    });
    if (error) throw error;
    return;
  }
  const payload = {
    vin: normalizeVin(formData.get("vin")),
    year: optionalNumber(formData.get("year")),
    make: optionalString(formData.get("make")),
    model: optionalString(formData.get("model")),
    trim: optionalString(formData.get("trim")),
    color: optionalString(formData.get("color")),
    mileage: optionalNumber(formData.get("mileage")),
    listed_price: optionalNumber(formData.get("listedPrice")),
    notes: optionalString(formData.get("notes")),
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from("vehicles").update(payload).eq("id", vehicle.id);
  if (error) throw error;
  await logActivity(client, vehicle.organizationId, "vehicle_updated", "vehicle", vehicle.id, "Vehicle details updated");
}

export async function updateVehicleMainPhoto(client: Client, vehicle: Vehicle, attachment: Attachment) {
  if (attachment.organizationId !== vehicle.organizationId || attachment.vehicleId !== vehicle.id || attachment.type !== "photo") {
    throw new Error("This photo does not belong to the selected vehicle.");
  }
  const { error } = await client.from("vehicles").update({
    main_photo_path: attachment.urlOrPath,
    updated_at: new Date().toISOString(),
  }).eq("id", vehicle.id).eq("organization_id", vehicle.organizationId);
  if (error) throw error;
  await logActivity(client, vehicle.organizationId, "vehicle_main_photo_updated", "vehicle", vehicle.id, attachment.title);
}

export async function archiveVehicle(
  client: Client,
  organizationId: string,
  vehicleId: string,
  reason?: string,
) {
  const { error } = await client.rpc("archive_vehicle", {
    p_organization_id: organizationId,
    p_vehicle_id: vehicleId,
    p_reason: reason?.trim() || null,
  });
  if (error) throw error;
}

export async function createExpense(client: Client, vehicle: Vehicle, formData: FormData) {
  const amountBeforeTax = numberValue(formData.get("amountBeforeTax"));
  const category = stringValue(formData.get("category")) as ExpenseCategory;
  const tax = calculateExpenseTax({
    purchaseSource: vehicle.purchaseSource,
    category,
    amountBeforeTax,
    addFifteenPercentTax: formData.get("addTax") === "on",
  });
  const { data, error } = await client.rpc("create_vehicle_expense_with_cash_impact", {
    p_organization_id: vehicle.organizationId,
    p_vehicle_id: vehicle.id,
    p_recurring_template_id: null,
    p_category: category,
    p_amount_before_tax: amountBeforeTax,
    p_tax_rate: tax.taxRate,
    p_tax_amount: tax.taxAmount,
    p_total_amount: tax.totalAmount,
    p_funding_source: (stringValue(formData.get("fundingSource")) || "company_cash") as ExpenseFundingSource,
    p_date: stringValue(formData.get("date")) || today(),
    p_note: optionalString(formData.get("note")),
  });
  if (error) throw error;
  return String(data);
}

export async function updateExpense(client: Client, vehicle: Vehicle, expenseId: string, formData: FormData) {
  const amountBeforeTax = numberValue(formData.get("amountBeforeTax"));
  const category = stringValue(formData.get("category")) as ExpenseCategory;
  const tax = calculateExpenseTax({
    purchaseSource: vehicle.purchaseSource,
    category,
    amountBeforeTax,
    addFifteenPercentTax: formData.get("addTax") === "on",
  });
  const { error } = await client.rpc("update_vehicle_expense_with_cash_impact", {
    p_organization_id: vehicle.organizationId,
    p_vehicle_id: vehicle.id,
    p_expense_id: expenseId,
    p_category: category,
    p_amount_before_tax: amountBeforeTax,
    p_tax_rate: tax.taxRate,
    p_tax_amount: tax.taxAmount,
    p_total_amount: tax.totalAmount,
    p_date: stringValue(formData.get("date")) || today(),
    p_note: optionalString(formData.get("note")),
  });
  if (error) throw error;
}

export async function createRecurringExpenseTemplate(client: Client, organizationId: string, formData: FormData) {
  const user = await requireUser(client);
  const amountBeforeTax = numberValue(formData.get("amountBeforeTax"));
  const taxBehavior = (stringValue(formData.get("taxBehavior")) || "no_tax") as ExpenseTaxBehavior;
  const customTaxRate = optionalNumber(formData.get("customTaxRate")) ?? 0;
  const tax = calculateExpenseTax({
    category: stringValue(formData.get("category")) || "other",
    amountBeforeTax,
    taxBehavior,
    customTaxRate,
  });
  const { error } = await client.from("recurring_vehicle_expense_templates").insert({
    organization_id: organizationId,
    name: stringValue(formData.get("name")),
    description: optionalString(formData.get("description")),
    category: stringValue(formData.get("category")) as ExpenseCategory,
    amount_before_tax: amountBeforeTax,
    tax_behavior: taxBehavior,
    tax_rate: tax.taxRate,
    tax_amount: tax.taxAmount,
    total_amount: tax.totalAmount,
    default_funding_source: (stringValue(formData.get("defaultFundingSource")) || "company_cash") as ExpenseFundingSource,
    auto_apply_to_new_vehicles: formData.get("autoApplyToNewVehicles") === "on",
    is_active: formData.get("isActive") !== "off",
    created_by: user.id,
  });
  if (error) throw error;
  await logActivity(client, organizationId, "recurring_expense_template_created", "recurring_vehicle_expense_template", undefined, stringValue(formData.get("name")));
}

export async function updateRecurringExpenseTemplate(client: Client, organizationId: string, formData: FormData) {
  const templateId = stringValue(formData.get("templateId"));
  const amountBeforeTax = numberValue(formData.get("amountBeforeTax"));
  const taxBehavior = (stringValue(formData.get("taxBehavior")) || "no_tax") as ExpenseTaxBehavior;
  const customTaxRate = optionalNumber(formData.get("customTaxRate")) ?? 0;
  const tax = calculateExpenseTax({
    category: stringValue(formData.get("category")) || "other",
    amountBeforeTax,
    taxBehavior,
    customTaxRate,
  });
  const { error } = await client.from("recurring_vehicle_expense_templates").update({
    name: stringValue(formData.get("name")),
    description: optionalString(formData.get("description")),
    category: stringValue(formData.get("category")) as ExpenseCategory,
    amount_before_tax: amountBeforeTax,
    tax_behavior: taxBehavior,
    tax_rate: tax.taxRate,
    tax_amount: tax.taxAmount,
    total_amount: tax.totalAmount,
    default_funding_source: (stringValue(formData.get("defaultFundingSource")) || "company_cash") as ExpenseFundingSource,
    auto_apply_to_new_vehicles: formData.get("autoApplyToNewVehicles") === "on",
    is_active: formData.get("isActive") === "on",
    updated_at: new Date().toISOString(),
  }).eq("id", templateId).eq("organization_id", organizationId);
  if (error) throw error;
  await logActivity(client, organizationId, "recurring_expense_template_updated", "recurring_vehicle_expense_template", templateId, stringValue(formData.get("name")));
}

export async function deleteRecurringExpenseTemplate(client: Client, organizationId: string, templateId: string) {
  const user = await requireUser(client);
  const { error } = await client.from("recurring_vehicle_expense_templates").update({
    is_active: false,
    deleted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", templateId).eq("organization_id", organizationId);
  if (error) throw error;
  await logActivity(client, organizationId, "recurring_expense_template_deleted", "recurring_vehicle_expense_template", templateId, `Template deactivated by ${user.id}`);
}

export async function applyRecurringExpenseTemplate(client: Client, vehicle: Vehicle, templateId: string) {
  if (!templateId) throw new Error("Template is required.");
  const { data, error } = await client
    .from("recurring_vehicle_expense_templates")
    .select("*")
    .eq("id", templateId)
    .eq("organization_id", vehicle.organizationId)
    .is("deleted_at", null)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Template not found.");
  const template = mapRecurringExpenseTemplate(data as Record<string, unknown>);
  const { data: expenseId, error: createError } = await client.rpc("create_vehicle_expense_with_cash_impact", {
    p_organization_id: vehicle.organizationId,
    p_vehicle_id: vehicle.id,
    p_recurring_template_id: template.id,
    p_category: template.category,
    p_amount_before_tax: template.amountBeforeTax,
    p_tax_rate: template.taxRate,
    p_tax_amount: template.taxAmount,
    p_total_amount: template.totalAmount,
    p_funding_source: template.defaultFundingSource,
    p_date: today(),
    p_note: template.description || template.name,
  });
  if (createError) throw createError;
  return String(expenseId);
}

export async function voidVehicleExpense(client: Client, vehicle: Vehicle, expenseId: string, reason: string) {
  const { error } = await client.rpc("void_vehicle_expense_with_cash_reversal", {
    p_organization_id: vehicle.organizationId,
    p_vehicle_id: vehicle.id,
    p_expense_id: expenseId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function recordVehicleSale(client: Client, _appData: AppData, vehicle: Vehicle, formData: FormData) {
  const { data, error } = await client.rpc("record_vehicle_sale_atomic", {
    p_organization_id: vehicle.organizationId,
    p_vehicle_id: vehicle.id,
    p_sale_date: stringValue(formData.get("saleDate")) || today(),
    p_taxable_profit_amount: numberValue(formData.get("taxableProfitAmount")),
    p_real_client_payment: numberValue(formData.get("realClientPayment")),
    p_buyer_name: optionalString(formData.get("buyerName")),
    p_phone: optionalString(formData.get("phone")),
    p_email: optionalString(formData.get("email")),
    p_address: optionalString(formData.get("address")),
    p_notes: optionalString(formData.get("notes")),
  });
  if (error) throw error;
  return String(data);
}

export async function voidVehicleSale(client: Client, organizationId: string, saleId: string, reason: string) {
  const { error } = await client.rpc("void_vehicle_sale_atomic", {
    p_organization_id: organizationId,
    p_sale_id: saleId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function correctVehicleSale(client: Client, organizationId: string, saleId: string, formData: FormData) {
  const { data, error } = await client.rpc("correct_vehicle_sale_atomic", {
    p_organization_id: organizationId,
    p_sale_id: saleId,
    p_sale_date: stringValue(formData.get("saleDate")) || today(),
    p_taxable_profit_amount: numberValue(formData.get("taxableProfitAmount")),
    p_real_client_payment: numberValue(formData.get("realClientPayment")),
    p_buyer_name: optionalString(formData.get("buyerName")),
    p_phone: optionalString(formData.get("phone")),
    p_email: optionalString(formData.get("email")),
    p_address: optionalString(formData.get("address")),
    p_notes: optionalString(formData.get("notes")),
    p_reason: stringValue(formData.get("reason")),
  });
  if (error) throw error;
  return String(data);
}

export async function createCashTransaction(
  client: Client,
  organizationId: string,
  type: CompanyCashTransaction["type"] | ExternalCashTransaction["type"],
  amount: number,
  note: string,
  date = today(),
) {
  if (type === "external_transfer_received" || type === "external_transfer_returned") {
    throw new Error("This cash transaction type is system-generated.");
  }

  if (type === "external_cash_transferred_to_company") {
    const { error } = await client.rpc("transfer_external_cash_to_company", {
      p_organization_id: organizationId,
      p_amount: amount,
      p_date: date || today(),
      p_note: note || null,
    });
    if (error) throw error;
    return;
  }

  if (!MANUAL_CASH_TRANSACTION_TYPES.includes(type as typeof MANUAL_CASH_TRANSACTION_TYPES[number])) {
    throw new Error("This cash transaction type is system-generated and cannot be entered manually.");
  }

  const user = await requireUser(client);
  const table = type.startsWith("external_") ? "external_cash_transactions" : "company_cash_transactions";
  const { error } = await client.from(table).insert({
    organization_id: organizationId,
    type,
    amount,
    date,
    note,
    created_by: user.id,
  });
  if (error) throw error;
  await logActivity(client, organizationId, actionForCashType(type), "cash_transaction", undefined, note);
}

export async function updateCashTransaction(
  client: Client,
  organizationId: string,
  account: "company" | "external",
  transactionId: string,
  formData: FormData,
) {
  if (account !== "company" && account !== "external") throw new Error("Cash account is invalid.");
  const table = account === "company" ? "company_cash_transactions" : "external_cash_transactions";
  const { data: current, error: readError } = await client
    .from(table)
    .select("transfer_pair_id,source_vehicle_id,source_expense_id,source_sale_id,correction_of_transaction_id,reversed_transaction_id,voided_at,deleted_at")
    .eq("id", transactionId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current || current.deleted_at) throw new Error("Cash transaction not found.");
  if (String(current.transfer_pair_id ?? "").trim()) {
    throw new Error("Paired external transfers cannot be edited directly. Reverse the transfer and create a new one.");
  }
  if (current.source_vehicle_id || current.source_expense_id || current.source_sale_id) {
    throw new Error("System-generated cash transactions cannot be edited.");
  }
  if (current.correction_of_transaction_id || current.reversed_transaction_id || current.voided_at) {
    throw new Error("Reversal entries cannot be edited.");
  }

  const amount = numberValue(formData.get("amount"));
  const date = stringValue(formData.get("date")) || today();
  const note = optionalString(formData.get("note"));
  const rpcName = account === "company"
    ? "update_manual_company_cash_transaction"
    : "update_manual_external_cash_transaction";
  const { error } = await client.rpc(rpcName, {
    p_organization_id: organizationId,
    p_transaction_id: transactionId,
    p_amount: amount,
    p_date: date,
    p_note: note,
  });
  if (error) throw error;
}

export async function deleteCashTransaction(
  client: Client,
  organizationId: string,
  account: "company" | "external",
  transactionId: string,
  reason: string,
) {
  if (account !== "company" && account !== "external") throw new Error("Cash account is invalid.");
  const table = account === "company" ? "company_cash_transactions" : "external_cash_transactions";
  const { data: transaction, error: readError } = await client
    .from(table)
    .select("id,type,transfer_pair_id,source_vehicle_id,source_expense_id,source_sale_id,correction_of_transaction_id,reversed_transaction_id,voided_at,deleted_at")
    .eq("id", transactionId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (readError) throw readError;
  if (!transaction || transaction.deleted_at) throw new Error("Cash transaction not found.");

  if (transaction.source_vehicle_id || transaction.source_expense_id || transaction.source_sale_id) {
    throw new Error("System-generated cash transactions must be corrected through the vehicle or sale workflow.");
  }

  const transferPairId = String(transaction.transfer_pair_id ?? "").trim();
  const correctionOfTransactionId = String(transaction.correction_of_transaction_id ?? "").trim();
  if (transferPairId && correctionOfTransactionId) {
    throw new Error("Transfer reversal entries cannot be reversed directly.");
  }

  if (transferPairId && (
    (account === "external" && transaction.type === "external_cash_transferred_to_company") ||
    (account === "company" && transaction.type === "external_transfer_received")
  )) {
    const { error } = await client.rpc("reverse_external_cash_transfer_pair", {
      p_organization_id: organizationId,
      p_transfer_pair_id: transferPairId,
      p_reason: reason || "Reversed from cash management",
    });
    if (error) throw error;
    return;
  }

  if (transferPairId) {
    throw new Error("Paired cash transfers must be reversed as a complete transfer.");
  }

  const rpcName = account === "company"
    ? "reverse_company_cash_transaction"
    : "reverse_external_cash_transaction";
  const { error } = await client.rpc(rpcName, {
    p_organization_id: organizationId,
    p_transaction_id: transactionId,
    p_reason: reason || "Reversed from cash management",
  });
  if (error) throw error;
}

export async function createContact(client: Client, organizationId: string, formData: FormData) {
  const user = await requireUser(client);
  const { error } = await client.from("contacts").insert({
    organization_id: organizationId,
    type: (stringValue(formData.get("type")) || "other") as ContactType,
    custom_type_description: optionalString(formData.get("customTypeDescription")),
    full_name: stringValue(formData.get("fullName")),
    phone: stringValue(formData.get("phone")),
    email: optionalString(formData.get("email")),
    address: optionalString(formData.get("address")),
    notes: optionalString(formData.get("notes")),
    desired_vehicle_types: optionalString(formData.get("desiredVehicleTypes")),
    budget_min: optionalNumber(formData.get("budgetMin")),
    budget_max: optionalNumber(formData.get("budgetMax")),
    commission_agreement: optionalString(formData.get("commissionAgreement")),
    location: optionalString(formData.get("location")),
    follow_up_notes: optionalString(formData.get("followUpNotes")),
    last_contacted_date: optionalString(formData.get("lastContactedDate")),
    export_region: optionalString(formData.get("exportRegion")),
    export_shipping_notes: optionalString(formData.get("exportShippingNotes")),
    preferred_communication_method: optionalString(formData.get("preferredCommunicationMethod")),
    created_by: user.id,
  });
  if (error) throw error;
  await logActivity(client, organizationId, "contact_created", "contact", undefined, stringValue(formData.get("fullName")));
}

export async function createAttachment(client: Client, organizationId: string, formData: FormData, relation: Record<string, string | undefined>) {
  const user = await requireUser(client);
  const file = formData.get("file");
  const link = optionalString(formData.get("urlOrPath"));
  const title = stringValue(formData.get("title"));
  let path = link ?? "";
  let type = (stringValue(formData.get("type")) || "link") as AttachmentType;

  if (file instanceof File && file.size > 0) {
    assertAllowedUpload(file);
    type = file.type.startsWith("image/") ? "photo" : "file";
    path = `organizations/${organizationId}/${crypto.randomUUID()}-${sanitizeStorageFileName(file.name)}`;
    const { error: uploadError } = await client.storage.from("dealer-flow-private").upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;
  }
  if (!path) {
    throw new Error("A file or valid link is required.");
  }

  const { error } = await client.from("attachments").insert({
    organization_id: organizationId,
    type,
    title,
    url_or_path: path,
    notes: optionalString(formData.get("notes")),
    is_sensitive: formData.get("isSensitive") === "on",
    vehicle_id: relation.vehicleId,
    expense_id: relation.expenseId,
    sale_id: relation.saleId,
    contact_id: relation.contactId,
    company_cash_transaction_id: relation.companyCashTransactionId,
    external_cash_transaction_id: relation.externalCashTransactionId,
    created_by: user.id,
  });
  if (error) throw error;
  await logActivity(
    client,
    organizationId,
    formData.get("isSensitive") === "on" ? "sensitive_document_uploaded" : "document_uploaded",
    "attachment",
    undefined,
    formData.get("isSensitive") === "on" ? "Sensitive document uploaded" : title,
  );
}

async function ensureProfile(client: Client, user: User) {
  const { error } = await client.from("profiles").upsert({
    id: user.id,
    full_name: user.user_metadata?.full_name ?? user.email,
  });
  if (error) throw error;
}

async function requireUser(client: Client) {
  const user = await getCurrentUser(client);
  if (!user) throw new Error("You must be signed in.");
  await ensureProfile(client, user);
  return user;
}

async function logActivity(client: Client, organizationId: string, action: string, entityType: string, entityId: string | undefined, message: string) {
  const user = await requireUser(client);
  const { error } = await client.from("activity_logs").insert({
    organization_id: organizationId,
    action,
    entity_type: entityType,
    entity_id: entityId ?? null,
    message,
    created_by: user.id,
  });
  if (error) throw error;
}

async function selectRows(client: Client, table: string, columns = "*") {
  const { data, error } = await client.from(table).select(columns).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Record<string, unknown>[];
}

async function selectOrgRows(client: Client, table: string, organizationId: string) {
  let query = client
    .from(table)
    .select("*")
    .eq("organization_id", organizationId);
  query =
    table === "vehicle_expenses" || table.includes("cash_transactions")
      ? query.order("date", { ascending: false })
      : query.order("created_at", { ascending: false });
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as Record<string, unknown>[];
}

function actionForCashType(type: string) {
  if (type === "company_cash_added") return "cash_added";
  if (type === "company_cash_withdrawn") return "cash_withdrawn";
  if (type === "external_cash_added") return "external_cash_added";
  if (type === "external_cash_transferred_to_company") return "external_cash_transferred";
  if (type === "external_cash_personally_removed") return "external_cash_personally_spent";
  return "cash_transaction_created";
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function stringValue(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function optionalString(value: FormDataEntryValue | null) {
  const text = stringValue(value);
  return text || null;
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = stringValue(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function numberValue(value: FormDataEntryValue | null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
