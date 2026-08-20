"use client";

import {
  Languages,
  Menu,
  Plus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { calculateDashboardMetrics } from "@/lib/domain/calculations";
import { verifyBackupExport } from "@/lib/backup/export";
import { serverMutation } from "@/features/app/mutations";
import { getRouteState, pathForView, type VehicleMode, type VehicleTab, type View } from "@/features/app/navigation";
import { getPermissions } from "@/features/app/permissions";
import { getDictionary } from "@/lib/i18n";
import { activeVehiclesOnly } from "@/lib/vehicle-delete";
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
  ExternalCashTransaction,
  Language,
  Vehicle,
  VehicleStatus,
} from "@/types/domain";

import {
  AuthScreen,
  Brand,
  cloneFormData,
  formatLabel,
  getDownloadFileName,
  LoadingState,
  Navigation,
  newMutationForm,
  OnboardingScreen,
  scopeData,
  SupabaseSetupScreen,
  today,
  withoutUndefined,
} from "@/features/app/feature-views";
import { DashboardView } from "@/features/dashboard/dashboard-view";
import { CashView } from "@/features/cash/cash-view";
import { ContactsView } from "@/features/contacts/contacts-view";
import { TaxesView } from "@/features/taxes/taxes-view";
import { BackupsView } from "@/features/backups/backups-view";
import { SettingsView } from "@/features/settings/settings-view";
import { VehiclesView } from "@/features/vehicles/vehicles-view";
import { DealRadarView, MarketDataView, MarketSnapView } from "@/features/market-snap/market-snap-view";

type VehiclePrefill = Partial<Pick<Vehicle, "year" | "make" | "model" | "trim" | "mileage" | "purchasePrice" | "purchaseSource" | "notes">>;

const languageKey = "dealer-flow-language";

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
            <DashboardView
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
            <VehiclesView
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
            <MarketSnapView
              t={t}
              scoped={scoped}
              dateRange={dateRange}
              setDateRange={setDateRange}
              navigate={navigate}
              permissions={permissions}
            />
          )}
          {view === "dealRadar" && (
            <DealRadarView
              t={t}
              organizationId={activeOrganization.id}
              navigate={navigate}
              permissions={permissions}
              onVehiclePrefill={setVehiclePrefill}
            />
          )}
          {view === "marketData" && (
            <MarketDataView
              t={t}
              organizationId={activeOrganization.id}
              permissions={permissions}
            />
          )}
          {view === "cash" && (
            <CashView
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
          {view === "contacts" && <ContactsView t={t} contacts={scoped.contacts} attachments={scoped.attachments} onSubmit={addContact} permissions={permissions} />}
          {view === "taxes" && <TaxesView t={t} scoped={scoped} dateRange={dateRange} setDateRange={setDateRange} permissions={permissions} />}
          {view === "backups" && <BackupsView t={t} organizationId={activeOrganization.id} onDownload={downloadBackup} onUploadR2={uploadR2Backup} onVerify={verifyBackupFile} onRestoreDryRun={dryRunRestore} permissions={permissions} />}
          {view === "settings" && (
            <SettingsView
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
