"use client";

import {
  Activity,
  Archive,
  Banknote,
  BarChart3,
  Building2,
  Car,
  ChevronLeft,
  Contact,
  Download,
  FolderLock,
  Languages,
  LineChart,
  Lock,
  Menu,
  Plus,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  Users,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TAX_DISCLAIMER } from "@/lib/domain/constants";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_FUNDING_SOURCES,
  EXPENSE_TAX_BEHAVIORS,
  getAllowedVehicleStatusTransitions,
  PURCHASE_SOURCES,
  ROLES,
  VEHICLE_STATUSES,
} from "@/lib/domain/constants";
import {
  calculateDashboardMetrics,
  calculateSaleBreakdown,
  calculateVehicleTotalCost,
  calculateCompanyCashBalance,
  calculateExternalCashBalance,
  daysBetween,
  generateTaxReport,
  isActiveSale,
} from "@/lib/domain/calculations";
import { verifyBackupExport } from "@/lib/backup/export";
import { serverMutation } from "@/features/app/mutations";
import { getRouteState, pathForView, type VehicleMode, type VehicleTab, type View } from "@/features/app/navigation";
import { getPermissions, type Permissions } from "@/features/app/permissions";
import { getDictionary } from "@/lib/i18n";
import { runComparableEstimator, shouldRefreshVehicle } from "@/lib/market-snap/engine";
import { activeVehiclesOnly, isValidVehicleDeleteConfirmation } from "@/lib/vehicle-delete";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { emptyAppData } from "@/lib/supabase/mappers";
import {
  getCurrentUser,
  isSupabaseConfigured,
  loadAppData,
  saveLanguagePreference,
  signIn,
  signOut,
  signUp,
} from "@/lib/supabase/repository";
import type {
  AppData,
  Attachment,
  CompanyCashTransaction,
  Contact as ContactRecord,
  ExternalCashTransaction,
  Language,
  RecurringVehicleExpenseTemplate,
  Sale,
  Vehicle,
  VehicleExpense,
  VehicleStatus,
} from "@/types/domain";

type CashAccount = "company" | "external";
type CashTransaction = CompanyCashTransaction | ExternalCashTransaction;
type VehiclePrefill = Partial<Pick<Vehicle, "year" | "make" | "model" | "trim" | "mileage" | "purchasePrice" | "purchaseSource" | "notes">>;

const languageKey = "dealer-flow-language";

const mainNav: Array<[View, React.ReactNode]> = [
  ["dashboard", <BarChart3 key="dashboard" size={18} />],
  ["vehicles", <Car key="vehicles" size={18} />],
  ["marketSnap", <Activity key="marketSnap" size={18} />],
  ["dealRadar", <Search key="dealRadar" size={18} />],
  ["marketData", <FolderLock key="marketData" size={18} />],
  ["cash", <LineChart key="cash" size={18} />],
  ["contacts", <Contact key="contacts" size={18} />],
  ["taxes", <Archive key="taxes" size={18} />],
  ["backups", <Download key="backups" size={18} />],
  ["settings", <Settings key="settings" size={18} />],
];

const vehicleTabs: Array<[VehicleTab, string]> = [
  ["overview", "overview"],
  ["details", "details"],
  ["expenses", "expenses"],
  ["documents", "documents"],
  ["sale", "sale"],
  ["timeline", "timeline"],
];

