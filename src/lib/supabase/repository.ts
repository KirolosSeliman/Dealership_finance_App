import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  calculateExpenseTax,
  calculateSaleBreakdown,
  calculateVehicleTotalCost,
} from "@/lib/domain/calculations";
import { DEFAULT_PLATE_COMMISSION_AMOUNT, OPENLANE_PURCHASE_TAX_RATE } from "@/lib/domain/constants";
import { assertAllowedUpload, sanitizeStorageFileName } from "@/lib/security";
import { emptyAppData, mapActivityLog, mapAttachment, mapCompanyCashTransaction, mapContact, mapExpense, mapExternalCashTransaction, mapMembership, mapOrganization, mapSale, mapVehicle } from "@/lib/supabase/mappers";
import type {
  AppData,
  Attachment,
  AttachmentType,
  CompanyCashTransaction,
  ContactType,
  ExpenseCategory,
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
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(client: Client, email: string, password: string, fullName: string) {
  const { error } = await client.auth.signUp({
    email,
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
  const memberships = await selectRows(client, "organization_memberships", "organization_id, role, organizations(id, name, default_plate_commission_amount)");
  const invitationRows = await selectRows(client, "organization_invitations", "organization_id, access_code");
  const organizations = memberships.map((row) => {
    const organization = mapOrganization(row);
    organization.inviteCode = String(
      invitationRows.find((invite) => invite.organization_id === organization.id)?.access_code ?? "",
    );
    return organization;
  });

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
    activityLogs,
  ] = await Promise.all([
    selectOrgRows(client, "vehicles", organizationId),
    selectOrgRows(client, "vehicle_expenses", organizationId),
    selectOrgRows(client, "sales", organizationId),
    selectOrgRows(client, "contacts", organizationId),
    selectOrgRows(client, "attachments", organizationId),
    selectOrgRows(client, "company_cash_transactions", organizationId),
    selectOrgRows(client, "external_cash_transactions", organizationId),
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
    sales: sales.map(mapSale),
    contacts: contacts.map(mapContact),
    attachments: mappedAttachments,
    companyCashTransactions: companyCashTransactions.map(mapCompanyCashTransaction),
    externalCashTransactions: externalCashTransactions.map(mapExternalCashTransaction),
    activityLogs: activityLogs.map(mapActivityLog),
  };
}

export async function createOrganization(client: Client, name: string) {
  const { error } = await client.rpc("create_organization_with_owner", { organization_name: name });
  if (error) throw error;
}

export async function joinOrganization(client: Client, accessCode: string) {
  const { error } = await client.rpc("join_organization_by_access_code", { invitation_code: accessCode });
  if (error) throw error;
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

export async function updateDefaultPlateCommission(client: Client, organizationId: string, amount: number) {
  const { error } = await client.from("organizations").update({
    default_plate_commission_amount: amount,
    updated_at: new Date().toISOString(),
  }).eq("id", organizationId);
  if (error) throw error;
  await logActivity(client, organizationId, "organization_settings_updated", "organization", organizationId, `Commission Plaque set to ${amount}`);
}

export async function createVehicle(client: Client, organizationId: string, formData: FormData) {
  const user = await requireUser(client);
  const defaultPlateCommissionAmount = await getDefaultPlateCommissionAmount(client, organizationId);
  const payload = {
    organization_id: organizationId,
    vin: stringValue(formData.get("vin")).toUpperCase(),
    year: optionalNumber(formData.get("year")),
    make: optionalString(formData.get("make")),
    model: optionalString(formData.get("model")),
    trim: optionalString(formData.get("trim")),
    color: optionalString(formData.get("color")),
    mileage: optionalNumber(formData.get("mileage")),
    purchase_price: numberValue(formData.get("purchasePrice")),
    purchase_date: stringValue(formData.get("purchaseDate")) || today(),
    purchase_source: (stringValue(formData.get("purchaseSource")) || "other") as PurchaseSource,
    status: (stringValue(formData.get("status")) || "purchased") as VehicleStatus,
    listed_price: optionalNumber(formData.get("listedPrice")),
    notes: optionalString(formData.get("notes")),
    created_by: user.id,
  };
  const { data, error } = await client.from("vehicles").insert(payload).select("*").single();
  if (error) throw error;
  if (payload.purchase_price > 0) {
    const purchaseTaxAmount = roundMoney(payload.purchase_price * OPENLANE_PURCHASE_TAX_RATE);
    const { error: purchaseTaxError } = await client.from("vehicle_expenses").insert({
      organization_id: organizationId,
      vehicle_id: data.id,
      category: "vehicle_purchase_price" satisfies ExpenseCategory,
      amount_before_tax: payload.purchase_price,
      tax_rate: OPENLANE_PURCHASE_TAX_RATE,
      tax_amount: purchaseTaxAmount,
      total_amount: roundMoney(payload.purchase_price + purchaseTaxAmount),
      date: payload.purchase_date,
      note: "Automatic 5% purchase tax",
      created_by: user.id,
    });
    if (purchaseTaxError) throw purchaseTaxError;
  }
  if (defaultPlateCommissionAmount > 0) {
    const { error: commissionError } = await client.from("vehicle_expenses").insert({
      organization_id: organizationId,
      vehicle_id: data.id,
      category: "commission_plaque" satisfies ExpenseCategory,
      amount_before_tax: defaultPlateCommissionAmount,
      tax_rate: 0,
      tax_amount: 0,
      total_amount: defaultPlateCommissionAmount,
      date: payload.purchase_date,
      note: "Automatic non-taxable Commission Plaque fee",
      created_by: user.id,
    });
    if (commissionError) throw commissionError;
  }
  await logActivity(client, organizationId, "vehicle_created", "vehicle", data.id, `${payload.make ?? "Vehicle"} ${payload.model ?? ""}`);
  if (payload.purchase_price > 0) {
    await logActivity(client, organizationId, "expense_added", "vehicle", data.id, "Automatic 5% purchase tax");
  }
  if (defaultPlateCommissionAmount > 0) {
    await logActivity(client, organizationId, "expense_added", "vehicle", data.id, "Automatic Commission Plaque fee");
  }
  return String(data.id);
}

export async function updateVehicle(client: Client, vehicle: Vehicle, formData: FormData) {
  const payload = {
    vin: stringValue(formData.get("vin")).toUpperCase(),
    year: optionalNumber(formData.get("year")),
    make: optionalString(formData.get("make")),
    model: optionalString(formData.get("model")),
    trim: optionalString(formData.get("trim")),
    color: optionalString(formData.get("color")),
    mileage: optionalNumber(formData.get("mileage")),
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

export async function createExpense(client: Client, vehicle: Vehicle, formData: FormData) {
  const user = await requireUser(client);
  const amountBeforeTax = numberValue(formData.get("amountBeforeTax"));
  const category = stringValue(formData.get("category")) as ExpenseCategory;
  const tax = calculateExpenseTax({
    purchaseSource: vehicle.purchaseSource,
    category,
    amountBeforeTax,
    addFifteenPercentTax: formData.get("addTax") === "on",
  });
  const { data, error } = await client.from("vehicle_expenses").insert({
    organization_id: vehicle.organizationId,
    vehicle_id: vehicle.id,
    category,
    amount_before_tax: amountBeforeTax,
    tax_rate: tax.taxRate,
    tax_amount: tax.taxAmount,
    total_amount: tax.totalAmount,
    date: stringValue(formData.get("date")) || today(),
    note: optionalString(formData.get("note")),
    created_by: user.id,
  }).select("*").single();
  if (error) throw error;
  await logActivity(client, vehicle.organizationId, "expense_added", "vehicle", vehicle.id, category);
  return String(data.id);
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
  const { error } = await client.from("vehicle_expenses").update({
    category,
    amount_before_tax: amountBeforeTax,
    tax_rate: tax.taxRate,
    tax_amount: tax.taxAmount,
    total_amount: tax.totalAmount,
    date: stringValue(formData.get("date")) || today(),
    note: optionalString(formData.get("note")),
    updated_at: new Date().toISOString(),
  }).eq("id", expenseId).eq("vehicle_id", vehicle.id);
  if (error) throw error;
  await logActivity(client, vehicle.organizationId, "expense_updated", "vehicle", vehicle.id, category);
}

export async function deleteExpense(client: Client, vehicle: Vehicle, expenseId: string) {
  const { error } = await client.rpc("delete_vehicle_expense", { expense_id: expenseId });
  if (error) throw error;
}

export async function recordVehicleSale(client: Client, appData: AppData, vehicle: Vehicle, formData: FormData) {
  const user = await requireUser(client);
  const vehicleTotalCost = calculateVehicleTotalCost(vehicle, appData.expenses);
  const taxableProfitAmount = numberValue(formData.get("taxableProfitAmount"));
  const realClientPayment = numberValue(formData.get("realClientPayment"));
  const breakdown = calculateSaleBreakdown({ vehicleTotalCost, taxableProfitAmount, realClientPayment });
  if (breakdown.externalCommission < 0) {
    throw new Error("Real client payment cannot be lower than the paper sale price.");
  }
  const saleDate = stringValue(formData.get("saleDate")) || today();
  const buyerName = stringValue(formData.get("buyerName"));
  let contactId: string | null = null;

  if (buyerName) {
    const { data: contact, error: contactError } = await client.from("contacts").insert({
      organization_id: vehicle.organizationId,
      type: "buyer" satisfies ContactType,
      full_name: buyerName,
      phone: stringValue(formData.get("phone")),
      email: optionalString(formData.get("email")),
      address: optionalString(formData.get("address")),
      notes: optionalString(formData.get("notes")),
      created_by: user.id,
    }).select("id").single();
    if (contactError) throw contactError;
    contactId = String(contact.id);
    await logActivity(client, vehicle.organizationId, "contact_created", "contact", contactId, buyerName);
  }

  const { data: sale, error: saleError } = await client.from("sales").insert({
    organization_id: vehicle.organizationId,
    vehicle_id: vehicle.id,
    contact_id: contactId,
    sale_date: saleDate,
    vehicle_total_cost: vehicleTotalCost,
    taxable_profit_amount: taxableProfitAmount,
    profit_tax_due: breakdown.profitTaxDue,
    paper_sale_price: breakdown.paperSalePrice,
    real_client_payment: realClientPayment,
    external_commission: breakdown.externalCommission,
    notes: optionalString(formData.get("notes")),
    created_by: user.id,
  }).select("id").single();
  if (saleError) throw saleError;

  const { error: updateError } = await client.from("vehicles").update({
    status: "sold",
    updated_at: new Date().toISOString(),
  }).eq("id", vehicle.id);
  if (updateError) throw updateError;

  await client.from("company_cash_transactions").insert({
    organization_id: vehicle.organizationId,
    type: "paper_sale_received",
    amount: breakdown.paperSalePrice,
    date: saleDate,
    note: "Paper sale received",
    source_vehicle_id: vehicle.id,
    created_by: user.id,
  });
  await client.from("external_cash_transactions").insert({
    organization_id: vehicle.organizationId,
    type: "external_commission_earned",
    amount: breakdown.externalCommission,
    date: saleDate,
    note: "External commission earned",
    source_vehicle_id: vehicle.id,
    created_by: user.id,
  });
  await logActivity(client, vehicle.organizationId, "vehicle_sold", "vehicle", vehicle.id, `Sale recorded for ${buyerName || "buyer"}`);
  await logActivity(client, vehicle.organizationId, "cash_transaction_created", "vehicle", vehicle.id, "Sale cash transactions generated");
  return String(sale.id);
}

export async function createCashTransaction(
  client: Client,
  organizationId: string,
  type: CompanyCashTransaction["type"] | ExternalCashTransaction["type"],
  amount: number,
  note: string,
  date = today(),
) {
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
  const table = account === "company" ? "company_cash_transactions" : "external_cash_transactions";
  const amount = numberValue(formData.get("amount"));
  const date = stringValue(formData.get("date")) || today();
  const note = optionalString(formData.get("note"));
  const { error } = await client.from(table).update({
    amount,
    date,
    note,
    updated_at: new Date().toISOString(),
  }).eq("id", transactionId).eq("organization_id", organizationId).is("deleted_at", null);
  if (error) throw error;
  await logActivity(client, organizationId, "cash_transaction_updated", "cash_transaction", transactionId, note ?? "Cash transaction updated");
}

export async function deleteCashTransaction(
  client: Client,
  organizationId: string,
  account: "company" | "external",
  transactionId: string,
  reason: string,
) {
  const user = await requireUser(client);
  const table = account === "company" ? "company_cash_transactions" : "external_cash_transactions";
  const { data: transaction, error: readError } = await client
    .from(table)
    .select("amount, type, date, note")
    .eq("id", transactionId)
    .eq("organization_id", organizationId)
    .single();
  if (readError) throw readError;

  const { error } = await client.from(table).update({
    deleted_at: new Date().toISOString(),
    deleted_by: user.id,
    deletion_note: reason || "Deleted from cash management",
    updated_at: new Date().toISOString(),
  }).eq("id", transactionId).eq("organization_id", organizationId);
  if (error) throw error;

  await logActivity(
    client,
    organizationId,
    "cash_transaction_deleted",
    "cash_transaction",
    transactionId,
    `Deleted ${formatCashMessage(transaction)}. Reason: ${reason || "No reason provided"}`,
  );
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
  await logActivity(client, organizationId, "document_uploaded", "attachment", undefined, title);
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

async function getDefaultPlateCommissionAmount(client: Client, organizationId: string) {
  const { data, error } = await client
    .from("organizations")
    .select("default_plate_commission_amount")
    .eq("id", organizationId)
    .single();
  if (error) throw error;
  if (data?.default_plate_commission_amount === null || data?.default_plate_commission_amount === undefined) {
    return DEFAULT_PLATE_COMMISSION_AMOUNT;
  }
  return Math.max(0, numberValue(data.default_plate_commission_amount));
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
  if (type === "external_cash_transferred_to_company") return "external_cash_transferred";
  if (type === "external_cash_personally_removed") return "external_cash_personally_spent";
  return "cash_transaction_created";
}

function formatCashMessage(transaction: { amount?: unknown; type?: unknown; date?: unknown; note?: unknown } | null) {
  if (!transaction) return "cash transaction";
  const amount = numberValue(String(transaction.amount ?? "0"));
  return `${String(transaction.type ?? "cash transaction")} for ${amount} on ${String(transaction.date ?? "")}${transaction.note ? ` (${String(transaction.note)})` : ""}`;
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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