export function DealerFlowApp() {
  const [hydrated, setHydrated] = useState(false);
  const [language, setLanguage] = useState<Language>("en");
  const [data, setData] = useState<AppData>(emptyAppData);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [vehicleMode, setVehicleMode] = useState<VehicleMode>("list");
  const [selectedVehicleId, setSelectedVehicleId] = useState("veh_1");
  const [selectedVehicleTab, setSelectedVehicleTab] = useState<VehicleTab>("overview");
  const [inventoryMode, setInventoryMode] = useState<"cards" | "table">("cards");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<VehicleStatus | "all">("all");
  const [dateRange, setDateRange] = useState({ start: "2026-01-01", end: "2026-12-31" });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [vehiclePrefill, setVehiclePrefill] = useState<VehiclePrefill | undefined>();
  const t = getDictionary(language);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const applyRouteState = useCallback((pathname: string, searchParams: string) => {
    const route = getRouteState(pathname, searchParams);
    setView(route.view);
    setVehicleMode(route.mode);
    if (route.vehicleId) setSelectedVehicleId(route.vehicleId);
    if (route.tab) setSelectedVehicleTab(route.tab);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const storedLanguage = window.localStorage.getItem(languageKey);
      if (storedLanguage === "fr") setLanguage("fr");
      applyRouteState(window.location.pathname, window.location.search);
      setHydrated(true);
    }, 0);
    const onPopState = () => applyRouteState(window.location.pathname, window.location.search);
    window.addEventListener("popstate", onPopState);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("popstate", onPopState);
    };
  }, [applyRouteState]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(languageKey, language);
    if (supabase && data.userId) {
      saveLanguagePreference(supabase, language, data.activeOrganizationId).catch((error: unknown) =>
        setErrorMessage(error instanceof Error ? error.message : "Could not save language preference."),
      );
    }
  }, [data.activeOrganizationId, data.userId, hydrated, language, supabase]);

  const refreshData = useCallback(async (activeOrganizationId?: string) => {
    if (!supabase) return;
    setLoading(true);
    setErrorMessage("");
    try {
      const user = await getCurrentUser(supabase);
      if (!user) {
        setData(emptyAppData);
        return;
      }
      const nextData = await loadAppData(supabase, user, activeOrganizationId);
      setData(nextData);
      setSelectedVehicleId((currentVehicleId) => {
        if (nextData.vehicles.some((vehicle) => vehicle.id === currentVehicleId)) return currentVehicleId;
        return nextData.vehicles[0]?.id ?? currentVehicleId;
      });
      if (nextData.activeOrganizationId) {
        await saveLanguagePreference(supabase, language, nextData.activeOrganizationId);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load Dealer Flow data.");
    } finally {
      setLoading(false);
    }
  }, [language, supabase]);

  useEffect(() => {
    if (!hydrated || !supabase) {
      const timeout = window.setTimeout(() => setLoading(false), 0);
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(() => refreshData(), 0);
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      refreshData();
    });
    return () => {
      window.clearTimeout(timeout);
      listener.subscription.unsubscribe();
    };
  }, [hydrated, refreshData, supabase]);

  const activeOrganization =
    data.organizations.find((organization) => organization.id === data.activeOrganizationId) ??
    data.organizations[0];
  const scoped = useMemo(
    () => (activeOrganization ? scopeData(data, activeOrganization.id) : data),
    [data, activeOrganization],
  );
  const permissions = getPermissions(activeOrganization?.role);
  const metrics = useMemo(() => calculateDashboardMetrics(scoped), [scoped]);
  const activeVehicles = activeVehiclesOnly(scoped.vehicles);
  const selectedVehicle =
    activeVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? activeVehicles[0];
  const filteredVehicles = activeVehicles.filter((vehicle) => {
    const haystack = [vehicle.vin, vehicle.make, vehicle.model, vehicle.year, vehicle.notes]
      .join(" ")
      .toLowerCase();
    return (
      haystack.includes(search.toLowerCase()) &&
      (statusFilter === "all" || vehicle.status === statusFilter)
    );
  });

  function navigate(nextView: View, options?: { mode?: VehicleMode; vehicleId?: string; tab?: VehicleTab }) {
    setView(nextView);
    setMobileNavOpen(false);
    if (nextView === "vehicles") {
      const mode = options?.mode ?? "list";
      setVehicleMode(mode);
      if (options?.vehicleId) setSelectedVehicleId(options.vehicleId);
      if (options?.tab) setSelectedVehicleTab(options.tab);
      const path =
        mode === "new"
          ? "/vehicles/new"
          : mode === "detail" && options?.vehicleId
            ? `/vehicles/${options.vehicleId}?tab=${options.tab ?? selectedVehicleTab}`
            : "/vehicles";
      window.history.pushState(null, "", path);
      return;
    }
    setVehicleMode("list");
    window.history.pushState(null, "", pathForView(nextView));
  }

  async function handleAuth(formData: FormData) {
    if (!supabase) return;
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const email = String(formData.get("email") || "").trim().toLowerCase();
      const password = String(formData.get("password") || "");
      const fullName = String(formData.get("fullName") || "");
      if (authMode === "signup") {
        await signUp(supabase, email, password, fullName);
        setStatusMessage("Account created. If email confirmation is enabled, confirm your email before logging in.");
      } else {
        await signIn(supabase, email, password);
      }
      await refreshData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  async function createOrganization(formData: FormData) {
    if (!supabase) return;
    const name = String(formData.get("organizationName") || "").trim();
    if (!name) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("createOrganization", formData);
      await refreshData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create organization.");
    } finally {
      setLoading(false);
    }
  }

  async function joinOrganization(formData: FormData) {
    if (!supabase) return;
    const code = String(formData.get("inviteCode") || "").trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("joinOrganization", formData);
      await refreshData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not join organization.");
    } finally {
      setLoading(false);
    }
  }

  async function switchOrganization(organizationId: string) {
    if (!supabase) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await saveLanguagePreference(supabase, language, organizationId);
      await refreshData(organizationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not switch organization.");
    } finally {
      setLoading(false);
    }
  }

  async function createRecurringExpenseTemplate(formData: FormData) {
    if (!activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("createRecurringExpenseTemplate", cloneFormData(formData, { organizationId: activeOrganization.id }));
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create recurring expense template.");
    } finally {
      setLoading(false);
    }
  }

  async function updateRecurringExpenseTemplate(formData: FormData) {
    if (!activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("updateRecurringExpenseTemplate", cloneFormData(formData, { organizationId: activeOrganization.id }));
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update recurring expense template.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteRecurringExpenseTemplate(templateId: string) {
    if (!activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("deleteRecurringExpenseTemplate", newMutationForm({ organizationId: activeOrganization.id, templateId }));
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not deactivate recurring expense template.");
    } finally {
      setLoading(false);
    }
  }

  async function updateMemberRole(formData: FormData) {
    if (!activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("updateMemberRole", cloneFormData(formData, { organizationId: activeOrganization.id }));
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update member role.");
    } finally {
      setLoading(false);
    }
  }

  async function removeMember(membershipId: string) {
    if (!activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("removeMember", newMutationForm({ organizationId: activeOrganization.id, membershipId }));
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not remove member.");
    } finally {
      setLoading(false);
    }
  }

  async function regenerateInvitationCode() {
    if (!activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const result = await serverMutation("regenerateInvitationCode", newMutationForm({ organizationId: activeOrganization.id }));
      setStatusMessage(`Invitation code regenerated: ${String(result.inviteCode ?? "")}`);
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not regenerate invitation code.");
    } finally {
      setLoading(false);
    }
  }

  async function addVehicle(formData: FormData) {
    if (!supabase || !activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await serverMutation("createVehicle", cloneFormData(formData, { organizationId: activeOrganization.id }));
      const id = String(response.id ?? "");
      setVehiclePrefill(undefined);
      await refreshData(activeOrganization.id);
      setSelectedVehicleId(id);
      setSelectedVehicleTab("overview");
      navigate("vehicles", { mode: "detail", vehicleId: id, tab: "overview" });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create vehicle.");
    } finally {
      setLoading(false);
    }
  }

  async function addExpense(formData: FormData) {
    if (!supabase || !selectedVehicle) return;
    const vehicleSnapshot = selectedVehicle;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("createExpense", cloneFormData(formData, { organizationId: vehicleSnapshot.organizationId, vehicleId: vehicleSnapshot.id }));
      await refreshData(vehicleSnapshot.organizationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not add expense.");
    } finally {
      setLoading(false);
    }
  }

  async function applyRecurringExpenseTemplate(templateId: string) {
    if (!supabase || !selectedVehicle) return;
    const vehicleSnapshot = selectedVehicle;
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      if (!templateId) throw new Error("Select a template before applying it.");
      await serverMutation("applyRecurringExpenseTemplate", newMutationForm({
        organizationId: vehicleSnapshot.organizationId,
        vehicleId: vehicleSnapshot.id,
        templateId,
      }));
      await refreshData(vehicleSnapshot.organizationId);
      setSelectedVehicleId(vehicleSnapshot.id);
      setSelectedVehicleTab("expenses");
      setStatusMessage("Template applied successfully.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not apply recurring expense template.");
    } finally {
      setLoading(false);
    }
  }

  async function editExpense(expenseId: string, formData: FormData) {
    if (!supabase || !selectedVehicle) return;
    const vehicleSnapshot = selectedVehicle;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("updateExpense", cloneFormData(formData, { organizationId: vehicleSnapshot.organizationId, vehicleId: vehicleSnapshot.id, expenseId }));
      await refreshData(vehicleSnapshot.organizationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update expense.");
    } finally {
      setLoading(false);
    }
  }

  async function removeExpense(expenseId: string) {
    if (!supabase || !selectedVehicle) return;
    const vehicleSnapshot = selectedVehicle;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("deleteExpense", newMutationForm({ organizationId: vehicleSnapshot.organizationId, vehicleId: vehicleSnapshot.id, expenseId }));
      setData((current) => ({
        ...current,
        expenses: current.expenses.filter((expense) => expense.id !== expenseId),
      }));
      await refreshData(vehicleSnapshot.organizationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not delete expense.");
    } finally {
      setLoading(false);
    }
  }

  async function recordSale(formData: FormData) {
    if (!supabase || !selectedVehicle) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("recordSale", cloneFormData(formData, { organizationId: selectedVehicle.organizationId, vehicleId: selectedVehicle.id }));
      await refreshData(selectedVehicle.organizationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not record sale.");
    } finally {
      setLoading(false);
    }
  }

  async function addCashTransaction(type: CompanyCashTransaction["type"] | ExternalCashTransaction["type"], amount: number, note: string, date?: string) {
    if (!supabase || !activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("createCashTransaction", newMutationForm({
        organizationId: activeOrganization.id,
        type,
        amount: String(amount),
        note,
        date: date || today(),
      }));
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create cash transaction.");
    } finally {
      setLoading(false);
    }
  }

  async function editCashTransaction(account: "company" | "external", transactionId: string, formData: FormData) {
    if (!supabase || !activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("updateCashTransaction", cloneFormData(formData, { organizationId: activeOrganization.id, account, transactionId }));
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update cash transaction.");
    } finally {
      setLoading(false);
    }
  }

  async function removeCashTransaction(account: "company" | "external", transactionId: string, reason: string) {
    if (!supabase || !activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("deleteCashTransaction", newMutationForm({ organizationId: activeOrganization.id, account, transactionId, reason }));
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not reverse cash transaction.");
    } finally {
      setLoading(false);
    }
  }

  async function voidSale(saleId: string, reason: string) {
    if (!supabase || !activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("voidSale", newMutationForm({ organizationId: activeOrganization.id, saleId, reason }));
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not void sale.");
    } finally {
      setLoading(false);
    }
  }

  async function correctSale(saleId: string, formData: FormData) {
    if (!supabase || !activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("correctSale", cloneFormData(formData, { organizationId: activeOrganization.id, saleId }));
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not correct sale.");
    } finally {
      setLoading(false);
    }
  }

  async function editVehicle(formData: FormData) {
    if (!supabase || !selectedVehicle) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("updateVehicle", cloneFormData(formData, { organizationId: selectedVehicle.organizationId, vehicleId: selectedVehicle.id }));
      await refreshData(selectedVehicle.organizationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update vehicle.");
    } finally {
      setLoading(false);
    }
  }

  async function removeVehicle(confirmationText: string, archiveReason: string) {
    if (!supabase || !selectedVehicle) return;
    const vehicleSnapshot = selectedVehicle;
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const result = await serverMutation("deleteVehicle", newMutationForm({
        organizationId: vehicleSnapshot.organizationId,
        vehicleId: vehicleSnapshot.id,
        confirmationText,
        archiveReason,
      })) as { warning?: string };
      navigate("vehicles", { mode: "list" });
      setStatusMessage(result.warning || "Vehicle archived. It is hidden from active inventory but preserved for financial and tax history.");
      await refreshData(vehicleSnapshot.organizationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not archive vehicle.");
    } finally {
      setLoading(false);
    }
  }

  async function addContact(formData: FormData) {
    if (!supabase || !activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("createContact", cloneFormData(formData, { organizationId: activeOrganization.id }));
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create contact.");
    } finally {
      setLoading(false);
    }
  }

  async function addAttachment(formData: FormData, relation: Record<string, string | undefined>) {
    if (!supabase || !activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("createAttachment", cloneFormData(formData, { organizationId: activeOrganization.id, ...withoutUndefined(relation) }));
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save attachment.");
    } finally {
      setLoading(false);
    }
  }

  async function setVehicleMainPhoto(attachment: Attachment) {
    if (!supabase || !selectedVehicle) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await serverMutation("setVehicleMainPhoto", newMutationForm({
        organizationId: selectedVehicle.organizationId,
        vehicleId: selectedVehicle.id,
        attachmentId: attachment.id,
      }));
      await refreshData(selectedVehicle.organizationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not set main photo.");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    if (!supabase) return;
    await signOut(supabase);
    setData(emptyAppData);
  }

  async function downloadBackup() {
    if (!activeOrganization) return;
    if (!permissions.exportBackups) {
      setStatusMessage("Owner or admin role is required to export full backups.");
      return;
    }
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const response = await fetch("/api/backups/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: activeOrganization.id }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(result?.message || "Could not generate backup.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = getDownloadFileName(response, `dealer-flow-backup-${today()}.zip`);
      anchor.click();
      URL.revokeObjectURL(url);
      setStatusMessage("Local backup generated.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not generate local backup.");
    } finally {
      setLoading(false);
    }
  }

  async function uploadR2Backup() {
    if (!activeOrganization) return;
    if (!permissions.manageBackups) {
      setStatusMessage("Owner or admin role is required to upload backups.");
      return;
    }
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const response = await fetch("/api/backups/r2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: activeOrganization.id }),
      });
      const result = (await response.json()) as { ok?: boolean; key?: string; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Cloudflare R2 backup failed.");
      setStatusMessage(`Cloudflare R2 backup uploaded: ${result.key}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not upload Cloudflare R2 backup.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyBackupFile(file: File) {
    if (!activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const result = await verifyBackupExport(file);
      if (!result.ok) {
        throw new Error(`Backup verification failed. Missing: ${result.missing.join(", ") || "none"}. Errors: ${result.errors.join(", ") || "none"}.`);
      }
      if (permissions.exportBackups) {
        await serverMutation("logActivity", newMutationForm({
          organizationId: activeOrganization.id,
          action: "backup_verified",
          entityType: "backup",
          message: "Backup ZIP verified successfully.",
        }));
      }
      setStatusMessage("Backup ZIP verified successfully.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not verify backup ZIP.");
    } finally {
      setLoading(false);
    }
  }

  async function dryRunRestore(file: File) {
    if (!activeOrganization) return;
    if (activeOrganization.role !== "owner") {
      setStatusMessage("Owner role is required to prepare a restore.");
      return;
    }
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const formData = new FormData();
      formData.set("organizationId", activeOrganization.id);
      formData.set("file", file);
      const response = await fetch("/api/backups/restore/prepare", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        ok?: boolean;
        summary?: { vehicles?: number; expenses?: number; sales?: number; contacts?: number };
        conflicts?: string[];
        message?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.message || `Restore dry-run found conflicts: ${result.conflicts?.join(", ") || "unknown conflict"}`);
      }
      setStatusMessage(`Restore dry-run OK: ${result.summary?.vehicles ?? 0} vehicles, ${result.summary?.expenses ?? 0} expenses, ${result.summary?.sales ?? 0} sales, ${result.summary?.contacts ?? 0} contacts. No data was written.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not run restore dry-run.");
    } finally {
      setLoading(false);
    }
  }

  const pageTitle =
    view === "vehicles"
      ? vehicleMode === "new"
        ? t.nav.addVehicle
        : selectedVehicle && vehicleMode === "detail"
          ? `${selectedVehicle.year ?? ""} ${selectedVehicle.make ?? ""} ${selectedVehicle.model ?? ""}`.trim()
          : t.nav.inventory
      : t.nav[view];

  if (!hydrated) {
    return <div className="min-h-screen bg-[#080d16]" />;
  }

  if (!isSupabaseConfigured() || !supabase) {
    return <SupabaseSetupScreen t={t} />;
  }

  if (!data.userId) {
    return (
      <AuthScreen
        t={t}
        authMode={authMode}
        setAuthMode={setAuthMode}
        onSubmit={handleAuth}
        loading={loading}
        errorMessage={errorMessage}
        statusMessage={statusMessage}
      />
    );
  }

  if (!activeOrganization) {
    return (
      <OnboardingScreen
        t={t}
        onCreate={createOrganization}
        onJoin={joinOrganization}
        loading={loading}
        errorMessage={errorMessage}
      />
    );
  }

  return (
    <div className="app-shell text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-slate-800/80 bg-slate-950/92 p-5 shadow-2xl shadow-black/30 xl:block">
        <Brand t={t} />
        <Navigation view={view} navigate={navigate} t={t} />
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm xl:hidden">
          <div className="h-full w-80 border-r border-slate-800 bg-slate-950 p-5">
            <div className="mb-5 flex items-center justify-between">
              <Brand t={t} compact />
              <button className="icon-button" onClick={() => setMobileNavOpen(false)} aria-label="Close menu">
                <X size={18} />
              </button>
            </div>
            <Navigation view={view} navigate={navigate} t={t} />
          </div>
        </div>
      )}

      <main className="xl:pl-72">
        <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-[#0b1120]/88 px-4 py-4 shadow-lg shadow-black/10 backdrop-blur-xl lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button className="icon-button xl:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Open menu">
                <Menu size={18} />
              </button>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  {activeOrganization.name} / {formatLabel(activeOrganization.role)}
                </p>
                <h1 className="truncate text-xl font-semibold tracking-tight text-slate-50 lg:text-2xl">{pageTitle}</h1>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <select
                className="control hidden max-w-52 md:block"
                value={activeOrganization.id}
                onChange={(event) => switchOrganization(event.target.value)}
              >
                {data.organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name} / {formatLabel(organization.role)}
                  </option>
                ))}
              </select>
              <button className="icon-button" onClick={() => setLanguage(language === "en" ? "fr" : "en")}>
                <Languages size={18} />
                <span className="hidden sm:inline">{t.actions.toggleLanguage}</span>
              </button>
              <button className="primary-button hidden sm:inline-flex" onClick={() => navigate("vehicles", { mode: "new" })}>
                <Plus size={18} />
                {t.actions.addVehicle}
              </button>
            </div>
          </div>
        </header>

        <section className="px-4 py-6 lg:px-8">
          {loading && <LoadingState message="Loading Dealer Flow data..." />}
          {statusMessage && <div className="message-banner mb-4 border border-emerald-400/20 bg-emerald-400/10 text-emerald-100">{statusMessage}</div>}
          {errorMessage && <div className="message-banner mb-4 border border-rose-400/20 bg-rose-400/10 text-rose-100">{errorMessage}</div>}
          {view === "dashboard" && (
            <Dashboard
              t={t}
              metrics={metrics}
              scoped={scoped}
              dateRange={dateRange}
              setDateRange={setDateRange}
              navigate={navigate}
              permissions={permissions}
            />
          )}
          {view === "vehicles" && (
            <VehiclesSection
              t={t}
              mode={vehicleMode}
              selectedTab={selectedVehicleTab}
              setSelectedTab={(tab) => {
                setSelectedVehicleTab(tab);
                if (selectedVehicle) navigate("vehicles", { mode: "detail", vehicleId: selectedVehicle.id, tab });
              }}
              selectedVehicle={selectedVehicle}
              vehicles={filteredVehicles}
              expenses={scoped.expenses}
              recurringExpenseTemplates={scoped.recurringExpenseTemplates}
              sales={scoped.sales}
              contacts={scoped.contacts}
              attachments={scoped.attachments}
              activityLogs={scoped.activityLogs}
              inventoryMode={inventoryMode}
              setInventoryMode={setInventoryMode}
              search={search}
              setSearch={setSearch}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              navigate={navigate}
              addVehicle={addVehicle}
              editVehicle={editVehicle}
              deleteVehicle={removeVehicle}
              addExpense={addExpense}
              applyRecurringExpenseTemplate={applyRecurringExpenseTemplate}
              editExpense={editExpense}
              deleteExpense={removeExpense}
              recordSale={recordSale}
              voidSale={voidSale}
              correctSale={correctSale}
              addAttachment={addAttachment}
              setMainPhoto={setVehicleMainPhoto}
              permissions={permissions}
              loading={loading}
              vehiclePrefill={vehiclePrefill}
            />
          )}
          {view === "marketSnap" && (
            <MarketSnapDashboard
              t={t}
              scoped={scoped}
              dateRange={dateRange}
              setDateRange={setDateRange}
              navigate={navigate}
              permissions={permissions}
            />
          )}
          {view === "dealRadar" && (
            <DealRadarPage
              t={t}
              organizationId={activeOrganization.id}
              navigate={navigate}
              permissions={permissions}
              onVehiclePrefill={setVehiclePrefill}
            />
          )}
          {view === "marketData" && (
            <MarketDataAdminPage
              t={t}
              organizationId={activeOrganization.id}
              permissions={permissions}
            />
          )}
          {view === "cash" && (
            <CashManagement
              t={t}
              metrics={metrics}
              companyTransactions={scoped.companyCashTransactions}
              externalTransactions={scoped.externalCashTransactions}
              onQuickTransaction={addCashTransaction}
              onEditTransaction={editCashTransaction}
              onDeleteTransaction={removeCashTransaction}
              permissions={permissions}
            />
          )}
          {view === "contacts" && <Contacts t={t} contacts={scoped.contacts} attachments={scoped.attachments} onSubmit={addContact} permissions={permissions} />}
          {view === "taxes" && <Taxes t={t} scoped={scoped} dateRange={dateRange} setDateRange={setDateRange} permissions={permissions} />}
          {view === "backups" && <Backups t={t} organizationId={activeOrganization.id} onDownload={downloadBackup} onUploadR2={uploadR2Backup} onVerify={verifyBackupFile} onRestoreDryRun={dryRunRestore} permissions={permissions} />}
          {view === "settings" && (
            <SettingsPage
              t={t}
              memberships={scoped.memberships}
              activeOrganization={activeOrganization}
              currentUserId={data.userId}
              onCreate={createOrganization}
              onJoin={joinOrganization}
              recurringExpenseTemplates={scoped.recurringExpenseTemplates}
              onCreateRecurringExpenseTemplate={createRecurringExpenseTemplate}
              onUpdateRecurringExpenseTemplate={updateRecurringExpenseTemplate}
              onDeleteRecurringExpenseTemplate={deleteRecurringExpenseTemplate}
              onUpdateMemberRole={updateMemberRole}
              onRemoveMember={removeMember}
              onRegenerateInvitation={regenerateInvitationCode}
              onSignOut={logout}
              permissions={permissions}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function SupabaseSetupScreen({ t }: { t: ReturnType<typeof getDictionary> }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 text-slate-100">
      <div className="panel max-w-2xl">
        <Brand t={t} compact />
        <h1 className="mt-6 text-2xl font-semibold text-white">Supabase configuration required</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Dealer Flow is now database-backed. Add `NEXT_PUBLIC_SUPABASE_URL` and
          `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `.env.local`, apply `supabase/schema.sql`,
          and create the private storage bucket `dealer-flow-private`.
        </p>
        <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/8 p-3 text-sm text-amber-100">
          Production pages require Supabase data and private organization access.
        </p>
      </div>
    </div>
  );
}

function AuthScreen({
  t,
  authMode,
  setAuthMode,
  onSubmit,
  loading,
  errorMessage,
  statusMessage,
}: {
  t: ReturnType<typeof getDictionary>;
  authMode: "login" | "signup";
  setAuthMode: (mode: "login" | "signup") => void;
  onSubmit: (formData: FormData) => void;
  loading: boolean;
  errorMessage: string;
  statusMessage: string;
}) {
  return (
    <div className="grid min-h-screen place-items-center px-4 text-slate-100">
      <form className="panel w-full max-w-md space-y-4" action={onSubmit}>
        <Brand t={t} compact />
        <div>
          <h1 className="text-2xl font-semibold text-white">{t.auth.title}</h1>
          <p className="mt-2 text-sm text-slate-400">{t.auth.copy}</p>
        </div>
        {statusMessage && <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">{statusMessage}</div>}
        {errorMessage && <div className="rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">{errorMessage}</div>}
        {authMode === "signup" && <Field label="Full name"><input className="control w-full" name="fullName" required /></Field>}
        <Field label={t.auth.email}><input className="control w-full" name="email" type="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" inputMode="email" required /></Field>
        <Field label={t.auth.password}><input className="control w-full" name="password" type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} required minLength={6} /></Field>
        <button className="primary-button w-full" type="submit" disabled={loading}>{loading ? "Loading..." : t.auth.continue}</button>
        <button className="secondary-button w-full" type="button" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
          {authMode === "login" ? "Create account" : "Use existing account"}
        </button>
      </form>
    </div>
  );
}

function OnboardingScreen({
  t,
  onCreate,
  onJoin,
  loading,
  errorMessage,
}: {
  t: ReturnType<typeof getDictionary>;
  onCreate: (formData: FormData) => void;
  onJoin: (formData: FormData) => void;
  loading: boolean;
  errorMessage: string;
}) {
  return (
    <div className="grid min-h-screen place-items-center px-4 text-slate-100">
      <div className="w-full max-w-4xl space-y-4">
        <Brand t={t} compact />
        <h1 className="text-3xl font-semibold text-white">{t.onboarding.title}</h1>
        {errorMessage && <div className="rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">{errorMessage}</div>}
        <div className="grid gap-4 lg:grid-cols-2">
          <form className="panel space-y-4" action={onCreate}>
            <h2 className="section-title">{t.onboarding.createTitle}</h2>
            <Field label={t.onboarding.orgName}><input className="control w-full" name="organizationName" required /></Field>
            <button className="primary-button" type="submit" disabled={loading}>{t.actions.createOrganization}</button>
          </form>
          <form className="panel space-y-4" action={onJoin}>
            <h2 className="section-title">{t.onboarding.joinTitle}</h2>
            <Field label={t.onboarding.inviteCode}><input className="control w-full" name="inviteCode" required /></Field>
            <button className="secondary-button" type="submit" disabled={loading}>{t.actions.joinOrganization}</button>
            <p className="text-sm text-slate-500">{t.onboarding.roleNote}</p>
          </form>
        </div>
      </div>
    </div>
  );
}

function Brand({ t, compact }: { t: ReturnType<typeof getDictionary>; compact?: boolean }) {
  return (
    <div className={compact ? "flex items-center gap-3" : "mb-8 flex items-center gap-3"}>
      <div className="grid h-10 w-10 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-400/10 text-cyan-200">
        <Car size={22} />
      </div>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-white">{t.appName}</h2>
        {!compact && <p className="mt-1 text-xs leading-5 text-slate-500">{t.tagline}</p>}
      </div>
    </div>
  );
}

function Navigation({
  view,
  navigate,
  t,
}: {
  view: View;
  navigate: (view: View, options?: { mode?: VehicleMode; vehicleId?: string; tab?: VehicleTab }) => void;
  t: ReturnType<typeof getDictionary>;
}) {
  return (
    <nav className="space-y-1">
      {mainNav.map(([item, icon]) => (
        <button key={item} className={`nav-button w-full ${view === item ? "nav-button-active" : ""}`} onClick={() => navigate(item)}>
          {icon}
          {item === "vehicles" ? t.nav.inventory : t.nav[item]}
        </button>
      ))}
    </nav>
  );
}

function Dashboard({
  t,
  metrics,
  scoped,
  dateRange,
  setDateRange,
  navigate,
  permissions,
}: {
  t: ReturnType<typeof getDictionary>;
  metrics: ReturnType<typeof calculateDashboardMetrics>;
  scoped: AppData;
  dateRange: { start: string; end: string };
  setDateRange: (range: { start: string; end: string }) => void;
  navigate: (view: View, options?: { mode?: VehicleMode; vehicleId?: string; tab?: VehicleTab }) => void;
  permissions: Permissions;
}) {
  const visibleSales = scoped.sales.filter((sale) => isActiveSale(sale) && isInDateRange(sale.saleDate, dateRange));
  const visibleExpenses = scoped.expenses.filter((expense) => isInDateRange(expense.date, dateRange));
  const activeCompanyTransactions = scoped.companyCashTransactions.filter((transaction) => !transaction.deletedAt);
  const activeExternalTransactions = scoped.externalCashTransactions.filter((transaction) => !transaction.deletedAt);
  const visibleVehicles = activeVehiclesOnly(scoped.vehicles).filter((vehicle) => isInDateRange(vehicle.purchaseDate, dateRange));
  const visibleSoldVehicles = scoped.vehicles.filter((vehicle) => {
    const sale = scoped.sales.find((item) => item.vehicleId === vehicle.id && isActiveSale(item));
    return sale ? isInDateRange(sale.saleDate, dateRange) : false;
  });
  const rangeMetrics = calculateDashboardMetrics({
    vehicles: visibleSoldVehicles,
    expenses: visibleExpenses,
    sales: visibleSales,
    companyCashTransactions: activeCompanyTransactions,
    externalCashTransactions: activeExternalTransactions,
  });
  const rangeExpenseTotal = roundDisplayNumber(
    visibleVehicles.reduce((sum, vehicle) => sum + vehicle.purchasePrice, 0) +
      visibleExpenses.reduce((sum, expense) => sum + normalizedExpenseAmount(expense), 0),
  );
  const metricCards = [
    [t.metrics.companyCash, money(metrics.companyCash), <Banknote key="a" size={18} />],
    [t.metrics.externalCash, money(metrics.externalCash), <Archive key="b" size={18} />],
    [t.metrics.netProfit, money(rangeMetrics.netProfit), <LineChart key="c" size={18} />],
    [t.metrics.totalExpenses, money(rangeExpenseTotal), <Receipt key="d" size={18} />],
    [t.metrics.vehiclesInStock, String(metrics.vehiclesInStock), <Car key="e" size={18} />],
    [t.metrics.vehiclesSold, String(visibleSoldVehicles.length), <ShieldCheck key="f" size={18} />],
    [t.metrics.inventoryValue, money(metrics.inventoryValue), <Building2 key="g" size={18} />],
    [t.metrics.averageTimeToSell, `${rangeMetrics.averageTimeToSell}`, <Activity key="h" size={18} />],
  ];
  const salesSeries = buildDailySeries(visibleSales.map((sale) => ({ date: sale.saleDate, value: sale.paperSalePrice })));
  const profitSeries = buildDailySeries(visibleSales.map((sale) => ({ date: sale.saleDate, value: sale.taxableProfitAmount - sale.profitTaxDue })));
  const expenseSeries = buildDailySeries([
    ...visibleVehicles.map((vehicle) => ({ date: vehicle.purchaseDate, value: vehicle.purchasePrice })),
    ...visibleExpenses.map((expense) => ({ date: expense.date, value: normalizedExpenseAmount(expense) })),
  ]);
  const companyCashSeries = buildBalanceSeries(activeCompanyTransactions, dateRange, calculateCompanyCashBalance);
  const externalCashSeries = buildBalanceSeries(activeExternalTransactions, dateRange, calculateExternalCashBalance);
  const inventoryValueSeries = buildDailySeries(visibleVehicles.map((vehicle) => ({
    date: vehicle.purchaseDate,
    value: calculateVehicleTotalCost(vehicle, scoped.expenses),
  })));
  const vehiclesSoldSeries = buildDailySeries(visibleSales.map((sale) => ({ date: sale.saleDate, value: 1 })));
  const lotTimeSeries = buildDailySeries(visibleSoldVehicles.map((vehicle) => {
    const sale = scoped.sales.find((item) => item.vehicleId === vehicle.id && isActiveSale(item));
    return { date: sale?.saleDate ?? vehicle.purchaseDate, value: sale ? daysBetween(vehicle.purchaseDate, sale.saleDate) : 0 };
  }));

  return (
    <div className="space-y-6">
      <div className="surface-muted flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-slate-400">{t.charts.dateRange}</p>
          <p className="text-base font-medium text-slate-100">{dateRange.start} - {dateRange.end}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className="control compact-control" type="date" value={dateRange.start} onChange={(event) => setDateRange({ ...dateRange, start: event.target.value })} />
          <input className="control compact-control" type="date" value={dateRange.end} onChange={(event) => setDateRange({ ...dateRange, end: event.target.value })} />
          {permissions.manageVehicles && (
            <button className="primary-button" onClick={() => navigate("vehicles", { mode: "new" })}>
              <Plus size={18} />
              {t.actions.addVehicle}
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(([label, value, icon]) => (
          <div key={String(label)} className="metric-card">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</span>
              <span className="text-slate-500">{icon}</span>
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight text-white">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title={t.charts.revenue} data={salesSeries} type="area" summary={money(sumSeries(salesSeries))} />
        <ChartPanel title={t.charts.profit} data={profitSeries} type="area" summary={money(sumSeries(profitSeries))} />
        <ChartPanel title={t.charts.expenses} data={expenseSeries} type="bar" summary={money(sumSeries(expenseSeries))} />
        <ChartPanel title={t.charts.companyCash} data={companyCashSeries} type="area" summary={money(lastSeriesValue(companyCashSeries))} />
        <ChartPanel title={t.charts.externalCash} data={externalCashSeries} type="area" summary={money(lastSeriesValue(externalCashSeries))} />
        <ChartPanel title={t.charts.inventoryValue} data={inventoryValueSeries} type="area" summary={money(metrics.inventoryValue)} />
        <ChartPanel title={t.charts.vehiclesSold} data={vehiclesSoldSeries} type="bar" summary={String(sumSeries(vehiclesSoldSeries))} />
        <ChartPanel title={t.charts.lotTime} data={lotTimeSeries} type="bar" summary={`${rangeMetrics.averageTimeToSell}`} />
      </div>
      <Panel title={t.inventory.recentVehicles}>
        {scoped.vehicles.length === 0 ? (
          <EmptyState title="No vehicles in this organization" copy={permissions.manageVehicles ? "Use Add Vehicle to create your first inventory record." : "No inventory has been added yet."} />
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {scoped.vehicles.slice(0, 3).map((vehicle) => (
              <VehicleCard
                key={vehicle.id}
                t={t}
                vehicle={vehicle}
                expenses={scoped.expenses}
                sale={scoped.sales.find((item) => item.vehicleId === vehicle.id && isActiveSale(item))}
                onOpen={() => navigate("vehicles", { mode: "detail", vehicleId: vehicle.id, tab: "overview" })}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function ChartPanel({ title, data, type, summary }: { title: string; data: { label: string; value: number }[]; type: "area" | "bar"; summary: string }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const updateWidth = () => setChartWidth(Math.floor(element.getBoundingClientRect().width));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const chartHeight = 224;
  return (
    <div className="panel h-80">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="section-title">{title}</h3>
        <div className="rounded-md border border-cyan-300/15 bg-cyan-300/8 px-3 py-2 text-right">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">Selected range</p>
          <p className="mt-1 text-sm font-semibold text-white">{summary}</p>
        </div>
      </div>
      <div ref={chartRef} className="h-56 min-h-0 min-w-0">
        {data.length === 0 ? (
          <div className="grid h-56 place-items-center rounded-md border border-slate-800 bg-slate-900/40 px-4 text-center text-sm text-slate-500">
            No data in the selected range.
          </div>
        ) : chartWidth > 0 ? (
          type === "area" ? (
              <AreaChart data={data} width={chartWidth} height={chartHeight}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,.16)" />
                <XAxis dataKey="label" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip contentStyle={{ background: "#101827", border: "1px solid rgba(71,85,105,.55)", borderRadius: 8 }} />
                <Area type="monotone" dataKey="value" stroke="#67b7c7" fill="#67b7c7" fillOpacity={0.16} />
              </AreaChart>
            ) : (
              <BarChart data={data} width={chartWidth} height={chartHeight}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,.16)" />
                <XAxis dataKey="label" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip contentStyle={{ background: "#101827", border: "1px solid rgba(71,85,105,.55)", borderRadius: 8 }} />
                <Bar dataKey="value" fill="#7ca98f" radius={[4, 4, 0, 0]} />
              </BarChart>
            )
        ) : (
          <div className="h-56 rounded-md border border-slate-800 bg-slate-900/40" />
        )}
      </div>
    </div>
  );
}

function VehiclesSection(props: {
  t: ReturnType<typeof getDictionary>;
  mode: VehicleMode;
  selectedTab: VehicleTab;
  setSelectedTab: (tab: VehicleTab) => void;
  selectedVehicle?: Vehicle;
  vehicles: Vehicle[];
  expenses: VehicleExpense[];
  recurringExpenseTemplates: RecurringVehicleExpenseTemplate[];
  sales: Sale[];
  contacts: ContactRecord[];
  attachments: AppData["attachments"];
  activityLogs: AppData["activityLogs"];
  inventoryMode: "cards" | "table";
  setInventoryMode: (mode: "cards" | "table") => void;
  search: string;
  setSearch: (search: string) => void;
  statusFilter: VehicleStatus | "all";
  setStatusFilter: (status: VehicleStatus | "all") => void;
  navigate: (view: View, options?: { mode?: VehicleMode; vehicleId?: string; tab?: VehicleTab }) => void;
  addVehicle: (formData: FormData) => void;
  editVehicle: (formData: FormData) => void;
  deleteVehicle: (confirmationText: string, archiveReason: string) => void;
  addExpense: (formData: FormData) => void;
  applyRecurringExpenseTemplate: (templateId: string) => void;
  editExpense: (expenseId: string, formData: FormData) => void;
  deleteExpense: (expenseId: string) => void;
  recordSale: (formData: FormData) => void;
  voidSale: (saleId: string, reason: string) => void;
  correctSale: (saleId: string, formData: FormData) => void;
  addAttachment: (formData: FormData, relation: Record<string, string | undefined>) => void;
  setMainPhoto: (attachment: Attachment) => void;
  permissions: Permissions;
  loading: boolean;
  vehiclePrefill?: VehiclePrefill;
}) {
  if (props.mode === "new") {
    return (
      <div className="space-y-4">
        <button className="secondary-button" onClick={() => props.navigate("vehicles")}>
          <ChevronLeft size={18} />
          {props.t.nav.inventory}
        </button>
        {props.permissions.manageVehicles ? <AddVehicle t={props.t} onSubmit={props.addVehicle} prefill={props.vehiclePrefill} /> : <EmptyState title="Read-only access" copy="Your role cannot add vehicles." />}
      </div>
    );
  }
  if (props.mode === "detail" && props.selectedVehicle) {
    return <VehicleDetailTabs {...props} vehicle={props.selectedVehicle} />;
  }
  return <Inventory {...props} />;
}

function Inventory({
  t,
  vehicles,
  expenses,
  sales,
  inventoryMode,
  setInventoryMode,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  navigate,
  permissions,
}: Parameters<typeof VehiclesSection>[0]) {
  return (
    <div className="space-y-4">
      <div className="surface-muted grid gap-3 p-4 lg:grid-cols-[1fr_auto_auto]">
        <label className="relative">
          <Search className="absolute left-3 top-3 text-slate-500" size={18} />
          <input className="control w-full pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.inventory.search} />
        </label>
        <select className="control" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as VehicleStatus | "all")}>
          <option value="all">{t.inventory.filters}</option>
          {VEHICLE_STATUSES.map((status) => <option key={status} value={status}>{t.status[status]}</option>)}
        </select>
        <div className="flex flex-wrap gap-2">
          <div className="segmented">
            <button className={inventoryMode === "cards" ? "segmented-active" : ""} onClick={() => setInventoryMode("cards")}>{t.inventory.cardView}</button>
            <button className={inventoryMode === "table" ? "segmented-active" : ""} onClick={() => setInventoryMode("table")}>{t.inventory.tableView}</button>
          </div>
          {permissions.manageVehicles && <button className="primary-button" onClick={() => navigate("vehicles", { mode: "new" })}><Plus size={18} />{t.actions.addVehicle}</button>}
        </div>
      </div>
      {inventoryMode === "cards" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vehicles.length === 0 && <EmptyState title="No vehicles yet" copy={permissions.manageVehicles ? "Add your first vehicle to start tracking inventory." : "No vehicles are available for this organization."} />}
          {vehicles.map((vehicle) => (
            <VehicleCard
              key={vehicle.id}
              t={t}
              vehicle={vehicle}
              expenses={expenses}
              sale={sales.find((item) => item.vehicleId === vehicle.id && isActiveSale(item))}
              onOpen={() => navigate("vehicles", { mode: "detail", vehicleId: vehicle.id, tab: "overview" })}
            />
          ))}
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                {[t.fields.make, t.fields.vin, t.fields.status, t.fields.purchaseDate, t.fields.purchaseSource, t.fields.purchasePrice, t.metrics.totalExpenses, t.fields.vehicleTotalCost, t.fields.paperSalePrice, t.fields.realClientPayment, t.fields.externalCommission, t.metrics.netProfit, t.inventory.daysInInventory].map((header) => <th key={header}>{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {vehicles.length === 0 && (
                <tr>
                  <td colSpan={13}>
                    <EmptyState title="No matching vehicles" copy="Adjust the search or filters, or add a new vehicle." />
                  </td>
                </tr>
              )}
              {vehicles.map((vehicle) => {
                const sale = sales.find((item) => item.vehicleId === vehicle.id && isActiveSale(item));
                const totalCost = calculateVehicleTotalCost(vehicle, expenses);
                const expenseTotal = expenses.filter((expense) => expense.vehicleId === vehicle.id).reduce((sum, expense) => sum + expense.totalAmount, 0);
                return (
                  <tr key={vehicle.id} onClick={() => navigate("vehicles", { mode: "detail", vehicleId: vehicle.id, tab: "overview" })}>
                    <td>{vehicle.year} {vehicle.make} {vehicle.model}</td>
                    <td>{vehicle.vin}</td>
                    <td><Badge>{t.status[vehicle.status]}</Badge></td>
                    <td>{vehicle.purchaseDate}</td>
                    <td>{formatLabel(vehicle.purchaseSource)}</td>
                    <td>{money(vehicle.purchasePrice)}</td>
                    <td>{money(expenseTotal)}</td>
                    <td>{money(totalCost)}</td>
                    <td>{sale ? money(sale.paperSalePrice) : "-"}</td>
                    <td>{sale ? money(sale.realClientPayment) : "-"}</td>
                    <td>{sale ? money(sale.externalCommission) : "-"}</td>
                    <td>{sale ? money(sale.taxableProfitAmount - sale.profitTaxDue) : "-"}</td>
                    <td>{sale ? daysBetween(vehicle.purchaseDate, sale.saleDate) : daysBetween(vehicle.purchaseDate, today())}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VehicleDetailTabs({
  t,
  vehicle,
  selectedTab,
  setSelectedTab,
  expenses,
  recurringExpenseTemplates,
  sales,
  contacts,
  attachments,
  activityLogs,
  navigate,
  editVehicle,
  addExpense,
  applyRecurringExpenseTemplate,
  editExpense,
  deleteExpense,
  deleteVehicle,
  recordSale,
  voidSale,
  correctSale,
  addAttachment,
  setMainPhoto,
  permissions,
  loading,
}: Parameters<typeof VehiclesSection>[0] & { vehicle: Vehicle }) {
  const sale = sales.find((item) => item.vehicleId === vehicle.id && isActiveSale(item));
  const vehicleAttachments = attachments.filter((attachment) => attachment.vehicleId === vehicle.id || attachment.saleId === sale?.id);
  const vehiclePhotos = attachments.filter((attachment) => attachment.vehicleId === vehicle.id && attachment.type === "photo");
  const totalCost = calculateVehicleTotalCost(vehicle, expenses);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const canConfirmDelete = isValidVehicleDeleteConfirmation(deleteConfirmationText, vehicle.vin);

  return (
    <div className="space-y-4">
      <button className="secondary-button" onClick={() => navigate("vehicles")}>
        <ChevronLeft size={18} />
        {t.nav.inventory}
      </button>
      <div className="vehicle-header">
        <VehiclePhotoPreview vehicle={vehicle} className="aspect-[4/3]" iconSize={54} />
        <div className="min-w-0">
          <Badge>{t.status[vehicle.status]}</Badge>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">{vehicle.year} {vehicle.make} {vehicle.model}</h2>
          <p className="mt-1 text-sm text-slate-400">{vehicle.vin}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Info label={t.fields.purchaseSource} value={formatLabel(vehicle.purchaseSource)} />
            <Info label={t.fields.purchaseDate} value={vehicle.purchaseDate} />
            <Info label={t.fields.vehicleTotalCost} value={money(totalCost)} />
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          {permissions.manageExpenses && <button className="secondary-button" onClick={() => setSelectedTab("expenses")}><Receipt size={18} />{t.actions.addExpense}</button>}
          {permissions.manageSales && <button className="primary-button" onClick={() => setSelectedTab("sale")}><Banknote size={18} />{t.actions.recordSale}</button>}
          {permissions.deleteVehicles && (
            <button
              className="danger-button"
              type="button"
              onClick={() => {
                setDeleteConfirmationText("");
                setArchiveReason("");
                setConfirmDeleteOpen(true);
              }}
              disabled={loading}
            >
              <Trash2 size={18} />
              Archive vehicle
            </button>
          )}
        </div>
      </div>
      {confirmDeleteOpen && permissions.deleteVehicles && (
        <div className="panel border-rose-400/40 bg-rose-900/10">
          <h3 className="section-title text-rose-100">Archive vehicle</h3>
          <p className="text-sm text-rose-100/90">
            Archived vehicles are hidden from active inventory, but the vehicle, expenses, sale, cash ledger entries, documents, reports, and activity history are preserved for audit and tax records.
          </p>
          <div className="mt-3 grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
            <Info label="Vehicle" value={`${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() || vehicle.id} />
            <Info label="VIN" value={vehicle.vin || "N/A"} />
            <Info label="Reference" value={vehicle.id} />
            <Info label="Sale status" value={sale ? "Sold" : "Not sold"} />
          </div>
          <div className="mt-4 grid gap-2">
            <p className="text-xs uppercase tracking-wide text-rose-100/80">
              Type <strong>DELETE</strong>{vehicle.vin ? ` or the VIN (${vehicle.vin.toUpperCase()})` : ""} to confirm.
            </p>
            <input
              className="control w-full"
              placeholder="Type confirmation text"
              value={deleteConfirmationText}
              onChange={(event) => setDeleteConfirmationText(event.target.value)}
              disabled={loading}
            />
            <textarea
              className="control min-h-20 w-full"
              placeholder="Archive reason, optional"
              value={archiveReason}
              onChange={(event) => setArchiveReason(event.target.value)}
              disabled={loading}
              maxLength={500}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="danger-button"
              type="button"
              disabled={loading || !canConfirmDelete}
              onClick={() => {
                deleteVehicle(deleteConfirmationText.trim(), archiveReason.trim());
                setConfirmDeleteOpen(false);
              }}
            >
              {loading ? "Archiving..." : "Archive vehicle"}
            </button>
            <button className="secondary-button" type="button" onClick={() => setConfirmDeleteOpen(false)} disabled={loading}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="tabs-strip">
        {vehicleTabs.map(([tab, key]) => (
          <button key={tab} className={selectedTab === tab ? "tab-active" : ""} onClick={() => setSelectedTab(tab)}>
            {tabLabel(t, key)}
          </button>
        ))}
      </div>
      {selectedTab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title={tabLabel(t, "overview")}>
            <InfoGrid rows={[
              [t.fields.vin, vehicle.vin],
              [t.fields.status, t.status[vehicle.status]],
              [t.fields.purchaseSource, formatLabel(vehicle.purchaseSource)],
              [t.fields.purchaseDate, vehicle.purchaseDate],
              [t.fields.vehicleTotalCost, money(totalCost)],
              [t.metrics.netProfit, sale ? money(sale.taxableProfitAmount - sale.profitTaxDue) : money((vehicle.listedPrice ?? totalCost) - totalCost)],
            ]} />
          </Panel>
          <Panel title={t.sections.saleDetails}>
            {sale ? <SaleSummary t={t} sale={sale} contacts={contacts} /> : <p className="text-sm text-slate-400">{t.actions.recordSale}</p>}
            <p className="mt-4 rounded-md border border-amber-400/20 bg-amber-400/8 p-3 text-sm text-amber-100">{TAX_DISCLAIMER}</p>
          </Panel>
          <div className="xl:col-span-2">
            <PhotoManager t={t} vehicle={vehicle} photos={vehiclePhotos} onUpload={addAttachment} onSetMain={setMainPhoto} permissions={permissions} />
          </div>
        </div>
      )}
      {selectedTab === "details" && <VehicleDetailsTab t={t} vehicle={vehicle} sale={sale} onSubmit={editVehicle} permissions={permissions} />}
      {selectedTab === "expenses" && <Expenses t={t} vehicle={vehicle} expenses={expenses} recurringExpenseTemplates={recurringExpenseTemplates} onSubmit={addExpense} onApplyTemplate={applyRecurringExpenseTemplate} onEdit={editExpense} onDelete={deleteExpense} permissions={permissions} loading={loading} />}
      {selectedTab === "documents" && <DocumentsTab t={t} vehicle={vehicle} attachments={vehicleAttachments} onSubmit={addAttachment} permissions={permissions} />}
      {selectedTab === "sale" && <SaleForm t={t} vehicle={vehicle} expenses={expenses} onSubmit={recordSale} onVoid={voidSale} onCorrect={correctSale} sale={sale} permissions={permissions} />}
      {selectedTab === "timeline" && (
        <Panel title={tabLabel(t, "timeline")}>
          <Ledger
            emptyTitle="No timeline activity yet"
            emptyCopy="Vehicle changes, expenses, documents, sale activity, and cash events will appear here."
            rows={activityLogs.filter((log) => !log.entityId || log.entityId === vehicle.id).map((log) => [log.createdAt.slice(0, 10), formatLabel(log.action), log.message])}
          />
        </Panel>
      )}
    </div>
  );
}

function VehicleCard({ t, vehicle, expenses, sale, onOpen }: { t: ReturnType<typeof getDictionary>; vehicle: Vehicle; expenses: VehicleExpense[]; sale?: Sale; onOpen: () => void }) {
  const totalCost = calculateVehicleTotalCost(vehicle, expenses);
  return (
    <button className="vehicle-card" onClick={onOpen}>
      <VehiclePhotoPreview vehicle={vehicle} className="mb-4 aspect-[16/9]" iconSize={46} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold tracking-tight text-white">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
          <p className="truncate text-sm text-slate-500">{vehicle.vin}</p>
        </div>
        <Badge>{t.status[vehicle.status]}</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Info label={t.fields.purchaseSource} value={formatLabel(vehicle.purchaseSource)} />
        <Info label={t.fields.vehicleTotalCost} value={money(totalCost)} />
        <Info label={t.fields.listedPrice} value={vehicle.listedPrice ? money(vehicle.listedPrice) : "-"} />
        <Info label={t.inventory.estimatedProfit} value={sale ? money(sale.taxableProfitAmount - sale.profitTaxDue) : money((vehicle.listedPrice ?? totalCost) - totalCost)} />
      </dl>
    </button>
  );
}

function VehiclePhotoPreview({ vehicle, className, iconSize }: { vehicle: Vehicle; className?: string; iconSize: number }) {
  return (
    <div className={`grid place-items-center overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70 ${className ?? ""}`}>
      {vehicle.mainPhotoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={vehicle.mainPhotoUrl} alt={`${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`} className="h-full w-full object-cover" />
      ) : (
        <Car className="text-cyan-200/75" size={iconSize} />
      )}
    </div>
  );
}

function PhotoManager({
  t,
  vehicle,
  photos,
  onUpload,
  onSetMain,
  permissions,
}: {
  t: ReturnType<typeof getDictionary>;
  vehicle: Vehicle;
  photos: Attachment[];
  onUpload: (formData: FormData, relation: Record<string, string | undefined>) => void;
  onSetMain: (attachment: Attachment) => void;
  permissions: Permissions;
}) {
  return (
    <Panel title={t.sections.vehiclePhotos}>
      {permissions.manageAttachments && (
        <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" action={(formData) => onUpload(formData, { vehicleId: vehicle.id })}>
          <input type="hidden" name="type" value="photo" />
          <Field label={t.fields.fileTitle}><input className="control w-full" name="title" placeholder={`${vehicle.year ?? ""} ${vehicle.make ?? ""} photo`} required /></Field>
          <Field label={t.sections.photos}><input className="control w-full" name="file" type="file" accept="image/*" required /></Field>
          <div className="flex items-end"><button className="primary-button" type="submit"><Upload size={18} />Upload</button></div>
        </form>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {photos.length === 0 && (
          <div className="sm:col-span-2 xl:col-span-4">
            <EmptyState title="No vehicle photos yet" copy={permissions.manageAttachments ? "Upload photos here, then choose the one that should be used as the front image." : "No photos have been uploaded for this vehicle."} />
          </div>
        )}
        {photos.map((photo) => {
          const isMain = photo.urlOrPath === vehicle.mainPhotoPath;
          return (
            <div key={photo.id} className={`rounded-lg border p-3 ${isMain ? "border-cyan-300/40 bg-cyan-300/8" : "border-slate-800 bg-slate-950/35"}`}>
              <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-md border border-slate-800 bg-slate-900/70">
                {photo.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.previewUrl} alt={photo.title} className="h-full w-full object-cover" />
                ) : (
                  <Car className="text-cyan-200/70" size={34} />
                )}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-slate-200">{photo.title}</p>
                {isMain && <Badge>Front</Badge>}
              </div>
              {permissions.manageAttachments && (
                <button className="secondary-button mt-3 w-full justify-center" type="button" disabled={isMain} onClick={() => onSetMain(photo)}>
                  {isMain ? "Selected front image" : "Set as front image"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function AddVehicle({ t, onSubmit, prefill }: { t: ReturnType<typeof getDictionary>; onSubmit: (formData: FormData) => void; prefill?: VehiclePrefill }) {
  const [decoded, setDecoded] = useState<Partial<Vehicle>>({});
  const [vin, setVin] = useState("");
  const [loading, setLoading] = useState(false);
  async function decode() {
    setLoading(true);
    try {
      const response = await fetch(`/api/vin?vin=${encodeURIComponent(vin)}`);
      setDecoded(await response.json());
    } finally {
      setLoading(false);
    }
  }
  return (
    <form className="panel grid gap-4 lg:grid-cols-2" action={onSubmit}>
      <Field label={t.fields.vin}><input className="control w-full" name="vin" value={vin} onChange={(event) => setVin(event.target.value)} /></Field>
      <div className="flex items-end"><button className="secondary-button" type="button" onClick={decode} disabled={loading}>{t.actions.decodeVin}</button></div>
      {prefill && <div className="lg:col-span-2 rounded-md border border-cyan-300/20 bg-cyan-300/8 p-3 text-sm text-cyan-100">Deal Radar prefill loaded. Review every field before saving inventory.</div>}
      <Field label={t.fields.year}><input className="control w-full" name="year" defaultValue={decoded.year ?? prefill?.year} /></Field>
      <Field label={t.fields.make}><input className="control w-full" name="make" defaultValue={decoded.make ?? prefill?.make} /></Field>
      <Field label={t.fields.model}><input className="control w-full" name="model" defaultValue={decoded.model ?? prefill?.model} /></Field>
      <Field label={t.fields.trim}><input className="control w-full" name="trim" defaultValue={decoded.trim ?? prefill?.trim} /></Field>
      <Field label={t.fields.color}><input className="control w-full" name="color" defaultValue={decoded.color} /></Field>
      <Field label={t.fields.mileage}><input className="control w-full" name="mileage" type="number" defaultValue={prefill?.mileage} /></Field>
      <Field label={t.fields.purchasePrice}><input className="control w-full" name="purchasePrice" type="number" step="0.01" defaultValue={prefill?.purchasePrice} required /></Field>
      <Field label={t.fields.purchaseDate}><input className="control w-full" name="purchaseDate" type="date" defaultValue={today()} required /></Field>
      <Field label={t.fields.purchaseSource}><select className="control w-full" name="purchaseSource" defaultValue={prefill?.purchaseSource}>{PURCHASE_SOURCES.map((source) => <option key={source} value={source}>{formatLabel(source)}</option>)}</select></Field>
      <Field label={t.fields.status}><select className="control w-full" name="status" defaultValue="purchased">{VEHICLE_STATUSES.map((status) => <option key={status} value={status}>{t.status[status]}</option>)}</select></Field>
      <Field label={t.fields.listedPrice}><input className="control w-full" name="listedPrice" type="number" step="0.01" /></Field>
      <Field label={t.fields.notes}><textarea className="control min-h-24 w-full" name="notes" defaultValue={prefill?.notes} /></Field>
      <div className="lg:col-span-2"><button className="primary-button" type="submit">{t.actions.saveVehicle}</button></div>
    </form>
  );
}

function VehicleDetailsTab({
  t,
  vehicle,
  sale,
  onSubmit,
  permissions,
}: {
  t: ReturnType<typeof getDictionary>;
  vehicle: Vehicle;
  sale?: Sale;
  onSubmit: (formData: FormData) => void;
  permissions: Permissions;
}) {
  const allowedStatuses = getAllowedVehicleStatusTransitions(vehicle.status);
  const soldLocked = Boolean(sale) || vehicle.status === "sold";
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Basic details">
        <form className="grid gap-4 lg:grid-cols-2" action={onSubmit}>
          <input type="hidden" name="updateMode" value="basic" />
          <Field label={t.fields.vin}><input className="control w-full" name="vin" defaultValue={vehicle.vin} /></Field>
          <Field label={t.fields.year}><input className="control w-full" name="year" defaultValue={vehicle.year} /></Field>
          <Field label={t.fields.make}><input className="control w-full" name="make" defaultValue={vehicle.make} /></Field>
          <Field label={t.fields.model}><input className="control w-full" name="model" defaultValue={vehicle.model} /></Field>
          <Field label={t.fields.trim}><input className="control w-full" name="trim" defaultValue={vehicle.trim} /></Field>
          <Field label={t.fields.color}><input className="control w-full" name="color" defaultValue={vehicle.color} /></Field>
          <Field label={t.fields.mileage}><input className="control w-full" name="mileage" type="number" defaultValue={vehicle.mileage} /></Field>
          <Field label={t.fields.listedPrice}><input className="control w-full" name="listedPrice" type="number" step="0.01" defaultValue={vehicle.listedPrice} /></Field>
          <Field label={t.fields.notes}><textarea className="control min-h-24 w-full" name="notes" defaultValue={vehicle.notes} /></Field>
          {permissions.manageVehicles && <div className="lg:col-span-2"><button className="primary-button" type="submit">{t.actions.saveVehicle}</button></div>}
        </form>
      </Panel>
      <Panel title="Status transition">
        <form className="grid gap-3" action={onSubmit}>
          <input type="hidden" name="updateMode" value="status" />
          <InfoGrid rows={[
            ["Current status", t.status[vehicle.status]],
            ["Allowed next step", allowedStatuses.map((status) => t.status[status]).join(", ") || "Use the sale or correction workflow"],
          ]} />
          <Field label={t.fields.status}>
            <select className="control w-full" name="status" defaultValue={allowedStatuses[0] ?? vehicle.status} disabled={allowedStatuses.length === 0}>
              {allowedStatuses.length === 0 ? <option value={vehicle.status}>{t.status[vehicle.status]}</option> : allowedStatuses.map((status) => <option key={status} value={status}>{t.status[status]}</option>)}
            </select>
          </Field>
          <Field label="Reason"><input className="control w-full" name="reason" placeholder="Optional status note" /></Field>
          <p className="text-sm text-slate-400">Vehicles move from purchased to repair to listed. Sold status is created only by recording a sale.</p>
          {permissions.manageVehicles && <button className="secondary-button" type="submit" disabled={allowedStatuses.length === 0}>Update status</button>}
        </form>
      </Panel>
      <div className="xl:col-span-2">
        <Panel title="Purchase correction">
          <form className="grid gap-4 lg:grid-cols-2" action={onSubmit}>
            <input type="hidden" name="updateMode" value="purchase" />
            <Field label={t.fields.purchasePrice}><input className="control w-full" name="purchasePrice" type="number" step="0.01" defaultValue={vehicle.purchasePrice} disabled={soldLocked} required /></Field>
            <Field label={t.fields.purchaseDate}><input className="control w-full" name="purchaseDate" type="date" defaultValue={vehicle.purchaseDate} disabled={soldLocked} required /></Field>
            <Field label={t.fields.purchaseSource}><select className="control w-full" name="purchaseSource" defaultValue={vehicle.purchaseSource} disabled={soldLocked}>{PURCHASE_SOURCES.map((source) => <option key={source} value={source}>{formatLabel(source)}</option>)}</select></Field>
            <Field label="Correction reason"><textarea className="control min-h-24 w-full" name="reason" placeholder="Explain why the purchase record is being corrected" disabled={soldLocked} required /></Field>
            <div className="lg:col-span-2 rounded-md border border-amber-400/20 bg-amber-400/8 p-3 text-sm text-amber-100">
              {soldLocked ? "Sold vehicle purchase details are locked until the sale void/correction workflow is used." : "This recalculates purchase tax and the linked company cash impact atomically."}
            </div>
            {permissions.manageVehicles && <div className="lg:col-span-2"><button className="secondary-button" type="submit" disabled={soldLocked}>Correct purchase details</button></div>}
          </form>
        </Panel>
      </div>
    </div>
  );
}

function Expenses({
  t,
  vehicle,
  expenses,
  recurringExpenseTemplates,
  onSubmit,
  onApplyTemplate,
  onEdit,
  onDelete,
  permissions,
  loading,
}: {
  t: ReturnType<typeof getDictionary>;
  vehicle: Vehicle;
  expenses: VehicleExpense[];
  recurringExpenseTemplates: RecurringVehicleExpenseTemplate[];
  onSubmit: (formData: FormData) => void;
  onApplyTemplate: (templateId: string) => void;
  onEdit: (expenseId: string, formData: FormData) => void;
  onDelete: (expenseId: string) => void;
  permissions: Permissions;
  loading: boolean;
}) {
  const vehicleExpenses = expenses.filter((expense) => expense.vehicleId === vehicle.id);
  const activeTemplates = recurringExpenseTemplates.filter((template) => template.isActive && !template.deletedAt);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const effectiveSelectedTemplateId = activeTemplates.some((template) => template.id === selectedTemplateId)
    ? selectedTemplateId
    : activeTemplates[0]?.id ?? "";
  const selectedTemplate = activeTemplates.find((template) => template.id === effectiveSelectedTemplateId);
  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      {permissions.manageExpenses ? <div className="space-y-4">
        {activeTemplates.length > 0 && (
          <div className="panel space-y-3">
            <h3 className="section-title">Apply recurring expense template</h3>
            <Field label="Template">
              <select className="control w-full" value={effectiveSelectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                {activeTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} - {money(template.totalAmount)} / {formatLabel(template.defaultFundingSource)}
                  </option>
                ))}
              </select>
            </Field>
            {selectedTemplate && (
              <p className="rounded-md border border-slate-800 bg-slate-950/45 p-3 text-xs text-slate-400">
                {formatLabel(selectedTemplate.category)} / {money(selectedTemplate.amountBeforeTax)} before tax / {Math.round(selectedTemplate.taxRate * 100)}% tax / {formatLabel(selectedTemplate.defaultFundingSource)}
              </p>
            )}
            <button className="secondary-button" type="button" disabled={loading || !effectiveSelectedTemplateId} onClick={() => effectiveSelectedTemplateId && onApplyTemplate(effectiveSelectedTemplateId)}>
              {loading ? "Applying..." : "Apply template"}
            </button>
          </div>
        )}
        <form className="panel space-y-4" action={onSubmit}>
          <h3 className="section-title">{t.actions.addExpense}</h3>
          <Field label={t.fields.category}><select className="control w-full" name="category">{EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{formatLabel(category)}</option>)}</select></Field>
          <Field label={t.fields.amountBeforeTax}><input className="control w-full" name="amountBeforeTax" type="number" step="0.01" required /></Field>
          <Field label="Funding source">
            <select className="control w-full" name="fundingSource" defaultValue="company_cash">
              {EXPENSE_FUNDING_SOURCES.map((source) => <option key={source} value={source}>{formatLabel(source)}</option>)}
            </select>
          </Field>
          <p className="text-xs text-slate-500">The expense total will reduce the selected cash ledger.</p>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input name="addTax" type="checkbox" />{t.fields.addFifteenTax}</label>
          <Field label={t.fields.date}><input className="control w-full" name="date" type="date" defaultValue={today()} /></Field>
          <Field label={t.fields.fileTitle}><input className="control w-full" placeholder="private://..." /></Field>
          <Field label={t.fields.notes}><textarea className="control min-h-24 w-full" name="note" /></Field>
          <button className="primary-button" type="submit">{t.actions.addExpense}</button>
        </form>
      </div> : <EmptyState title="Read-only expenses" copy="Your role can view expenses but cannot add or edit them." />}
      <Panel title={`${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`}>
        <div className="space-y-3">
          {vehicleExpenses.length === 0 && (
            <EmptyState title="No expenses for this vehicle" copy={permissions.manageExpenses ? "Add repair, auction, transport, or other vehicle costs from the form beside this list." : "No expenses have been recorded for this vehicle."} />
          )}
          {vehicleExpenses.map((expense) => (
            <div key={expense.id} className="rounded-lg border border-slate-800 bg-slate-950/35 p-3">
              {editingExpenseId === expense.id && permissions.manageExpenses ? (
                <form className="grid gap-3 lg:grid-cols-2" action={(formData) => {
                  onEdit(expense.id, formData);
                  setEditingExpenseId(null);
                }}>
                  <Field label={t.fields.category}>
                    <select className="control w-full" name="category" defaultValue={expense.category}>
                      {EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{formatLabel(category)}</option>)}
                    </select>
                  </Field>
                  <Field label={t.fields.amountBeforeTax}><input className="control w-full" name="amountBeforeTax" type="number" step="0.01" defaultValue={expense.amountBeforeTax} required /></Field>
                  <Info label="Funding source" value={`${formatLabel(expense.fundingSource ?? "company_cash")} (locked after creation)`} />
                  <label className="flex items-center gap-2 text-sm text-slate-300"><input name="addTax" type="checkbox" defaultChecked={expense.taxRate === 0.15} />{t.fields.addFifteenTax}</label>
                  <Field label={t.fields.date}><input className="control w-full" name="date" type="date" defaultValue={expense.date} /></Field>
                  <Field label={t.fields.notes}><textarea className="control min-h-20 w-full" name="note" defaultValue={expense.note} /></Field>
                  <div className="flex items-end gap-2">
                    <button className="primary-button" type="submit">Save</button>
                    <button className="secondary-button" type="button" onClick={() => setEditingExpenseId(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
                  <InfoGrid rows={[
                    [t.fields.date, expense.date],
                    [t.fields.category, formatLabel(expense.category)],
                    [t.fields.amountBeforeTax, money(expense.amountBeforeTax)],
                    [t.fields.taxRate, `${Math.round(expense.taxRate * 100)}%`],
                    [t.fields.taxAmount, money(expense.taxAmount)],
                    [t.fields.totalAmount, money(expense.totalAmount)],
                    ["Funding source", formatLabel(expense.fundingSource ?? "company_cash")],
                    [t.fields.notes, expense.note],
                  ]} />
                  {permissions.manageExpenses && <div className="flex gap-2">
                    <button className="secondary-button" type="button" onClick={() => setEditingExpenseId(expense.id)}>Edit</button>
                    <button className="secondary-button" type="button" onClick={() => onDelete(expense.id)}>Delete</button>
                  </div>}
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-slate-400">{t.fields.taxAmount}: {money(vehicleExpenses.reduce((sum, expense) => sum + expense.taxAmount, 0))}</p>
      </Panel>
    </div>
  );
}

function DocumentsTab({
  t,
  vehicle,
  attachments,
  onSubmit,
  permissions,
}: {
  t: ReturnType<typeof getDictionary>;
  vehicle: Vehicle;
  attachments: AppData["attachments"];
  onSubmit: (formData: FormData, relation: Record<string, string | undefined>) => void;
  permissions: Permissions;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <Panel title={t.sections.photos}>
        {permissions.manageAttachments ? <form className="grid gap-3" action={(formData) => onSubmit(formData, { vehicleId: vehicle.id })}>
          <Field label={t.fields.type}>
            <select className="control w-full" name="type">
              <option value="link">Link</option>
              <option value="file">File</option>
              <option value="photo">Photo</option>
            </select>
          </Field>
          <Field label={t.fields.fileTitle}><input className="control w-full" name="title" required /></Field>
          <Field label={t.fields.urlOrPath}><input className="control w-full" name="urlOrPath" placeholder="https:// or private note" /></Field>
          <Field label={t.sections.documentsLinks}><input className="control w-full" name="file" type="file" /></Field>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" name="isSensitive" />Private/sensitive</label>
          <Field label={t.fields.notes}><textarea className="control min-h-20 w-full" name="notes" /></Field>
          <button className="primary-button" type="submit"><Upload size={18} />{t.sections.documentsLinks}</button>
        </form> : <p className="text-sm text-slate-500">Your role can view documents but cannot upload them.</p>}
      </Panel>
      <Panel title={t.sections.documentsLinks}>
        <AttachmentList attachments={attachments} emptyCopy={permissions.manageAttachments ? "Upload a photo, invoice, PDF, or link from the form beside this panel." : "No documents or links are available for this vehicle."} />
      </Panel>
    </div>
  );
}

function SaleForm({
  t,
  vehicle,
  expenses,
  onSubmit,
  onVoid,
  onCorrect,
  sale,
  permissions,
}: {
  t: ReturnType<typeof getDictionary>;
  vehicle: Vehicle;
  expenses: VehicleExpense[];
  onSubmit: (formData: FormData) => void;
  onVoid: (saleId: string, reason: string) => void;
  onCorrect: (saleId: string, formData: FormData) => void;
  sale?: Sale;
  permissions: Permissions;
}) {
  const [taxableProfitAmount, setTaxableProfitAmount] = useState(sale?.taxableProfitAmount ?? 1500);
  const [realClientPayment, setRealClientPayment] = useState(sale?.realClientPayment ?? 0);
  const [voidReason, setVoidReason] = useState("");
  const vehicleTotalCost = calculateVehicleTotalCost(vehicle, expenses);
  const breakdown = calculateSaleBreakdown({ vehicleTotalCost, taxableProfitAmount, realClientPayment });
  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      {sale ? (
        <div className="panel space-y-4">
          <h3 className="section-title">Sale correction</h3>
          <p className="text-sm text-slate-400">Corrections preserve the original sale, reverse its cash impact, and create a new active sale.</p>
          {permissions.manageSales ? (
            <>
              <form className="grid gap-3" action={(formData) => onCorrect(sale.id, formData)}>
                <Field label={t.fields.saleDate}><input className="control w-full" name="saleDate" type="date" defaultValue={sale.saleDate} /></Field>
                <Field label={t.fields.taxableProfit}><input className="control w-full" name="taxableProfitAmount" type="number" step="0.01" defaultValue={sale.taxableProfitAmount} /></Field>
                <Field label={t.fields.realClientPayment}><input className="control w-full" name="realClientPayment" type="number" step="0.01" defaultValue={sale.realClientPayment} /></Field>
                <Field label={t.fields.buyerName}><input className="control w-full" name="buyerName" /></Field>
                <Field label={t.fields.phone}><input className="control w-full" name="phone" /></Field>
                <Field label={t.fields.email}><input className="control w-full" name="email" type="email" /></Field>
                <Field label={t.fields.address}><input className="control w-full" name="address" /></Field>
                <Field label="Correction reason"><textarea className="control min-h-20 w-full" name="reason" required /></Field>
                <Field label={t.fields.notes}><textarea className="control min-h-20 w-full" name="notes" defaultValue={sale.notes} /></Field>
                <button className="secondary-button" type="submit">Correct sale</button>
              </form>
              <div className="rounded-md border border-rose-400/30 bg-rose-900/10 p-3">
                <p className="text-sm text-rose-100">Void only for cancelled or accidental sales. This adds reversal cash entries and returns the vehicle to listed status.</p>
                <textarea className="control mt-3 min-h-20 w-full" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Reason for void" />
                <button className="danger-button mt-3" type="button" disabled={voidReason.trim().length < 3} onClick={() => onVoid(sale.id, voidReason.trim())}>Void sale</button>
              </div>
            </>
          ) : <EmptyState title="Read-only sale correction" copy="Your role cannot correct or void sales." />}
        </div>
      ) : permissions.manageSales ? <form className="panel space-y-4" action={onSubmit}>
        <h3 className="section-title">{t.actions.recordSale}</h3>
        <Field label={t.fields.saleDate}><input className="control w-full" name="saleDate" type="date" defaultValue={today()} /></Field>
        <Field label={t.fields.taxableProfit}><input className="control w-full" name="taxableProfitAmount" type="number" step="0.01" value={taxableProfitAmount} onChange={(event) => setTaxableProfitAmount(Number(event.target.value))} /></Field>
        <Field label={t.fields.realClientPayment}><input className="control w-full" name="realClientPayment" type="number" step="0.01" value={realClientPayment} onChange={(event) => setRealClientPayment(Number(event.target.value))} /></Field>
        <Field label={t.fields.buyerName}><input className="control w-full" name="buyerName" required /></Field>
        <Field label={t.fields.phone}><input className="control w-full" name="phone" /></Field>
        <Field label={t.fields.email}><input className="control w-full" name="email" type="email" /></Field>
        <Field label={t.fields.address}><input className="control w-full" name="address" /></Field>
        <Field label={t.fields.fileTitle}><input className="control w-full" placeholder="driver-license-private-path" /></Field>
        <Field label={t.fields.notes}><textarea className="control min-h-24 w-full" name="notes" /></Field>
        <button className="primary-button" type="submit">{t.actions.recordSale}</button>
      </form> : <EmptyState title="Read-only sale details" copy="Your role cannot mark vehicles as sold." />}
      <Panel title={t.sections.saleDetails}>
        <InfoGrid rows={[
          [t.fields.vehicleTotalCost, money(vehicleTotalCost)],
          [t.fields.paperSalePrice, money(breakdown.paperSalePrice)],
          [t.fields.profitTaxDue, money(breakdown.profitTaxDue)],
          [t.fields.externalCommission, money(breakdown.externalCommission)],
          [t.metrics.netProfit, money(breakdown.netProfitAfterTax)],
        ]} />
        <p className="mt-4 rounded-md border border-amber-400/20 bg-amber-400/8 p-3 text-sm text-amber-100">{TAX_DISCLAIMER}</p>
      </Panel>
    </div>
  );
}

function SaleSummary({ t, sale, contacts }: { t: ReturnType<typeof getDictionary>; sale: Sale; contacts: ContactRecord[] }) {
  return <InfoGrid rows={[
    [t.fields.paperSalePrice, money(sale.paperSalePrice)],
    [t.fields.realClientPayment, money(sale.realClientPayment)],
    [t.fields.externalCommission, money(sale.externalCommission)],
    [t.fields.profitTaxDue, money(sale.profitTaxDue)],
    [t.fields.buyerName, contacts.find((contact) => contact.id === sale.contactId)?.fullName],
  ]} />;
}

function CashManagement({
  t,
  metrics,
  companyTransactions,
  externalTransactions,
  onQuickTransaction,
  onEditTransaction,
  onDeleteTransaction,
  permissions,
}: {
  t: ReturnType<typeof getDictionary>;
  metrics: ReturnType<typeof calculateDashboardMetrics>;
  companyTransactions: CompanyCashTransaction[];
  externalTransactions: ExternalCashTransaction[];
  onQuickTransaction: (type: CompanyCashTransaction["type"] | ExternalCashTransaction["type"], amount: number, note: string, date?: string) => void;
  onEditTransaction: (account: CashAccount, transactionId: string, formData: FormData) => void;
  onDeleteTransaction: (account: CashAccount, transactionId: string, reason: string) => void;
  permissions: Permissions;
}) {
  const activeCompanyTransactions = companyTransactions.filter((transaction) => !transaction.deletedAt);
  const activeExternalTransactions = externalTransactions.filter((transaction) => !transaction.deletedAt);
  const deletedTransactions = [
    ...companyTransactions.filter((transaction) => transaction.deletedAt).map((transaction) => ({ account: "company" as const, transaction })),
    ...externalTransactions.filter((transaction) => transaction.deletedAt).map((transaction) => ({ account: "external" as const, transaction })),
  ].sort((a, b) => String(b.transaction.deletedAt).localeCompare(String(a.transaction.deletedAt)));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="metric-card min-h-36">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{t.metrics.companyCash}</p>
          <p className="mt-3 text-3xl font-semibold text-white">{money(metrics.companyCash)}</p>
          {permissions.manageCash ? <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <CashActionForm t={t} label={t.actions.addCompanyCash} type="company_cash_added" onSubmit={onQuickTransaction} />
            <CashActionForm t={t} label={t.actions.withdrawCompanyCash} type="company_cash_withdrawn" onSubmit={onQuickTransaction} />
          </div> : <p className="mt-4 text-sm text-slate-500">Read-only cash access.</p>}
        </div>
        <div className="metric-card min-h-36">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{t.metrics.externalCash}</p>
          <p className="mt-3 text-3xl font-semibold text-white">{money(metrics.externalCash)}</p>
          {permissions.manageCash ? <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <CashActionForm t={t} label={t.actions.transferExternalCash} type="external_cash_transferred_to_company" onSubmit={onQuickTransaction} />
            <CashActionForm t={t} label={t.actions.removeExternalCash} type="external_cash_personally_removed" onSubmit={onQuickTransaction} />
          </div> : <p className="mt-4 text-sm text-slate-500">Read-only external cash access.</p>}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t.sections.companyLedger}>
          <CashLedger account="company" transactions={activeCompanyTransactions} onEdit={onEditTransaction} onDelete={onDeleteTransaction} canManage={permissions.manageCash} emptyCopy={permissions.manageCash ? "Add company cash or record a business withdrawal to start the ledger." : "No company cash transactions have been recorded."} />
        </Panel>
        <Panel title={t.sections.externalLedger}>
          <CashLedger account="external" transactions={activeExternalTransactions} onEdit={onEditTransaction} onDelete={onDeleteTransaction} canManage={permissions.manageCash} emptyCopy={permissions.manageCash ? "External commission cash from sales will appear here, and can be transferred or removed." : "No external cash transactions have been recorded."} />
        </Panel>
      </div>
      {deletedTransactions.length > 0 && (
        <Panel title="Legacy deleted cash history">
          <Ledger emptyTitle="No legacy deleted cash history" emptyCopy="Legacy deleted cash entries will appear here for audit review." rows={deletedTransactions.map(({ account, transaction }) => [
            formatLabel(account),
            transaction.date,
            formatLabel(transaction.type),
            money(transaction.amount),
            transaction.note ?? "",
            transaction.deletedAt ? new Date(transaction.deletedAt).toLocaleString() : "",
            transaction.deletionNote ?? "",
          ])} />
        </Panel>
      )}
    </div>
  );
}

function CashLedger({
  account,
  transactions,
  onEdit,
  onDelete,
  canManage,
  emptyCopy,
}: {
  account: CashAccount;
  transactions: CashTransaction[];
  onEdit: (account: CashAccount, transactionId: string, formData: FormData) => void;
  onDelete: (account: CashAccount, transactionId: string, reason: string) => void;
  canManage: boolean;
  emptyCopy: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (transactions.length === 0) return <EmptyState title="No ledger activity" copy={emptyCopy} />;

  return (
    <div className="space-y-3">
      {transactions.map((transaction) => (
        <div key={transaction.id} className="rounded-md border border-slate-800 bg-slate-950/35 p-3">
          {editingId === transaction.id ? (
            <form
              className="grid gap-3"
              action={(formData) => {
                onEdit(account, transaction.id, formData);
                setEditingId(null);
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <input className="control w-full" name="date" type="date" defaultValue={transaction.date} />
                <input className="control w-full" name="amount" type="number" min="0.01" step="0.01" defaultValue={transaction.amount} required />
                <input className="control w-full" name="note" defaultValue={transaction.note ?? ""} placeholder="Notes" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="primary-button" type="submit">Save</button>
                <button className="secondary-button" type="button" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </form>
          ) : deletingId === transaction.id ? (
            <form
              className="grid gap-3"
              action={(formData) => {
                onDelete(account, transaction.id, String(formData.get("reason") || ""));
                setDeletingId(null);
              }}
            >
              <p className="text-sm text-amber-100">This will keep the original entry and add an equal opposite reversal entry.</p>
              <input className="control w-full" name="reason" placeholder="Reason for reversal" />
              <div className="flex flex-wrap gap-2">
                <button className="secondary-button" type="submit">Reverse transaction</button>
                <button className="secondary-button" type="button" onClick={() => setDeletingId(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <InfoGrid rows={[
                ["Date", transaction.date],
                ["Type", formatLabel(transaction.type)],
                ["Amount", money(transaction.amount)],
                ["Notes", transaction.note ?? ""],
              ]} />
              {canManage && <div className="flex flex-wrap gap-2">
                <button className="secondary-button" type="button" onClick={() => setEditingId(transaction.id)}>Edit</button>
                <button className="secondary-button" type="button" onClick={() => setDeletingId(transaction.id)}>Reverse</button>
              </div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CashActionForm({
  t,
  label,
  type,
  onSubmit,
}: {
  t: ReturnType<typeof getDictionary>;
  label: string;
  type: CompanyCashTransaction["type"] | ExternalCashTransaction["type"];
  onSubmit: (type: CompanyCashTransaction["type"] | ExternalCashTransaction["type"], amount: number, note: string, date?: string) => void;
}) {
  return (
    <form
      className="rounded-md border border-slate-800 bg-slate-950/30 p-3"
      action={(formData) => {
        const amount = Number(formData.get("amount"));
        if (!Number.isFinite(amount) || amount <= 0) return;
        onSubmit(type, amount, String(formData.get("note") || label), String(formData.get("date") || today()));
      }}
    >
      <p className="text-sm font-medium text-slate-200">{label}</p>
      <div className="mt-3 grid gap-2">
        <input className="control w-full" name="amount" type="number" min="0.01" step="0.01" placeholder={t.fields.amount} required />
        <input className="control w-full" name="date" type="date" defaultValue={today()} />
        <input className="control w-full" name="note" placeholder={t.fields.notes} />
        <button className="secondary-button justify-center" type="submit">{label}</button>
      </div>
    </form>
  );
}

function Contacts({
  t,
  contacts,
  attachments,
  onSubmit,
  permissions,
}: {
  t: ReturnType<typeof getDictionary>;
  contacts: ContactRecord[];
  attachments: AppData["attachments"];
  onSubmit: (formData: FormData) => void;
  permissions: Permissions;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      {permissions.manageContacts ? <form className="panel space-y-3" action={onSubmit}>
        <h3 className="section-title">{t.nav.contacts}</h3>
        <Field label={t.fields.buyerName}><input className="control w-full" name="fullName" required /></Field>
        <Field label={t.fields.contactType}>
          <select className="control w-full" name="type">
            {["buyer", "interested_in_buy_resell", "export_contact", "seller", "partner", "other"].map((type) => <option key={type} value={type}>{formatLabel(type)}</option>)}
          </select>
        </Field>
        <Field label={t.fields.type}><input className="control w-full" name="customTypeDescription" placeholder="other description" /></Field>
        <Field label={t.fields.phone}><input className="control w-full" name="phone" /></Field>
        <Field label={t.fields.email}><input className="control w-full" name="email" type="email" /></Field>
        <Field label={t.fields.address}><input className="control w-full" name="address" /></Field>
        <Field label="Desired vehicle types"><input className="control w-full" name="desiredVehicleTypes" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Budget min"><input className="control w-full" name="budgetMin" type="number" /></Field>
          <Field label="Budget max"><input className="control w-full" name="budgetMax" type="number" /></Field>
        </div>
        <Field label="Commission agreement"><input className="control w-full" name="commissionAgreement" /></Field>
        <Field label="Country/region"><input className="control w-full" name="exportRegion" /></Field>
        <Field label={t.fields.notes}><textarea className="control min-h-20 w-full" name="notes" /></Field>
        <button className="primary-button" type="submit"><Plus size={18} />{t.nav.contacts}</button>
      </form> : <EmptyState title="Read-only contacts" copy="Your role can view contacts but cannot create or edit them." />}
      <div className="grid gap-4 md:grid-cols-2">
        {contacts.length === 0 && <EmptyState title="No contacts yet" copy={permissions.manageContacts ? "Add a buyer, seller, partner, or export contact." : "No contacts are available for this organization."} />}
        {contacts.map((contact) => (
          <div className="panel" key={contact.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{contact.fullName}</h3>
                <p className="text-sm text-slate-500">{formatLabel(contact.type)}</p>
              </div>
              <Users className="text-slate-500" />
            </div>
            <InfoGrid rows={[[t.fields.phone, contact.phone], [t.fields.email, contact.email], [t.fields.address, contact.address], [t.fields.notes, contact.notes]]} />
            <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/40 p-3">
              <p className="flex items-center gap-2 text-sm text-slate-300"><FolderLock size={16} />{t.sections.privateStorage}</p>
              <AttachmentList attachments={attachments.filter((attachment) => attachment.contactId === contact.id)} emptyCopy="No private files or links are attached to this contact." />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Taxes({
  t,
  scoped,
  dateRange,
  setDateRange,
  permissions,
}: {
  t: ReturnType<typeof getDictionary>;
  scoped: AppData;
  dateRange: { start: string; end: string };
  setDateRange: (range: { start: string; end: string }) => void;
  permissions: Permissions;
}) {
  const report = generateTaxReport({ ...scoped, startDate: dateRange.start, endDate: dateRange.end });
  const hasFinancialData =
    scoped.sales.length > 0 ||
    scoped.expenses.length > 0 ||
    scoped.companyCashTransactions.length > 0 ||
    scoped.externalCashTransactions.length > 0;
  async function exportReport(format: "pdf" | "csv" | "json") {
    if (!permissions.manageReports) return;
    const response = await fetch("/api/taxes/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: scoped.activeOrganizationId,
        startDate: dateRange.start,
        endDate: dateRange.end,
        format,
      }),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(result?.message || "Could not export tax report.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = getDownloadFileName(response, `dealer-flow-tax-report.${format}`);
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-400/20 bg-amber-400/8 p-4 text-sm text-amber-100">{t.disclaimer}</div>
      {!hasFinancialData && (
        <EmptyState title="No reportable financial data yet" copy="Tax summaries and exports will become useful after vehicles, expenses, sales, and cash transactions are recorded." />
      )}
      <div className="surface-muted flex flex-wrap gap-2 p-4">
        <input className="control compact-control" type="date" value={dateRange.start} onChange={(event) => setDateRange({ ...dateRange, start: event.target.value })} />
        <input className="control compact-control" type="date" value={dateRange.end} onChange={(event) => setDateRange({ ...dateRange, end: event.target.value })} />
        {[t.reports.monthly, t.reports.quarterly, t.reports.yearly, t.reports.custom].map((label) => <Badge key={label}>{label}</Badge>)}
        {permissions.manageReports ? (
          <>
            <button className="secondary-button" type="button" disabled={!hasFinancialData} onClick={() => exportReport("pdf").catch(showClientError)}>{t.reports.pdf}</button>
            <button className="secondary-button" type="button" disabled={!hasFinancialData} onClick={() => exportReport("csv").catch(showClientError)}>{t.reports.csv}</button>
            <button className="secondary-button" type="button" disabled={!hasFinancialData} onClick={() => exportReport("json").catch(showClientError)}>{t.reports.json}</button>
          </>
        ) : (
          <span className="text-sm text-slate-500">Your role cannot export tax reports.</span>
        )}
      </div>
      <Panel title={t.sections.taxSummary}><InfoGrid rows={Object.entries(report).map(([key, value]) => [key, typeof value === "number" ? money(value) : String(value)])} /></Panel>
    </div>
  );
}

function Backups({
  t,
  organizationId,
  onDownload,
  onUploadR2,
  onVerify,
  onRestoreDryRun,
  permissions,
}: {
  t: ReturnType<typeof getDictionary>;
  organizationId: string;
  onDownload: () => void;
  onUploadR2: () => void;
  onVerify: (file: File) => void;
  onRestoreDryRun: (file: File) => void;
  permissions: Permissions;
}) {
  const [r2Configured, setR2Configured] = useState<boolean | null>(null);
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  useEffect(() => {
    let active = true;
    fetch("/api/backups/r2")
      .then((response) => response.json())
      .then((status: { configured?: boolean }) => {
        if (active) setR2Configured(Boolean(status.configured));
      })
      .catch(() => {
        if (active) setR2Configured(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <Panel title={t.sections.backupStatus}>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="surface-muted p-4">
          <p className="font-medium text-white">{t.backup.localReady}</p>
          {permissions.exportBackups ? <button className="primary-button mt-4" onClick={onDownload}><Download size={18} />{t.actions.downloadBackup}</button> : <p className="mt-3 text-sm text-slate-500">Your role cannot export backups.</p>}
        </div>
        <div className="surface-muted p-4">
          <p className="font-medium text-white">
            {r2Configured === null ? "Checking Cloudflare R2 backup status..." : r2Configured ? t.backup.r2Active : t.backup.r2Inactive}
          </p>
          <p className="mt-3 break-words text-sm text-slate-500">{t.backup.path}: dealer-flow-backups/{organizationId}/{year}/{month}/dealer-flow-backup-{today()}.zip</p>
          <button className="secondary-button mt-4" type="button" onClick={onUploadR2} disabled={!r2Configured || !permissions.manageBackups}>
            <Upload size={18} />
            Upload backup to R2 now
          </button>
        </div>
        <div className="surface-muted p-4 lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="font-medium text-white">Verify backup ZIP</p>
              <p className="mt-2 text-sm text-slate-500">Checks that a downloaded backup contains the required JSON, CSV, metadata, and PDF files.</p>
              <input
                className="control mt-4 w-full"
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onVerify(file);
                  event.currentTarget.value = "";
                }}
              />
            </div>
            <div>
              <p className="font-medium text-white">Restore preparation</p>
              <p className="mt-2 text-sm text-slate-500">Owner-only safety check. It parses a backup, detects conflicts, and creates a pending restore job without writing business records.</p>
              {permissions.manageSettings ? <input
                className="control mt-4 w-full"
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onRestoreDryRun(file);
                  event.currentTarget.value = "";
                }}
              /> : <p className="mt-4 text-sm text-slate-500">Only owners can prepare a restore.</p>}
              <button className="secondary-button mt-3" type="button" disabled title="Actual restore execution requires a reviewed database transaction/RPC before launch.">
                Restore execution disabled
              </button>
              <p className="mt-2 text-xs text-slate-600">Actual restore is intentionally disabled until a transaction-backed restore RPC is reviewed with real backup samples.</p>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SettingsPage({
  t,
  memberships,
  activeOrganization,
  currentUserId,
  onCreate,
  onJoin,
  recurringExpenseTemplates,
  onCreateRecurringExpenseTemplate,
  onUpdateRecurringExpenseTemplate,
  onDeleteRecurringExpenseTemplate,
  onUpdateMemberRole,
  onRemoveMember,
  onRegenerateInvitation,
  onSignOut,
  permissions,
}: {
  t: ReturnType<typeof getDictionary>;
  memberships: AppData["memberships"];
  activeOrganization: AppData["organizations"][number];
  currentUserId?: string;
  onCreate: (formData: FormData) => void;
  onJoin: (formData: FormData) => void;
  recurringExpenseTemplates: RecurringVehicleExpenseTemplate[];
  onCreateRecurringExpenseTemplate: (formData: FormData) => void;
  onUpdateRecurringExpenseTemplate: (formData: FormData) => void;
  onDeleteRecurringExpenseTemplate: (templateId: string) => void;
  onUpdateMemberRole: (formData: FormData) => void;
  onRemoveMember: (membershipId: string) => void;
  onRegenerateInvitation: () => void;
  onSignOut: () => void;
  permissions: Permissions;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title={t.auth.title}>
        <p className="text-sm text-slate-400">{t.auth.copy}</p>
        <button className="secondary-button mt-4" onClick={onSignOut} type="button">Sign out</button>
      </Panel>
      <Panel title={t.onboarding.title}>
        <div className="grid gap-4 lg:grid-cols-2">
          <form className="space-y-3" action={onCreate}><h4 className="font-medium text-white">{t.onboarding.createTitle}</h4><input className="control w-full" name="organizationName" placeholder={t.onboarding.orgName} /><button className="secondary-button" type="submit">{t.actions.createOrganization}</button></form>
          <form className="space-y-3" action={onJoin}><h4 className="font-medium text-white">{t.onboarding.joinTitle}</h4><input className="control w-full" name="inviteCode" placeholder={t.onboarding.inviteCode} /><button className="secondary-button" type="submit">{t.actions.joinOrganization}</button></form>
        </div>
        <p className="mt-4 text-sm text-slate-500">{t.onboarding.roleNote}</p>
      </Panel>
      <Panel title={t.sections.roleManagement}>
        <div className="space-y-3">
          {memberships.length === 0 && <p className="text-sm text-slate-500">No members found.</p>}
          {memberships.map((membership) => (
            <div key={membership.id} className="rounded-md border border-slate-800 bg-slate-950/35 p-3">
              <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto_auto] lg:items-end" action={onUpdateMemberRole}>
                <input type="hidden" name="membershipId" value={membership.id} />
                <Info label="User" value={membership.userId} />
                <Field label="Role">
                  <select className="control w-full" name="role" defaultValue={membership.role} disabled={!permissions.manageRoles}>
                    {ROLES.map((role) => <option key={role} value={role}>{formatLabel(role)}</option>)}
                  </select>
                </Field>
                {permissions.manageRoles && <button className="secondary-button" type="submit">Save role</button>}
                {permissions.manageRoles && membership.userId !== currentUserId && <button className="secondary-button" type="button" onClick={() => onRemoveMember(membership.id)}>Remove</button>}
              </form>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/35 p-3">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Invitation access code</p>
          <p className="mt-2 break-all text-lg font-semibold tracking-[0.08em] text-white">{activeOrganization.inviteCode || "No active code"}</p>
          <p className="mt-2 text-sm text-slate-500">New users who join with this code are added as viewers by default. Regenerating it invalidates the old code.</p>
          {permissions.manageBackups ? (
            <button className="secondary-button mt-3" type="button" onClick={onRegenerateInvitation}>Regenerate access code</button>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Only owner/admin roles can manage invitation codes.</p>
          )}
        </div>
      </Panel>
      <Panel title="Recurring Vehicle Expenses">
        <RecurringExpenseTemplates
          templates={recurringExpenseTemplates}
          canManage={permissions.manageRecurringExpenses}
          onCreate={onCreateRecurringExpenseTemplate}
          onUpdate={onUpdateRecurringExpenseTemplate}
          onDelete={onDeleteRecurringExpenseTemplate}
        />
      </Panel>
      <Panel title={t.marketSnap.dataAiSettings}>
        <div className="space-y-3 text-sm text-slate-400">
          <p>{t.marketSnap.dataAiPurpose}</p>
          <InfoGrid rows={[
            [t.marketSnap.modelImprovement, t.marketSnap.enabledByTerms],
            [t.marketSnap.dataUsed, t.marketSnap.anonymizedDataUsed],
            [t.marketSnap.dataExcluded, t.marketSnap.personalDataExcluded],
            [t.marketSnap.retention, t.marketSnap.retentionSummary],
          ]} />
        </div>
      </Panel>
      <DeepCaptureSettingsPanel organizationId={activeOrganization.id} permissions={permissions} />
      <Panel title={t.sections.privateStorage}><p className="flex items-center gap-2 text-slate-300"><Lock size={18} />{activeOrganization.name}</p><p className="mt-3 text-sm text-slate-500">{t.backup.r2Inactive}</p></Panel>
    </div>
  );
}

type DeepCaptureStatusPayload = {
  consentStatus?: string;
  deepCaptureEnabled?: boolean;
  deepCaptureConsentVersion?: string;
  deepCaptureTermsVersion?: string;
  deepCapturePrivacyVersion?: string;
  deepCaptureConsentAcceptedAt?: string;
  deepCaptureConsentAcceptedBy?: string;
  captureScopes?: string[];
  modelImprovementEnabled?: boolean;
  allowedDomains?: string[];
  allowedHosts?: string[];
  allowedDataCategories?: string[];
  deniedDataCategories?: string[];
  retentionSummary?: Record<string, string>;
  captureSummary?: {
    observationCount?: number;
    outcomeCount?: number;
    eligibleUnsavedMarketListingCount?: number;
    latestObservations?: Array<Record<string, unknown>>;
    latestOutcomes?: Array<Record<string, unknown>>;
  };
  events?: Array<Record<string, unknown>>;
};

const deepCaptureScopeLabels: Record<string, string> = {
  dom_visible: "visible DOM extraction",
  safe_read_only_expansion: "safe read-only section expansion",
  network_response_observation: "network response observation",
  fee_outcome_capture: "fee/outcome capture",
  post_sale_outcome_capture: "post-sale outcome capture",
  media_url_capture: "media URL capture",
  model_improvement: "model improvement",
};

function DeepCaptureSettingsPanel({ organizationId, permissions }: { organizationId: string; permissions: Permissions }) {
  const [status, setStatus] = useState<DeepCaptureStatusPayload | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState("");
  const canManage = permissions.manageSettings || permissions.manageBackups;

  const requestDeepCapture = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch("/api/market-snap/deep-capture-consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId, action, source: "web_app_settings", ...extra }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(String(payload.message ?? "Deep Capture request failed."));
    return payload;
  }, [organizationId]);

  const refreshStatus = useCallback(async () => {
    try {
      const payload = await requestDeepCapture("status");
      setStatus(payload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Deep Capture status.");
    }
  }, [requestDeepCapture]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      requestDeepCapture("status")
        .then((payload) => {
          if (!cancelled) setStatus(payload);
        })
        .catch((error) => {
          if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load Deep Capture status.");
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [requestDeepCapture]);

  async function runAction(action: string, successMessage: string, extra: Record<string, unknown> = {}) {
    setMessage("");
    setWorking(action);
    try {
      const payload = await requestDeepCapture(action, extra);
      if (action === "export_audit") downloadJson("dealer-flow-deep-capture-audit.json", payload.audit ?? payload);
      setMessage(successMessage);
      await refreshStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deep Capture request failed.");
    } finally {
      setWorking("");
    }
  }

  const scopes = status?.captureScopes ?? [];
  const scopeRows: Array<[string, string]> = Object.entries(deepCaptureScopeLabels).map(([scope, label]) => [label, scopes.includes(scope) ? "Enabled" : "Off"]);
  const captureSummary = status?.captureSummary ?? {};
  const retentionSummary = status?.retentionSummary ?? {};

  return (
    <Panel title="Market Snap / Deep Capture">
      <div className="space-y-4 text-sm text-slate-400">
        <div className="space-y-2">
          <p>Deep Capture improves accuracy by reading structured vehicle/listing data already loaded in your browser session.</p>
          <p>It does not collect passwords, cookies, authorization headers, or unrelated browsing data.</p>
          <p>You can turn it off anytime.</p>
          <p>Model improvement is separate.</p>
        </div>
        {message && <div className="message-banner border border-amber-300/20 bg-amber-300/10 text-amber-100">{message}</div>}
        <InfoGrid rows={[
          ["Status", deepCaptureStatusLabel(status?.consentStatus)],
          ["Consent version", status?.deepCaptureConsentVersion ?? "-"],
          ["Terms version", status?.deepCaptureTermsVersion ?? "-"],
          ["Privacy version", status?.deepCapturePrivacyVersion ?? "-"],
          ["Accepted by", status?.deepCaptureConsentAcceptedBy ?? "-"],
          ["Accepted at", status?.deepCaptureConsentAcceptedAt ?? "-"],
          ["Allowed domains", status?.allowedDomains?.join(", ") || "openlane.ca, openlane.com"],
          ["Allowed hosts", status?.allowedHosts?.join(", ") || "app.openlane.ca"],
          ["Data categories collected", status?.allowedDataCategories?.join(", ") || "visible vehicle/listing data, capped evidence"],
          ["Denied categories", status?.deniedDataCategories?.join(", ") || "passwords, cookies, authorization headers, unrelated browsing data"],
        ]} />
        <InfoGrid rows={scopeRows} />
        <InfoGrid rows={[
          ["OpenLane observations", String(captureSummary.observationCount ?? 0)],
          ["OpenLane outcomes", String(captureSummary.outcomeCount ?? 0)],
          ["Eligible unsaved captures", String(captureSummary.eligibleUnsavedMarketListingCount ?? 0)],
          ["Temporary capture retention", retentionSummary.temporaryCaptures ?? "Unsaved captures can expire or be deleted when eligible."],
          ["Saved business records", retentionSummary.businessRecords ?? "Saved Deal Radar listings remain business records."],
          ["Evidence minimization", retentionSummary.minimizedEvidence ?? "Stored evidence is capped and redacted."],
        ]} />
        <div className="flex flex-wrap gap-2">
          <a className="secondary-button" href="/terms" target="_blank" rel="noreferrer">Terms</a>
          <a className="secondary-button" href="/privacy" target="_blank" rel="noreferrer">Privacy</a>
          <button
            className="primary-button"
            type="button"
            disabled={!canManage || Boolean(working)}
            onClick={() => runAction("accept", "Deep Capture enabled.", { captureScopes: Object.keys(deepCaptureScopeLabels).filter((scope) => scope !== "model_improvement"), modelImprovementOptIn: false })}
          >
            <ShieldCheck size={16} />
            {working === "accept" ? "Working..." : "Enable Deep Capture"}
          </button>
          <button className="secondary-button" type="button" disabled={!canManage || Boolean(working)} onClick={() => runAction("withdraw", "Deep Capture withdrawn.")}>
            <X size={16} />
            Withdraw Deep Capture
          </button>
          <button className="secondary-button" type="button" disabled={!canManage || Boolean(working) || !status?.modelImprovementEnabled} onClick={() => runAction("disable_model_improvement", "Model improvement disabled.")}>
            <ShieldCheck size={16} />
            Disable Model Improvement
          </button>
          <button className="secondary-button" type="button" disabled={!canManage || Boolean(working)} onClick={() => runAction("export_audit", "Deep Capture audit exported.")}>
            <Download size={16} />
            Export Deep Capture Audit
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!canManage || Boolean(working)}
            onClick={() => {
              if (window.confirm("Delete eligible unsaved temporary Deep Capture data? Saved Deal Radar listings and business records are not deleted.")) {
                runAction("delete_eligible_captures", "Eligible unsaved capture data deleted or sanitized.");
              }
            }}
          >
            <Trash2 size={16} />
            Delete eligible unsaved capture data
          </button>
        </div>
        {!canManage && <p className="text-xs text-slate-500">Only owners/admins can enable, withdraw, export, or delete eligible Deep Capture data.</p>}
      </div>
    </Panel>
  );
}

function deepCaptureStatusLabel(status?: string) {
  if (status === "active") return "Active";
  if (status === "withdrawn") return "Withdrawn";
  if (status === "requires_renewal") return "Requires renewal";
  return "Not enabled";
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function MarketSnapDashboard({
  t,
  scoped,
  dateRange,
  setDateRange,
  navigate,
  permissions,
}: {
  t: ReturnType<typeof getDictionary>;
  scoped: AppData;
  dateRange: { start: string; end: string };
  setDateRange: (range: { start: string; end: string }) => void;
  navigate: (view: View, options?: { mode?: VehicleMode; vehicleId?: string; tab?: VehicleTab }) => void;
  permissions: Permissions;
}) {
  const activeVehicles = scoped.vehicles.filter(shouldRefreshVehicle);
  const valuations = activeVehicles.map((vehicle) => runComparableEstimator({
    organizationId: vehicle.organizationId,
    vehicle,
    expenses: scoped.expenses,
    comparables: [],
  }));
  const totalRetail = valuations.reduce((sum, valuation) => sum + valuation.estimatedRetailMarketValue, 0);
  const totalCostBasis = valuations.reduce((sum, valuation) => sum + valuation.currentCostBasis, 0);
  const potentialGrossProfit = valuations.reduce((sum, valuation) => sum + valuation.potentialGrossProfit, 0);
  const averageDealScore = averageScore(valuations.map((valuation) => valuation.dealScore));
  const averageProfitScore = averageScore(valuations.map((valuation) => valuation.profitScore));
  const averageRiskScore = averageScore(valuations.map((valuation) => valuation.riskScore));
  const lowConfidence = valuations.filter((valuation) => valuation.confidenceScore < 45).length;
  const highRisk = valuations.filter((valuation) => valuation.riskScore >= 70).length;
  const chartData = buildMonthlyBuySellSeries(scoped, dateRange);
  const organizationId = scoped.activeOrganizationId;
  const [sourceName, setSourceName] = useState("Authorized listing");
  const [sourceType, setSourceType] = useState("retail");
  const [sourceUrl, setSourceUrl] = useState("");
  const [permissionBasis, setPermissionBasis] = useState("User provided visible listing HTML for authorized Market Snap analysis.");
  const [html, setHtml] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState("");
  const [extractedListing, setExtractedListing] = useState<Record<string, unknown> | null>(null);
  const [extractionMeta, setExtractionMeta] = useState<Record<string, unknown> | null>(null);
  const [extractedValuation, setExtractedValuation] = useState<Record<string, unknown> | null>(null);

  async function extractListing() {
    setExtracting(true);
    setExtractionMessage("");
    setExtractedListing(null);
    setExtractedValuation(null);
    try {
      if (/^https?:\/\//i.test(html.trim())) {
        throw new Error("Paste the visible listing HTML here, not only the URL. For OpenLane login pages, use the Chrome/Brave extension so it can capture the HTML you are authorized to view.");
      }
      const response = await fetch("/api/market-snap/extract-authorized-listing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, html, sourceName, sourceType, sourceUrl, permissionBasis, robotsAllowed: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(String(payload.message ?? payload.warnings?.[0] ?? "Extraction failed."));
      setExtractedListing(payload.listing ?? null);
      setExtractionMeta(payload);
      setExtractionMessage("Listing extracted. Review the preview before analysis or saving.");
    } catch (error) {
      setExtractionMessage(error instanceof Error ? error.message : "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  }

  async function analyzeExtractedListing() {
    if (!extractedListing) return;
    setExtracting(true);
    setExtractionMessage("");
    try {
      const response = await fetch("/api/market-snap/analyze-listing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...extractedListing, organizationId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(String(payload.message ?? "Analysis failed."));
      setExtractedValuation(payload.valuation ?? null);
      setExtractionMessage("Market Snap analysis complete.");
    } catch (error) {
      setExtractionMessage(error instanceof Error ? error.message : "Analysis failed.");
    } finally {
      setExtracting(false);
    }
  }

  async function saveExtractedListing() {
    if (!extractedListing) return;
    setExtracting(true);
    setExtractionMessage("");
    try {
      const response = await fetch("/api/market-snap/save-listing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, listing: extractedListing, valuation: extractedValuation ?? undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(String(payload.message ?? "Could not save to Deal Radar."));
      setExtractionMessage("Saved to Deal Radar.");
    } catch (error) {
      setExtractionMessage(error instanceof Error ? error.message : "Could not save to Deal Radar.");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Panel title="Extract listing with Scrapling">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Source name"><input className="control w-full" value={sourceName} onChange={(event) => setSourceName(event.target.value)} /></Field>
              <Field label="Source type">
                <select className="control w-full" value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
                  <option value="retail">Retail</option>
                  <option value="auction">Auction</option>
                  <option value="salvage">Salvage</option>
                  <option value="wholesale">Wholesale</option>
                  <option value="extension">Extension</option>
                </select>
              </Field>
            </div>
            <Field label="Source URL"><input className="control w-full" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://..." /></Field>
            <Field label="Permission basis"><input className="control w-full" value={permissionBasis} onChange={(event) => setPermissionBasis(event.target.value)} /></Field>
            <Field label="Visible listing HTML"><textarea className="control min-h-44 w-full resize-y" value={html} onChange={(event) => setHtml(event.target.value)} placeholder="Paste the visible listing HTML here. For OpenLane pages behind login, use the browser extension instead of pasting only the URL." /></Field>
            <div className="flex flex-wrap gap-2">
              <button className="primary-button" type="button" disabled={extracting || !html.trim()} onClick={extractListing}>{extracting ? "Working..." : "Extract listing"}</button>
              <button className="secondary-button" type="button" disabled={!extractedListing || extracting} onClick={analyzeExtractedListing}>Analyze listing</button>
              <button className="secondary-button" type="button" disabled={!extractedListing || extracting} onClick={saveExtractedListing}>Save to Deal Radar</button>
            </div>
            {extractionMessage && <p className="text-sm text-slate-300">{extractionMessage}</p>}
          </div>
          <div className="surface-muted p-4">
            {!extractedListing ? (
              <EmptyState title="No extracted listing yet" copy="Paste authorized visible listing HTML, then extract a preview before analysis or saving." />
            ) : (
              <div className="space-y-3">
                <p className="text-base font-semibold text-white">{String(extractedListing.title ?? "Untitled listing")}</p>
                <InfoGrid rows={[
                  ["Vehicle", [extractedListing.year, extractedListing.make, extractedListing.model, extractedListing.trim].filter(Boolean).join(" ") || "-"],
                  ["Mileage", extractedListing.mileageKm ? `${extractedListing.mileageKm} km` : "-"],
                  ["Price", money(Number(extractedListing.listedPrice ?? extractedListing.auctionHammerPrice ?? 0))],
                  ["Location", [extractedListing.location, extractedListing.province].filter(Boolean).join(", ") || "-"],
                  ["Title status", String(extractedListing.titleStatus ?? "-")],
                  ["Images", String(extractedListing.imageCount ?? 0)],
                  ["Quality", String(extractionMeta?.extractionQualityScore ?? "-")],
                  ["Policy", String(extractionMeta?.policyDecision ?? "-")],
                ]} />
                <Info label="Warnings" value={Array.isArray(extractionMeta?.warnings) && extractionMeta.warnings.length ? extractionMeta.warnings.join("; ") : "-"} />
                <Info label="Missing fields" value={Array.isArray(extractionMeta?.missingFields) && extractionMeta.missingFields.length ? extractionMeta.missingFields.join(", ") : "-"} />
                {extractedValuation && <RecommendationBadgeView badge={String(extractedValuation.recommendationBadge ?? "Negotiate") as never} />}
              </div>
            )}
          </div>
        </div>
      </Panel>
      <div className="surface-muted flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-slate-400">{t.marketSnap.subtitle}</p>
          <p className="text-base font-medium text-slate-100">{dateRange.start} - {dateRange.end}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className="control compact-control" type="date" value={dateRange.start} onChange={(event) => setDateRange({ ...dateRange, start: event.target.value })} />
          <input className="control compact-control" type="date" value={dateRange.end} onChange={(event) => setDateRange({ ...dateRange, end: event.target.value })} />
          {permissions.manageVehicles && (
            <button className="primary-button" onClick={() => navigate("dealRadar")}>
              <Search size={18} />
              {t.nav.dealRadar}
            </button>
          )}
        </div>
      </div>
      <div className="message-banner border border-amber-300/20 bg-amber-300/10 text-amber-100">{t.marketSnap.estimateDisclaimer}</div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t.marketSnap.totalRetailValue} value={money(totalRetail)} icon={<BarChart3 size={18} />} />
        <MetricCard label={t.marketSnap.totalCostBasis} value={money(totalCostBasis)} icon={<Receipt size={18} />} />
        <MetricCard label={t.marketSnap.potentialGrossProfit} value={money(potentialGrossProfit)} icon={<LineChart size={18} />} />
        <MetricCard label={t.marketSnap.averageDealScore} value={String(averageDealScore)} icon={<Activity size={18} />} />
        <MetricCard label={t.marketSnap.averageProfitScore} value={String(averageProfitScore)} icon={<Banknote size={18} />} />
        <MetricCard label={t.marketSnap.averageRiskScore} value={String(averageRiskScore)} icon={<ShieldCheck size={18} />} />
        <MetricCard label={t.marketSnap.lowConfidenceValuations} value={String(lowConfidence)} icon={<Search size={18} />} />
        <MetricCard label={t.marketSnap.highRiskVehicles} value={String(highRisk)} icon={<Archive size={18} />} />
      </div>
      <Panel title={t.marketSnap.buySellChart}>
        <ChartPanel title={t.marketSnap.buySellChart} data={chartData.map((row) => ({ label: row.label, value: row.averageSellPrice - row.averageBuyPrice }))} type="area" summary={t.marketSnap.averageSpread} />
      </Panel>
      <Panel title={t.marketSnap.inventoryValuations}>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                {[
                  t.marketSnap.vehicle,
                  t.fields.status,
                  t.marketSnap.costBasis,
                  t.fields.listedPrice,
                  t.marketSnap.retailValue,
                  t.marketSnap.wholesaleBuyValue,
                  t.marketSnap.wholesaleSellValue,
                  t.marketSnap.suggestedListingPrice,
                  t.marketSnap.quickSalePrice,
                  t.marketSnap.maxPurchasePrice,
                  t.marketSnap.potentialGrossProfit,
                  t.marketSnap.potentialNetProfit,
                  t.marketSnap.dealScore,
                  t.marketSnap.profitScore,
                  t.marketSnap.riskScore,
                  t.marketSnap.confidence,
                  t.marketSnap.comparableCount,
                  t.marketSnap.warnings,
                  t.marketSnap.missingData,
                  t.marketSnap.recommendation,
                ].map((header) => <th key={header}>{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {valuations.length === 0 && (
                <tr><td colSpan={20}><EmptyState title={t.marketSnap.noValuations} copy={t.marketSnap.noValuationsCopy} /></td></tr>
              )}
              {valuations.map((valuation) => {
                const vehicle = activeVehicles.find((item) => item.id === valuation.vehicleId);
                return (
                  <tr key={vehicle?.id ?? valuation.valuationDate} onClick={() => vehicle && navigate("vehicles", { mode: "detail", vehicleId: vehicle.id, tab: "overview" })}>
                    <td>{vehicleLabel(vehicle)}</td>
                    <td>{vehicle ? <Badge>{t.status[vehicle.status]}</Badge> : "-"}</td>
                    <td>{money(valuation.currentCostBasis)}</td>
                    <td>{money(vehicle?.listedPrice ?? 0)}</td>
                    <td>{money(valuation.estimatedRetailMarketValue)}</td>
                    <td>{money(valuation.estimatedWholesaleBuyValue)}</td>
                    <td>{money(valuation.estimatedWholesaleSellValue)}</td>
                    <td>{money(valuation.suggestedListingPrice)}</td>
                    <td>{money(valuation.quickSalePrice)}</td>
                    <td>{money(valuation.maxRecommendedPurchasePrice)}</td>
                    <td>{money(valuation.potentialGrossProfit)}</td>
                    <td>{money(valuation.potentialNetProfit)}</td>
                    <td>{valuation.dealScore}</td>
                    <td>{valuation.profitScore}</td>
                    <td>{valuation.riskScore}</td>
                    <td>{valuation.confidenceScore}</td>
                    <td>{valuation.comparableCount}</td>
                    <td>{valuation.warnings.length}</td>
                    <td>{valuation.missingData.length}</td>
                    <td><RecommendationBadgeView badge={valuation.recommendationBadge} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function DealRadarPage({
  t,
  organizationId,
  navigate,
  permissions,
  onVehiclePrefill,
}: {
  t: ReturnType<typeof getDictionary>;
  organizationId: string;
  navigate: (view: View, options?: { mode?: VehicleMode; vehicleId?: string; tab?: VehicleTab }) => void;
  permissions: Permissions;
  onVehiclePrefill: (prefill: VehiclePrefill) => void;
}) {
  const [mode, setMode] = useState<"cards" | "table">("table");
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [selectedItem, setSelectedItem] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/market-snap/deal-radar?organizationId=${encodeURIComponent(organizationId)}&pageSize=50`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Deal Radar is waiting for the Market Snap migration.")))
      .then((payload: { items?: Array<Record<string, unknown>> }) => {
        if (!cancelled) setItems(payload.items ?? []);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Deal Radar data is not available yet.");
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  async function removeListing(id: string) {
    setMessage("");
    const response = await fetch(`/api/market-snap/deal-radar/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      setMessage(String(payload.message ?? "Could not remove listing."));
      return;
    }
    setItems((current) => current.filter((item) => String(item.id) !== id));
    if (String(selectedItem?.id ?? "") === id) setSelectedItem(null);
  }

  async function convertListing(id: string) {
    setMessage("");
    const response = await fetch(`/api/market-snap/deal-radar/${encodeURIComponent(id)}/convert-to-inventory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      setMessage(String(payload.message ?? "Could not prepare inventory prefill."));
      return;
    }
    onVehiclePrefill((payload.prefill ?? {}) as VehiclePrefill);
    navigate("vehicles", { mode: "new" });
  }

  return (
    <div className="space-y-4">
      {message && <div className="message-banner border border-amber-300/20 bg-amber-300/10 text-amber-100">{message}</div>}
      <div className="message-banner border border-amber-300/20 bg-amber-300/10 text-amber-100">{t.marketSnap.estimateDisclaimer}</div>
      <div className="surface-muted flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-slate-400">{t.marketSnap.dealRadarSubtitle}</p>
          <p className="text-base font-medium text-slate-100">{t.marketSnap.savedOpportunities}: {items.length}</p>
        </div>
        <div className="segmented">
          <button className={mode === "table" ? "segmented-active" : ""} onClick={() => setMode("table")}>{t.inventory.tableView}</button>
          <button className={mode === "cards" ? "segmented-active" : ""} onClick={() => setMode("cards")}>{t.inventory.cardView}</button>
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState title={t.marketSnap.noSavedListings} copy={t.marketSnap.noSavedListingsCopy} />
      ) : mode === "cards" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => <DealRadarCard key={String(item.id)} t={t} item={item} canManage={permissions.manageVehicles} onView={() => setSelectedItem(item)} onRemove={() => removeListing(String(item.id))} onConvert={() => convertListing(String(item.id))} />)}
        </div>
      ) : (
        <Panel title={t.nav.dealRadar}>
          <DealRadarTable t={t} items={items} canManage={permissions.manageVehicles} onView={setSelectedItem} onRemove={(item) => removeListing(String(item.id))} onConvert={(item) => convertListing(String(item.id))} />
        </Panel>
      )}
      {selectedItem && (
        <Panel title={t.marketSnap.viewAnalysis}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-white">{dealRadarLabel(selectedItem)}</p>
              <p className="mt-1 text-sm text-slate-400">{String(selectedItem.listing_url ?? selectedItem.source_name ?? "-")}</p>
            </div>
            <button className="secondary-button" onClick={() => setSelectedItem(null)}><X size={16} />Close</button>
          </div>
          <DealRadarAnalysis t={t} item={selectedItem} />
        </Panel>
      )}
    </div>
  );
}

function MarketDataAdminPage({ t, organizationId, permissions }: { t: ReturnType<typeof getDictionary>; organizationId: string; permissions: Permissions }) {
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<Array<Record<string, unknown>>>([]);
  const [jobs, setJobs] = useState<Array<Record<string, unknown>>>([]);
  const [jsonImport, setJsonImport] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!permissions.manageBackups) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/market-snap/admin/data-quality?organizationId=${encodeURIComponent(organizationId)}`).then((response) => response.ok ? response.json() : Promise.reject(new Error("Market Data tables are waiting for the migration."))),
      fetch(`/api/market-snap/admin/sources?organizationId=${encodeURIComponent(organizationId)}`).then((response) => response.ok ? response.json() : Promise.reject(new Error("Market sources are not available yet."))),
      fetch(`/api/market-snap/admin/jobs?organizationId=${encodeURIComponent(organizationId)}`).then((response) => response.ok ? response.json() : Promise.reject(new Error("Market jobs are not available yet."))),
    ])
      .then(([quality, sourcePayload, jobPayload]: Array<{ metrics?: Record<string, number>; items?: Array<Record<string, unknown>> }>) => {
        if (!cancelled) {
          setMetrics(quality.metrics ?? {});
          setSources(sourcePayload.items ?? []);
          setJobs(jobPayload.items ?? []);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Market Data is not available yet.");
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, permissions.manageBackups]);

  if (!permissions.manageBackups) {
    return <EmptyState title={t.marketSnap.adminOnly} copy={t.marketSnap.adminOnlyCopy} />;
  }

  async function importJson() {
    setMessage("");
    let rows: unknown;
    try {
      rows = JSON.parse(jsonImport);
    } catch {
      setMessage("JSON import must be an array of listing objects.");
      return;
    }
    const response = await fetch("/api/market-snap/admin/import-json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId, sourceName: "Manual JSON Import", rows }),
    });
    const payload = await response.json().catch(() => ({}));
    setMessage(response.ok && payload.ok ? `Imported ${payload.imported ?? 0} listings.` : String(payload.message ?? "Import failed."));
  }

  async function trainCandidate() {
    setMessage("");
    const response = await fetch("/api/market-snap/admin/train-candidate-model", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    const payload = await response.json().catch(() => ({}));
    setMessage(response.ok && payload.ok ? `Candidate training queued: ${payload.trainingRunId ?? "pending"}` : String(payload.message ?? "Could not queue training."));
  }

  return (
    <div className="space-y-4">
      {message && <div className="message-banner border border-amber-300/20 bg-amber-300/10 text-amber-100">{message}</div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t.marketSnap.totalListings} value={String(metrics.totalListings ?? 0)} icon={<DatabaseIcon />} />
        <MetricCard label={t.marketSnap.validListings} value={String(metrics.validListings ?? 0)} icon={<ShieldCheck size={18} />} />
        <MetricCard label={t.marketSnap.invalidListings} value={String(metrics.invalidListings ?? 0)} icon={<Archive size={18} />} />
        <MetricCard label={t.marketSnap.duplicateListings} value={String(metrics.duplicateListings ?? 0)} icon={<Search size={18} />} />
        <MetricCard label={t.marketSnap.missingMileage} value={String(metrics.missingMileageCount ?? 0)} icon={<Search size={18} />} />
        <MetricCard label={t.marketSnap.missingPrice} value={String(metrics.missingPriceCount ?? 0)} icon={<Receipt size={18} />} />
        <MetricCard label={t.marketSnap.usablePhotoFeatures} value={String(metrics.usablePhotoFeatureCount ?? 0)} icon={<Car size={18} />} />
        <MetricCard label={t.marketSnap.averageFreshness} value={String(metrics.averageDataFreshness ?? 0)} icon={<Activity size={18} />} />
        <MetricCard label={t.marketSnap.averageDataQuality} value={String(metrics.averageDataQuality ?? 0)} icon={<Activity size={18} />} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t.marketSnap.sources}>
          <p className="text-sm text-slate-400">{t.marketSnap.sourcesCopy}</p>
          <Ledger emptyTitle={t.marketSnap.noSources} emptyCopy={t.marketSnap.noSourcesCopy} rows={sources.map((source) => [
            String(source.name ?? source.source_name ?? "-"),
            String(source.source_type ?? "-"),
            String(source.status ?? "-"),
            String(source.last_sync_at ?? "-"),
          ])} />
        </Panel>
        <Panel title={t.marketSnap.jobs}>
          <div className="mb-3 flex flex-wrap gap-2">
            <button className="secondary-button" type="button" onClick={trainCandidate}>{t.marketSnap.trainCandidate}</button>
          </div>
          <Ledger emptyTitle={t.marketSnap.noJobs} emptyCopy={t.marketSnap.jobsCopy} rows={jobs.map((job) => [
            String(job.job_type ?? "-"),
            String(job.status ?? "-"),
            String(job.failed_records ?? 0),
            String(job.created_at ?? "-"),
          ])} />
        </Panel>
        <Panel title={t.marketSnap.retention}><p className="text-sm text-slate-400">{t.marketSnap.retentionSummary}</p></Panel>
        <Panel title={t.marketSnap.imports}>
          <p className="text-sm text-slate-400">{t.marketSnap.importsCopy}</p>
          <textarea
            className="control mt-3 min-h-32 w-full"
            value={jsonImport}
            onChange={(event) => setJsonImport(event.target.value)}
            placeholder='[{"sourceName":"Manual Import","year":2020,"make":"Toyota","model":"Corolla","listedPrice":18000}]'
          />
          <button className="primary-button mt-3" type="button" onClick={importJson}>{t.marketSnap.importJson}</button>
        </Panel>
      </div>
    </div>
  );
}

function DealRadarTable({ t, items, canManage, onView, onRemove, onConvert }: { t: ReturnType<typeof getDictionary>; items: Array<Record<string, unknown>>; canManage: boolean; onView: (item: Record<string, unknown>) => void; onRemove: (item: Record<string, unknown>) => void; onConvert: (item: Record<string, unknown>) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {[t.marketSnap.vehicle, t.marketSnap.source, "Media", t.fields.listedPrice, t.marketSnap.retailValue, t.marketSnap.maxBid, t.marketSnap.potentialProfit, t.marketSnap.confidence, t.marketSnap.comparableCount, t.marketSnap.warnings, t.marketSnap.recommendation, t.marketSnap.actions].map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={String(item.id)}>
              <td>{dealRadarLabel(item)}</td>
              <td>{String(item.source_name ?? "-")}</td>
              <td>{dealRadarMediaSummary(item)}</td>
              <td>{money(Number(item.listed_price ?? 0))}</td>
              <td>{money(Number((item.valuation_snapshot as Record<string, unknown> | undefined)?.estimatedRetailMarketValue ?? 0))}</td>
              <td>{money(Number((item.valuation_snapshot as Record<string, unknown> | undefined)?.maxRecommendedBid ?? 0))}</td>
              <td>{money(Number(item.potential_profit ?? 0))}</td>
              <td>{String((item.valuation_snapshot as Record<string, unknown> | undefined)?.confidenceScore ?? item.confidence_score ?? 0)}</td>
              <td>{String((item.valuation_snapshot as Record<string, unknown> | undefined)?.comparableCount ?? 0)}</td>
              <td>{Array.isArray((item.valuation_snapshot as Record<string, unknown> | undefined)?.warnings) ? ((item.valuation_snapshot as Record<string, unknown>).warnings as unknown[]).length : 0}</td>
              <td><RecommendationBadgeView badge={String(item.recommendation_badge ?? "Negotiate")} /></td>
              <td>
                <div className="flex flex-wrap gap-2">
                  <button className="secondary-button" type="button" onClick={() => onView(item)}>{t.marketSnap.viewAnalysis}</button>
                  {canManage && <button className="secondary-button" type="button" onClick={() => onConvert(item)}>{t.marketSnap.convertToInventory}</button>}
                  {canManage && <button className="danger-button" type="button" onClick={() => onRemove(item)}>{t.marketSnap.remove}</button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DealRadarCard({ t, item, canManage, onView, onRemove, onConvert }: { t: ReturnType<typeof getDictionary>; item: Record<string, unknown>; canManage: boolean; onView: () => void; onRemove: () => void; onConvert: () => void }) {
  return (
    <div className="vehicle-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-white">{dealRadarLabel(item)}</p>
          <p className="mt-1 text-sm text-slate-500">{String(item.source_name ?? "-")}</p>
        </div>
        <RecommendationBadgeView badge={String(item.recommendation_badge ?? "Negotiate")} />
      </div>
      <InfoGrid rows={[
        [t.fields.listedPrice, money(Number(item.listed_price ?? 0))],
        [t.marketSnap.potentialProfit, money(Number(item.potential_profit ?? 0))],
        [t.marketSnap.dealScore, String(item.deal_score ?? 0)],
        [t.marketSnap.riskScore, String(item.risk_score ?? 0)],
        ["Carfax", dealRadarCarfaxLabel(item)],
        ["Media", dealRadarMediaSummary(item)],
      ]} />
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="secondary-button" type="button" onClick={onView}>{t.marketSnap.viewAnalysis}</button>
        {canManage && <button className="secondary-button" type="button" onClick={onConvert}>{t.marketSnap.convertToInventory}</button>}
        {canManage && <button className="danger-button" type="button" onClick={onRemove}>{t.marketSnap.remove}</button>}
      </div>
    </div>
  );
}

function DealRadarAnalysis({ t, item }: { t: ReturnType<typeof getDictionary>; item: Record<string, unknown> }) {
  const valuation = (item.valuation_snapshot as Record<string, unknown> | null) ?? {};
  const warnings = Array.isArray(valuation.warnings) ? valuation.warnings : [];
  const missing = Array.isArray(valuation.missingData) ? valuation.missingData : [];
  const openlaneMetadata = dealRadarOpenLaneMetadata(item);
  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <InfoGrid rows={[
        [t.marketSnap.retailValue, money(Number(valuation.estimatedRetailMarketValue ?? 0))],
        [t.marketSnap.wholesaleBuyValue, money(Number(valuation.estimatedWholesaleBuyValue ?? 0))],
        [t.marketSnap.wholesaleSellValue, money(Number(valuation.estimatedWholesaleSellValue ?? 0))],
        [t.marketSnap.maxBid, money(Number(valuation.maxRecommendedBid ?? 0))],
        [t.marketSnap.potentialProfit, money(Number(valuation.potentialNetProfit ?? item.potential_profit ?? 0))],
        [t.marketSnap.confidence, String(valuation.confidenceScore ?? item.confidence_score ?? 0)],
        ["Open listing", String(item.listing_url ?? "-")],
        ["Carfax", dealRadarCarfaxLabel(item)],
        ["Photos", String(dealRadarArrayCount(item.photos_json))],
        ["Videos", String(dealRadarArrayCount(item.videos_json))],
        ["Run / lane / lot", [openlaneMetadata.runNumber, openlaneMetadata.lane, openlaneMetadata.lotNumber].filter(Boolean).join(" / ") || "-"],
        ["Stock", String(openlaneMetadata.stockNumber ?? "-")],
      ]} />
      <div className="rounded-md border border-slate-800 bg-slate-950/35 p-4">
        <p className="text-sm font-semibold text-white">{t.marketSnap.explanation}</p>
        <p className="mt-2 text-sm text-slate-400">{String(valuation.explanation ?? "-")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Info label={t.marketSnap.warnings} value={warnings.length ? warnings.join("; ") : "-"} />
          <Info label={t.marketSnap.missingData} value={missing.length ? missing.join(", ") : "-"} />
        </div>
      </div>
    </div>
  );
}

function dealRadarArrayCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function dealRadarCarfaxLabel(item: Record<string, unknown>) {
  if (item.carfax_url) return "Link visible";
  return item.carfax_available ? "Visible" : "-";
}

function dealRadarMediaSummary(item: Record<string, unknown>) {
  return `${dealRadarArrayCount(item.photos_json)} photos / ${dealRadarArrayCount(item.videos_json)} videos`;
}

function dealRadarOpenLaneMetadata(item: Record<string, unknown>) {
  const metadata = item.openlane_metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</span>
        <span className="text-slate-500">{icon}</span>
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight text-white">{value}</p>
    </div>
  );
}

function RecommendationBadgeView({ badge }: { badge: string }) {
  const tone = badge === "Strong Buy" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : badge === "High Risk" || badge === "Avoid" ? "border-rose-300/20 bg-rose-300/10 text-rose-100" : "border-amber-300/20 bg-amber-300/10 text-amber-100";
  return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${tone}`}>{badge}</span>;
}

function DatabaseIcon() {
  return <FolderLock size={18} />;
}

function RecurringExpenseTemplates({
  templates,
  canManage,
  onCreate,
  onUpdate,
  onDelete,
}: {
  templates: RecurringVehicleExpenseTemplate[];
  canManage: boolean;
  onCreate: (formData: FormData) => void;
  onUpdate: (formData: FormData) => void;
  onDelete: (templateId: string) => void;
}) {
  const activeTemplates = templates.filter((template) => !template.deletedAt);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Templates marked auto-apply are added to every new vehicle. Historical Commission Plaque expenses stay as normal expenses.
      </p>
      {canManage ? (
        <form className="grid gap-3 lg:grid-cols-2" action={onCreate}>
          <Field label="Name"><input className="control w-full" name="name" placeholder="Plate commission" required /></Field>
          <Field label="Category"><TemplateCategorySelect /></Field>
          <Field label="Default amount before tax"><input className="control w-full" name="amountBeforeTax" type="number" min="0" step="0.01" required /></Field>
          <Field label="Tax behavior"><TemplateTaxBehaviorSelect /></Field>
          <Field label="Custom tax rate"><input className="control w-full" name="customTaxRate" type="number" min="0" max="1" step="0.0001" placeholder="0.14975" /></Field>
          <Field label="Default funding source"><TemplateFundingSourceSelect /></Field>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input name="autoApplyToNewVehicles" type="checkbox" />Auto-apply to every new vehicle</label>
          <label className="flex items-center gap-2 text-sm text-slate-300"><input name="isActive" type="checkbox" defaultChecked />Active</label>
          <Field label="Description / note"><textarea className="control min-h-20 w-full" name="description" /></Field>
          <div className="flex items-end"><button className="primary-button" type="submit">Create template</button></div>
        </form>
      ) : (
        <p className="text-sm text-slate-500">Only owners and admins can create or edit recurring expense templates.</p>
      )}
      <div className="space-y-3">
        {activeTemplates.length === 0 && <EmptyState title="No recurring expenses yet" copy="Create templates such as Plate commission, admin fee, inspection fee, or storage fee." />}
        {activeTemplates.map((template) => (
          <div key={template.id} className="rounded-lg border border-slate-800 bg-slate-950/35 p-3">
            {canManage ? (
              <form className="grid gap-3 lg:grid-cols-2" action={onUpdate}>
                <input type="hidden" name="templateId" value={template.id} />
                <Field label="Name"><input className="control w-full" name="name" defaultValue={template.name} required /></Field>
                <Field label="Category"><TemplateCategorySelect defaultValue={template.category} /></Field>
                <Field label="Default amount before tax"><input className="control w-full" name="amountBeforeTax" type="number" min="0" step="0.01" defaultValue={template.amountBeforeTax} required /></Field>
                <Field label="Tax behavior"><TemplateTaxBehaviorSelect defaultValue={template.taxBehavior} /></Field>
                <Field label="Custom tax rate"><input className="control w-full" name="customTaxRate" type="number" min="0" max="1" step="0.0001" defaultValue={template.taxBehavior === "custom" ? template.taxRate : ""} /></Field>
                <Field label="Default funding source"><TemplateFundingSourceSelect defaultValue={template.defaultFundingSource} /></Field>
                <label className="flex items-center gap-2 text-sm text-slate-300"><input name="autoApplyToNewVehicles" type="checkbox" defaultChecked={template.autoApplyToNewVehicles} />Auto-apply to every new vehicle</label>
                <label className="flex items-center gap-2 text-sm text-slate-300"><input name="isActive" type="checkbox" defaultChecked={template.isActive} />Active</label>
                <Field label="Description / note"><textarea className="control min-h-20 w-full" name="description" defaultValue={template.description} /></Field>
                <div className="flex flex-wrap items-end gap-2">
                  <button className="secondary-button" type="submit">Save template</button>
                  <button className="secondary-button" type="button" onClick={() => onDelete(template.id)}>Deactivate</button>
                </div>
              </form>
            ) : (
              <InfoGrid rows={[
                ["Name", template.name],
                ["Category", formatLabel(template.category)],
                ["Total", money(template.totalAmount)],
                ["Funding source", formatLabel(template.defaultFundingSource)],
                ["Auto-apply", template.autoApplyToNewVehicles ? "Yes" : "No"],
                ["Status", template.isActive ? "Active" : "Inactive"],
              ]} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplateCategorySelect({ defaultValue = "other" }: { defaultValue?: string }) {
  return <select className="control w-full" name="category" defaultValue={defaultValue}>{EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{formatLabel(category)}</option>)}</select>;
}

function TemplateTaxBehaviorSelect({ defaultValue = "no_tax" }: { defaultValue?: string }) {
  return <select className="control w-full" name="taxBehavior" defaultValue={defaultValue}>{EXPENSE_TAX_BEHAVIORS.map((behavior) => <option key={behavior} value={behavior}>{formatLabel(behavior)}</option>)}</select>;
}

function TemplateFundingSourceSelect({ defaultValue = "company_cash" }: { defaultValue?: string }) {
  return <select className="control w-full" name="defaultFundingSource" defaultValue={defaultValue}>{EXPENSE_FUNDING_SOURCES.map((source) => <option key={source} value={source}>{formatLabel(source)}</option>)}</select>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="panel"><h3 className="section-title">{title}</h3>{children}</div>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="empty-state">
      <p className="font-medium text-slate-100">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{copy}</p>
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="message-banner mb-4 flex items-center gap-3 border border-cyan-300/15 bg-cyan-300/8 text-cyan-100">
      <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-200" />
      {message}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm text-slate-300"><span className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</span>{children}</label>;
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs font-medium uppercase tracking-[0.1em] text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium text-slate-100">{value}</dd></div>;
}

function InfoGrid({ rows }: { rows: Array<[React.ReactNode, React.ReactNode]> }) {
  return <dl className="mt-3 grid gap-3 sm:grid-cols-2">{rows.filter(([, value]) => value !== undefined && value !== "").map(([label, value], index) => <Info key={index} label={String(label)} value={value} />)}</dl>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-md border border-cyan-300/15 bg-cyan-300/8 px-2 py-1 text-xs font-medium text-cyan-100">{children}</span>;
}

function AttachmentList({ attachments, emptyCopy }: { attachments: AppData["attachments"]; emptyCopy?: string }) {
  if (attachments.length === 0) return <div className="mt-3"><EmptyState title="No attachments yet" copy={emptyCopy ?? "Files, photos, and links will appear here after they are added."} /></div>;
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-sm">
          {attachment.type === "photo" && attachment.previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachment.previewUrl}
              alt={attachment.title}
              className="mb-3 aspect-video w-full rounded-md border border-slate-800 object-cover"
            />
          )}
          <p className="font-medium text-slate-200">{attachment.title}</p>
          <p className="mt-1 text-slate-500">{attachment.isSensitive ? "Private" : formatLabel(attachment.type)}</p>
          {attachment.type === "link" && (
            <a className="mt-2 block text-cyan-100 underline-offset-4 hover:underline" href={attachment.urlOrPath} target="_blank" rel="noopener noreferrer">
              {attachment.urlOrPath}
            </a>
          )}
          {attachment.type !== "link" && attachment.previewUrl && (
            <a className="mt-2 block text-cyan-100 underline-offset-4 hover:underline" href={attachment.previewUrl} target="_blank" rel="noopener noreferrer">
              Open private file
            </a>
          )}
          {attachment.notes && <p className="mt-2 text-slate-400">{attachment.notes}</p>}
        </div>
      ))}
    </div>
  );
}

function Ledger({ rows, emptyTitle = "No records yet", emptyCopy = "Records will appear here once activity is created." }: { rows: React.ReactNode[][]; emptyTitle?: string; emptyCopy?: string }) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} copy={emptyCopy} />;
  return <div className="overflow-x-auto"><table className="data-table"><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function tabLabel(t: ReturnType<typeof getDictionary>, key: string) {
  return t.vehicleTabs[key as keyof typeof t.vehicleTabs] ?? key;
}

function scopeData(data: AppData, organizationId: string): AppData {
  return {
    ...data,
    memberships: data.memberships.filter((row) => row.organizationId === organizationId),
    vehicles: data.vehicles.filter((row) => row.organizationId === organizationId),
    expenses: data.expenses.filter((row) => row.organizationId === organizationId),
    recurringExpenseTemplates: data.recurringExpenseTemplates.filter((row) => row.organizationId === organizationId),
    sales: data.sales.filter((row) => row.organizationId === organizationId),
    contacts: data.contacts.filter((row) => row.organizationId === organizationId),
    attachments: data.attachments.filter((row) => row.organizationId === organizationId),
    companyCashTransactions: data.companyCashTransactions.filter((row) => row.organizationId === organizationId),
    externalCashTransactions: data.externalCashTransactions.filter((row) => row.organizationId === organizationId),
    activityLogs: data.activityLogs.filter((row) => row.organizationId === organizationId),
  };
}

function isInDateRange(date: string, range: { start: string; end: string }) {
  if (range.start && date < range.start) return false;
  if (range.end && date > range.end) return false;
  return true;
}

function buildDailySeries(rows: Array<{ date: string; value: number }>) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const key = row.date.slice(0, 10);
    totals.set(key, (totals.get(key) ?? 0) + row.value);
  });
  return Array.from(totals.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value], index) => ({ index, label: date.slice(5), value: roundDisplayNumber(value) }));
}

function buildBalanceSeries<T extends CashTransaction>(
  transactions: T[],
  range: { start: string; end: string },
  calculator: (transactions: T[]) => number,
) {
  const active = transactions.filter((transaction) => !transaction.deletedAt);
  const dates = Array.from(new Set(active.filter((transaction) => isInDateRange(transaction.date, range)).map((transaction) => transaction.date)));
  if (range.start) dates.push(range.start);
  if (range.end) dates.push(range.end);
  const sortedDates = Array.from(new Set(dates)).sort((left, right) => left.localeCompare(right));

  if (sortedDates.length === 0) {
    return [{ label: "Now", value: calculator(active) }];
  }

  return sortedDates.map((date, index) => ({
    index,
    label: date.slice(5),
    value: calculator(active.filter((transaction) => transaction.date <= date)),
  }));
}

function buildMonthlyBuySellSeries(scoped: AppData, range: { start: string; end: string }) {
  const months = new Map<string, { label: string; buyTotal: number; sellTotal: number; count: number }>();
  scoped.sales.filter((sale) => isActiveSale(sale) && isInDateRange(sale.saleDate, range)).forEach((sale) => {
    const key = sale.saleDate.slice(0, 7);
    const current = months.get(key) ?? { label: key.slice(5), buyTotal: 0, sellTotal: 0, count: 0 };
    current.buyTotal += sale.vehicleTotalCost;
    current.sellTotal += sale.paperSalePrice;
    current.count += 1;
    months.set(key, current);
  });
  return Array.from(months.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => ({
      label: row.label,
      averageBuyPrice: row.count ? roundDisplayNumber(row.buyTotal / row.count) : 0,
      averageSellPrice: row.count ? roundDisplayNumber(row.sellTotal / row.count) : 0,
    }));
}

function averageScore(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function vehicleLabel(vehicle?: Vehicle) {
  if (!vehicle) return "Unknown vehicle";
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || vehicle.vin || "Unknown vehicle";
}

function dealRadarLabel(item: Record<string, unknown>) {
  return [item.year, item.make, item.model, item.trim].filter(Boolean).join(" ") || String(item.title ?? "Unknown listing");
}

function normalizedExpenseAmount(expense: VehicleExpense) {
  if (expense.category === "vehicle_purchase_price") {
    return expense.taxAmount;
  }
  return expense.totalAmount;
}

function sumSeries(series: Array<{ value: number }>) {
  return roundDisplayNumber(series.reduce((sum, item) => sum + item.value, 0));
}

function lastSeriesValue(series: Array<{ value: number }>) {
  return series.at(-1)?.value ?? 0;
}

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value || 0);
}

function roundDisplayNumber(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getDownloadFileName(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  return match?.[1] || fallback;
}

function showClientError(error: unknown) {
  window.alert(error instanceof Error ? error.message : "Action failed.");
}

function cloneFormData(source: FormData, extra: Record<string, string>) {
  const formData = new FormData();
  source.forEach((value, key) => formData.append(key, value));
  Object.entries(extra).forEach(([key, value]) => formData.set(key, value));
  return formData;
}

function newMutationForm(values: Record<string, string>) {
  const formData = new FormData();
  Object.entries(values).forEach(([key, value]) => formData.set(key, value));
  return formData;
}

function withoutUndefined(values: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Record<string, string>;
}
