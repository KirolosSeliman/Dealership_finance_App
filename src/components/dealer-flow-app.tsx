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
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TAX_DISCLAIMER } from "@/lib/domain/constants";
import {
  EXPENSE_CATEGORIES,
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
} from "@/lib/domain/calculations";
import { generateBackupExport } from "@/lib/backup/export";
import { getDictionary } from "@/lib/i18n";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { emptyAppData } from "@/lib/supabase/mappers";
import {
  createAttachment as createAttachmentRecord,
  createCashTransaction,
  createContact as createContactRecord,
  createExpense,
  deleteCashTransaction,
  deleteExpense,
  createOrganization as createOrganizationRecord,
  createVehicle,
  getCurrentUser,
  isSupabaseConfigured,
  joinOrganization as joinOrganizationRecord,
  loadAppData,
  recordVehicleSale,
  saveLanguagePreference,
  signIn,
  signOut,
  signUp,
  updateDefaultPlateCommission,
  updateCashTransaction,
  updateVehicleMainPhoto,
  updateVehicle,
  updateExpense,
} from "@/lib/supabase/repository";
import type {
  AppData,
  Attachment,
  CompanyCashTransaction,
  Contact as ContactRecord,
  ExternalCashTransaction,
  Language,
  Sale,
  Vehicle,
  VehicleExpense,
  VehicleStatus,
} from "@/types/domain";

type View = "dashboard" | "vehicles" | "cash" | "contacts" | "taxes" | "backups" | "settings";
type VehicleMode = "list" | "new" | "detail";
type VehicleTab = "overview" | "details" | "expenses" | "documents" | "sale" | "timeline";
type CashAccount = "company" | "external";
type CashTransaction = CompanyCashTransaction | ExternalCashTransaction;

const languageKey = "dealer-flow-language";

const mainNav: Array<[View, React.ReactNode]> = [
  ["dashboard", <BarChart3 key="dashboard" size={18} />],
  ["vehicles", <Car key="vehicles" size={18} />],
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

function getRouteState(pathname: string, searchParams: string) {
  const params = new URLSearchParams(searchParams);
  const parts = pathname.split("/").filter(Boolean);
  const root = parts[0] as View | undefined;
  if (root === "vehicles") {
    if (parts[1] === "new") return { view: "vehicles" as View, mode: "new" as VehicleMode };
    if (parts[1]) {
      return {
        view: "vehicles" as View,
        mode: "detail" as VehicleMode,
        vehicleId: parts[1],
        tab: ((params.get("tab") as VehicleTab) || "overview") as VehicleTab,
      };
    }
    return { view: "vehicles" as View, mode: "list" as VehicleMode };
  }
  if (root && ["dashboard", "cash", "contacts", "taxes", "backups", "settings"].includes(root)) {
    return { view: root, mode: "list" as VehicleMode };
  }
  return { view: "dashboard" as View, mode: "list" as VehicleMode };
}

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
  const metrics = useMemo(() => calculateDashboardMetrics(scoped), [scoped]);
  const selectedVehicle =
    scoped.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? scoped.vehicles[0];
  const filteredVehicles = scoped.vehicles.filter((vehicle) => {
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
    window.history.pushState(null, "", nextView === "dashboard" ? "/dashboard" : `/${nextView}`);
  }

  async function handleAuth(formData: FormData) {
    if (!supabase) return;
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const email = String(formData.get("email") || "");
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
      await createOrganizationRecord(supabase, name);
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
      await joinOrganizationRecord(supabase, code);
      await refreshData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not join organization.");
    } finally {
      setLoading(false);
    }
  }

  async function saveDefaultPlateCommission(formData: FormData) {
    if (!supabase || !activeOrganization) return;
    const amount = Number(formData.get("defaultPlateCommissionAmount"));
    setLoading(true);
    setErrorMessage("");
    try {
      await updateDefaultPlateCommission(
        supabase,
        activeOrganization.id,
        Number.isFinite(amount) ? Math.max(0, amount) : 250,
      );
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update Commission Plaque.");
    } finally {
      setLoading(false);
    }
  }

  async function addVehicle(formData: FormData) {
    if (!supabase || !activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      const id = await createVehicle(supabase, activeOrganization.id, formData);
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
      await createExpense(supabase, vehicleSnapshot, formData);
      await refreshData(vehicleSnapshot.organizationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not add expense.");
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
      await updateExpense(supabase, vehicleSnapshot, expenseId, formData);
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
      await deleteExpense(supabase, vehicleSnapshot, expenseId);
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
      await recordVehicleSale(supabase, scoped, selectedVehicle, formData);
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
      await createCashTransaction(supabase, activeOrganization.id, type, amount, note, date);
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
      await updateCashTransaction(supabase, activeOrganization.id, account, transactionId, formData);
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
      await deleteCashTransaction(supabase, activeOrganization.id, account, transactionId, reason);
      await refreshData(activeOrganization.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not delete cash transaction.");
    } finally {
      setLoading(false);
    }
  }

  async function editVehicle(formData: FormData) {
    if (!supabase || !selectedVehicle) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await updateVehicle(supabase, selectedVehicle, formData);
      await refreshData(selectedVehicle.organizationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update vehicle.");
    } finally {
      setLoading(false);
    }
  }

  async function addContact(formData: FormData) {
    if (!supabase || !activeOrganization) return;
    setLoading(true);
    setErrorMessage("");
    try {
      await createContactRecord(supabase, activeOrganization.id, formData);
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
      await createAttachmentRecord(supabase, activeOrganization.id, formData, relation);
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
      await updateVehicleMainPhoto(supabase, selectedVehicle, attachment);
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
    const blob = await generateBackupExport(scoped);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dealer-flow-backup-${today()}.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusMessage("Local backup generated.");
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
    <div className="min-h-screen text-slate-100">
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
                onChange={(event) => {
                  const organizationId = event.target.value;
                  setData((current) => ({ ...current, activeOrganizationId: organizationId }));
                  refreshData(organizationId);
                }}
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
          {loading && <div className="mb-4 rounded-lg border border-cyan-300/15 bg-cyan-300/8 p-3 text-sm text-cyan-100">Loading Dealer Flow data...</div>}
          {statusMessage && <div className="mb-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">{statusMessage}</div>}
          {errorMessage && <div className="mb-4 rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">{errorMessage}</div>}
          {view === "dashboard" && (
            <Dashboard
              t={t}
              metrics={metrics}
              scoped={scoped}
              dateRange={dateRange}
              setDateRange={setDateRange}
              navigate={navigate}
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
              addExpense={addExpense}
              editExpense={editExpense}
              deleteExpense={removeExpense}
              recordSale={recordSale}
              addAttachment={addAttachment}
              setMainPhoto={setVehicleMainPhoto}
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
            />
          )}
          {view === "contacts" && <Contacts t={t} contacts={scoped.contacts} attachments={scoped.attachments} onSubmit={addContact} />}
          {view === "taxes" && <Taxes t={t} scoped={scoped} dateRange={dateRange} setDateRange={setDateRange} />}
          {view === "backups" && <Backups t={t} organizationId={activeOrganization.id} onDownload={downloadBackup} />}
          {view === "settings" && (
            <SettingsPage
              t={t}
              organizations={data.organizations}
              activeOrganization={activeOrganization}
              onCreate={createOrganization}
              onJoin={joinOrganization}
              onSaveDefaultPlateCommission={saveDefaultPlateCommission}
              onSignOut={logout}
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
          Demo data is no longer used as the application source of truth.
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
        <Field label={t.auth.email}><input className="control w-full" name="email" type="email" required /></Field>
        <Field label={t.auth.password}><input className="control w-full" name="password" type="password" required minLength={6} /></Field>
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
}: {
  t: ReturnType<typeof getDictionary>;
  metrics: ReturnType<typeof calculateDashboardMetrics>;
  scoped: AppData;
  dateRange: { start: string; end: string };
  setDateRange: (range: { start: string; end: string }) => void;
  navigate: (view: View, options?: { mode?: VehicleMode; vehicleId?: string; tab?: VehicleTab }) => void;
}) {
  const visibleSales = scoped.sales.filter((sale) => isInDateRange(sale.saleDate, dateRange));
  const visibleExpenses = scoped.expenses.filter((expense) => isInDateRange(expense.date, dateRange));
  const activeCompanyTransactions = scoped.companyCashTransactions.filter((transaction) => !transaction.deletedAt);
  const activeExternalTransactions = scoped.externalCashTransactions.filter((transaction) => !transaction.deletedAt);
  const visibleVehicles = scoped.vehicles.filter((vehicle) => isInDateRange(vehicle.purchaseDate, dateRange));
  const visibleSoldVehicles = scoped.vehicles.filter((vehicle) => {
    const sale = scoped.sales.find((item) => item.vehicleId === vehicle.id);
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
    const sale = scoped.sales.find((item) => item.vehicleId === vehicle.id);
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
          <button className="primary-button" onClick={() => navigate("vehicles", { mode: "new" })}>
            <Plus size={18} />
            {t.actions.addVehicle}
          </button>
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
        <div className="grid gap-3 md:grid-cols-3">
          {scoped.vehicles.slice(0, 3).map((vehicle) => (
            <VehicleCard
              key={vehicle.id}
              t={t}
              vehicle={vehicle}
              expenses={scoped.expenses}
              sale={scoped.sales.find((item) => item.vehicleId === vehicle.id)}
              onOpen={() => navigate("vehicles", { mode: "detail", vehicleId: vehicle.id, tab: "overview" })}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ChartPanel({ title, data, type, summary }: { title: string; data: { label: string; value: number }[]; type: "area" | "bar"; summary: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(timeout);
  }, []);
  return (
    <div className="panel h-80">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="section-title">{title}</h3>
        <div className="rounded-md border border-cyan-300/15 bg-cyan-300/8 px-3 py-2 text-right">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">Selected range</p>
          <p className="mt-1 text-sm font-semibold text-white">{summary}</p>
        </div>
      </div>
      {mounted ? (
        <ResponsiveContainer width="100%" height="76%">
          {type === "area" ? (
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,.16)" />
              <XAxis dataKey="label" stroke="#64748b" />
              <YAxis stroke="#64748b" />
              <Tooltip contentStyle={{ background: "#101827", border: "1px solid rgba(71,85,105,.55)", borderRadius: 8 }} />
              <Area type="monotone" dataKey="value" stroke="#67b7c7" fill="#67b7c7" fillOpacity={0.16} />
            </AreaChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,.16)" />
              <XAxis dataKey="label" stroke="#64748b" />
              <YAxis stroke="#64748b" />
              <Tooltip contentStyle={{ background: "#101827", border: "1px solid rgba(71,85,105,.55)", borderRadius: 8 }} />
              <Bar dataKey="value" fill="#7ca98f" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      ) : (
        <div className="h-[76%] rounded-md border border-slate-800 bg-slate-900/40" />
      )}
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
  addExpense: (formData: FormData) => void;
  editExpense: (expenseId: string, formData: FormData) => void;
  deleteExpense: (expenseId: string) => void;
  recordSale: (formData: FormData) => void;
  addAttachment: (formData: FormData, relation: Record<string, string | undefined>) => void;
  setMainPhoto: (attachment: Attachment) => void;
}) {
  if (props.mode === "new") {
    return (
      <div className="space-y-4">
        <button className="secondary-button" onClick={() => props.navigate("vehicles")}>
          <ChevronLeft size={18} />
          {props.t.nav.inventory}
        </button>
        <AddVehicle t={props.t} onSubmit={props.addVehicle} />
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
          <button className="primary-button" onClick={() => navigate("vehicles", { mode: "new" })}><Plus size={18} />{t.actions.addVehicle}</button>
        </div>
      </div>
      {inventoryMode === "cards" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vehicles.map((vehicle) => (
            <VehicleCard
              key={vehicle.id}
              t={t}
              vehicle={vehicle}
              expenses={expenses}
              sale={sales.find((item) => item.vehicleId === vehicle.id)}
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
              {vehicles.map((vehicle) => {
                const sale = sales.find((item) => item.vehicleId === vehicle.id);
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
  sales,
  contacts,
  attachments,
  activityLogs,
  navigate,
  editVehicle,
  addExpense,
  editExpense,
  deleteExpense,
  recordSale,
  addAttachment,
  setMainPhoto,
}: Parameters<typeof VehiclesSection>[0] & { vehicle: Vehicle }) {
  const sale = sales.find((item) => item.vehicleId === vehicle.id);
  const vehicleAttachments = attachments.filter((attachment) => attachment.vehicleId === vehicle.id || attachment.saleId === sale?.id);
  const vehiclePhotos = attachments.filter((attachment) => attachment.vehicleId === vehicle.id && attachment.type === "photo");
  const totalCost = calculateVehicleTotalCost(vehicle, expenses);
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
          <button className="secondary-button" onClick={() => setSelectedTab("expenses")}><Receipt size={18} />{t.actions.addExpense}</button>
          <button className="primary-button" onClick={() => setSelectedTab("sale")}><Banknote size={18} />{t.actions.recordSale}</button>
        </div>
      </div>
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
            <PhotoManager t={t} vehicle={vehicle} photos={vehiclePhotos} onUpload={addAttachment} onSetMain={setMainPhoto} />
          </div>
        </div>
      )}
      {selectedTab === "details" && <VehicleDetailsTab t={t} vehicle={vehicle} onSubmit={editVehicle} />}
      {selectedTab === "expenses" && <Expenses t={t} vehicle={vehicle} expenses={expenses} onSubmit={addExpense} onEdit={editExpense} onDelete={deleteExpense} />}
      {selectedTab === "documents" && <DocumentsTab t={t} vehicle={vehicle} attachments={vehicleAttachments} onSubmit={addAttachment} />}
      {selectedTab === "sale" && <SaleForm t={t} vehicle={vehicle} expenses={expenses} onSubmit={recordSale} sale={sale} contacts={contacts} />}
      {selectedTab === "timeline" && (
        <Panel title={tabLabel(t, "timeline")}>
          <Ledger rows={activityLogs.filter((log) => !log.entityId || log.entityId === vehicle.id).map((log) => [log.createdAt.slice(0, 10), log.action, log.message])} />
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
}: {
  t: ReturnType<typeof getDictionary>;
  vehicle: Vehicle;
  photos: Attachment[];
  onUpload: (formData: FormData, relation: Record<string, string | undefined>) => void;
  onSetMain: (attachment: Attachment) => void;
}) {
  return (
    <Panel title={t.sections.vehiclePhotos}>
      <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" action={(formData) => onUpload(formData, { vehicleId: vehicle.id })}>
        <input type="hidden" name="type" value="photo" />
        <Field label={t.fields.fileTitle}><input className="control w-full" name="title" placeholder={`${vehicle.year ?? ""} ${vehicle.make ?? ""} photo`} required /></Field>
        <Field label={t.sections.photos}><input className="control w-full" name="file" type="file" accept="image/*" required /></Field>
        <div className="flex items-end"><button className="primary-button" type="submit"><Upload size={18} />Upload</button></div>
      </form>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {photos.length === 0 && <p className="text-sm text-slate-500">No photos uploaded yet.</p>}
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
              <button className="secondary-button mt-3 w-full justify-center" type="button" disabled={isMain} onClick={() => onSetMain(photo)}>
                {isMain ? "Selected front image" : "Set as front image"}
              </button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function AddVehicle({ t, onSubmit }: { t: ReturnType<typeof getDictionary>; onSubmit: (formData: FormData) => void }) {
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
      <Field label={t.fields.year}><input className="control w-full" name="year" defaultValue={decoded.year} /></Field>
      <Field label={t.fields.make}><input className="control w-full" name="make" defaultValue={decoded.make} /></Field>
      <Field label={t.fields.model}><input className="control w-full" name="model" defaultValue={decoded.model} /></Field>
      <Field label={t.fields.trim}><input className="control w-full" name="trim" defaultValue={decoded.trim} /></Field>
      <Field label={t.fields.color}><input className="control w-full" name="color" defaultValue={decoded.color} /></Field>
      <Field label={t.fields.mileage}><input className="control w-full" name="mileage" type="number" /></Field>
      <Field label={t.fields.purchasePrice}><input className="control w-full" name="purchasePrice" type="number" step="0.01" required /></Field>
      <Field label={t.fields.purchaseDate}><input className="control w-full" name="purchaseDate" type="date" defaultValue={today()} required /></Field>
      <Field label={t.fields.purchaseSource}><select className="control w-full" name="purchaseSource">{PURCHASE_SOURCES.map((source) => <option key={source} value={source}>{formatLabel(source)}</option>)}</select></Field>
      <Field label={t.fields.status}><select className="control w-full" name="status" defaultValue="purchased">{VEHICLE_STATUSES.map((status) => <option key={status} value={status}>{t.status[status]}</option>)}</select></Field>
      <Field label={t.fields.listedPrice}><input className="control w-full" name="listedPrice" type="number" step="0.01" /></Field>
      <Field label={t.fields.notes}><textarea className="control min-h-24 w-full" name="notes" /></Field>
      <div className="lg:col-span-2"><button className="primary-button" type="submit">{t.actions.saveVehicle}</button></div>
    </form>
  );
}

function VehicleDetailsTab({ t, vehicle, onSubmit }: { t: ReturnType<typeof getDictionary>; vehicle: Vehicle; onSubmit: (formData: FormData) => void }) {
  return (
    <Panel title={tabLabel(t, "details")}>
      <form className="grid gap-4 lg:grid-cols-2" action={onSubmit}>
        <Field label={t.fields.vin}><input className="control w-full" name="vin" defaultValue={vehicle.vin} /></Field>
        <Field label={t.fields.year}><input className="control w-full" name="year" defaultValue={vehicle.year} /></Field>
        <Field label={t.fields.make}><input className="control w-full" name="make" defaultValue={vehicle.make} /></Field>
        <Field label={t.fields.model}><input className="control w-full" name="model" defaultValue={vehicle.model} /></Field>
        <Field label={t.fields.trim}><input className="control w-full" name="trim" defaultValue={vehicle.trim} /></Field>
        <Field label={t.fields.color}><input className="control w-full" name="color" defaultValue={vehicle.color} /></Field>
        <Field label={t.fields.mileage}><input className="control w-full" name="mileage" type="number" defaultValue={vehicle.mileage} /></Field>
        <Field label={t.fields.notes}><textarea className="control min-h-24 w-full" name="notes" defaultValue={vehicle.notes} /></Field>
        <div className="lg:col-span-2"><button className="primary-button" type="submit">{t.actions.saveVehicle}</button></div>
      </form>
    </Panel>
  );
}

function Expenses({
  t,
  vehicle,
  expenses,
  onSubmit,
  onEdit,
  onDelete,
}: {
  t: ReturnType<typeof getDictionary>;
  vehicle: Vehicle;
  expenses: VehicleExpense[];
  onSubmit: (formData: FormData) => void;
  onEdit: (expenseId: string, formData: FormData) => void;
  onDelete: (expenseId: string) => void;
}) {
  const vehicleExpenses = expenses.filter((expense) => expense.vehicleId === vehicle.id);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <form className="panel space-y-4" action={onSubmit}>
        <h3 className="section-title">{t.actions.addExpense}</h3>
        <Field label={t.fields.category}><select className="control w-full" name="category">{EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{formatLabel(category)}</option>)}</select></Field>
        <Field label={t.fields.amountBeforeTax}><input className="control w-full" name="amountBeforeTax" type="number" step="0.01" required /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-300"><input name="addTax" type="checkbox" />{t.fields.addFifteenTax}</label>
        <Field label={t.fields.date}><input className="control w-full" name="date" type="date" defaultValue={today()} /></Field>
        <Field label={t.fields.fileTitle}><input className="control w-full" placeholder="private://..." /></Field>
        <Field label={t.fields.notes}><textarea className="control min-h-24 w-full" name="note" /></Field>
        <button className="primary-button" type="submit">{t.actions.addExpense}</button>
      </form>
      <Panel title={`${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`}>
        <div className="space-y-3">
          {vehicleExpenses.map((expense) => (
            <div key={expense.id} className="rounded-lg border border-slate-800 bg-slate-950/35 p-3">
              {editingExpenseId === expense.id ? (
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
                    [t.fields.notes, expense.note],
                  ]} />
                  <div className="flex gap-2">
                    <button className="secondary-button" type="button" onClick={() => setEditingExpenseId(expense.id)}>Edit</button>
                    <button className="secondary-button" type="button" onClick={() => onDelete(expense.id)}>Delete</button>
                  </div>
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
}: {
  t: ReturnType<typeof getDictionary>;
  vehicle: Vehicle;
  attachments: AppData["attachments"];
  onSubmit: (formData: FormData, relation: Record<string, string | undefined>) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <Panel title={t.sections.photos}>
        <form className="grid gap-3" action={(formData) => onSubmit(formData, { vehicleId: vehicle.id })}>
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
        </form>
      </Panel>
      <Panel title={t.sections.documentsLinks}>
        <AttachmentList attachments={attachments} />
      </Panel>
    </div>
  );
}

function SaleForm({ t, vehicle, expenses, onSubmit, sale, contacts }: { t: ReturnType<typeof getDictionary>; vehicle: Vehicle; expenses: VehicleExpense[]; onSubmit: (formData: FormData) => void; sale?: Sale; contacts: ContactRecord[] }) {
  const [taxableProfitAmount, setTaxableProfitAmount] = useState(sale?.taxableProfitAmount ?? 1500);
  const [realClientPayment, setRealClientPayment] = useState(sale?.realClientPayment ?? 0);
  const vehicleTotalCost = calculateVehicleTotalCost(vehicle, expenses);
  const breakdown = calculateSaleBreakdown({ vehicleTotalCost, taxableProfitAmount, realClientPayment });
  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <form className="panel space-y-4" action={onSubmit}>
        <h3 className="section-title">{t.actions.recordSale}</h3>
        <Field label={t.fields.saleDate}><input className="control w-full" name="saleDate" type="date" defaultValue={sale?.saleDate ?? today()} /></Field>
        <Field label={t.fields.taxableProfit}><input className="control w-full" name="taxableProfitAmount" type="number" step="0.01" value={taxableProfitAmount} onChange={(event) => setTaxableProfitAmount(Number(event.target.value))} /></Field>
        <Field label={t.fields.realClientPayment}><input className="control w-full" name="realClientPayment" type="number" step="0.01" value={realClientPayment} onChange={(event) => setRealClientPayment(Number(event.target.value))} /></Field>
        <Field label={t.fields.buyerName}><input className="control w-full" name="buyerName" defaultValue={sale ? contacts.find((contact) => contact.id === sale.contactId)?.fullName : ""} required /></Field>
        <Field label={t.fields.phone}><input className="control w-full" name="phone" /></Field>
        <Field label={t.fields.email}><input className="control w-full" name="email" type="email" /></Field>
        <Field label={t.fields.address}><input className="control w-full" name="address" /></Field>
        <Field label={t.fields.fileTitle}><input className="control w-full" placeholder="driver-license-private-path" /></Field>
        <Field label={t.fields.notes}><textarea className="control min-h-24 w-full" name="notes" defaultValue={sale?.notes} /></Field>
        <button className="primary-button" type="submit">{t.actions.recordSale}</button>
      </form>
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
}: {
  t: ReturnType<typeof getDictionary>;
  metrics: ReturnType<typeof calculateDashboardMetrics>;
  companyTransactions: CompanyCashTransaction[];
  externalTransactions: ExternalCashTransaction[];
  onQuickTransaction: (type: CompanyCashTransaction["type"] | ExternalCashTransaction["type"], amount: number, note: string, date?: string) => void;
  onEditTransaction: (account: CashAccount, transactionId: string, formData: FormData) => void;
  onDeleteTransaction: (account: CashAccount, transactionId: string, reason: string) => void;
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
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <CashActionForm t={t} label={t.actions.addCompanyCash} type="company_cash_added" onSubmit={onQuickTransaction} />
            <CashActionForm t={t} label={t.actions.withdrawCompanyCash} type="company_cash_withdrawn" onSubmit={onQuickTransaction} />
          </div>
        </div>
        <div className="metric-card min-h-36">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{t.metrics.externalCash}</p>
          <p className="mt-3 text-3xl font-semibold text-white">{money(metrics.externalCash)}</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <CashActionForm t={t} label={t.actions.transferExternalCash} type="external_cash_transferred_to_company" onSubmit={onQuickTransaction} />
            <CashActionForm t={t} label={t.actions.removeExternalCash} type="external_cash_personally_removed" onSubmit={onQuickTransaction} />
          </div>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t.sections.companyLedger}>
          <CashLedger account="company" transactions={activeCompanyTransactions} onEdit={onEditTransaction} onDelete={onDeleteTransaction} />
        </Panel>
        <Panel title={t.sections.externalLedger}>
          <CashLedger account="external" transactions={activeExternalTransactions} onEdit={onEditTransaction} onDelete={onDeleteTransaction} />
        </Panel>
      </div>
      {deletedTransactions.length > 0 && (
        <Panel title="Deleted cash history">
          <Ledger rows={deletedTransactions.map(({ account, transaction }) => [
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
}: {
  account: CashAccount;
  transactions: CashTransaction[];
  onEdit: (account: CashAccount, transactionId: string, formData: FormData) => void;
  onDelete: (account: CashAccount, transactionId: string, reason: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (transactions.length === 0) return <p className="text-sm text-slate-500">-</p>;

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
              <p className="text-sm text-amber-100">This will remove it from balances, but keep it in deleted history.</p>
              <input className="control w-full" name="reason" placeholder="Reason for deletion" />
              <div className="flex flex-wrap gap-2">
                <button className="secondary-button" type="submit">Delete</button>
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
              <div className="flex flex-wrap gap-2">
                <button className="secondary-button" type="button" onClick={() => setEditingId(transaction.id)}>Edit</button>
                <button className="secondary-button" type="button" onClick={() => setDeletingId(transaction.id)}>Delete</button>
              </div>
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
}: {
  t: ReturnType<typeof getDictionary>;
  contacts: ContactRecord[];
  attachments: AppData["attachments"];
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <form className="panel space-y-3" action={onSubmit}>
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
      </form>
      <div className="grid gap-4 md:grid-cols-2">
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
              <AttachmentList attachments={attachments.filter((attachment) => attachment.contactId === contact.id)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Taxes({ t, scoped, dateRange, setDateRange }: { t: ReturnType<typeof getDictionary>; scoped: AppData; dateRange: { start: string; end: string }; setDateRange: (range: { start: string; end: string }) => void }) {
  const report = generateTaxReport({ ...scoped, startDate: dateRange.start, endDate: dateRange.end });
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-400/20 bg-amber-400/8 p-4 text-sm text-amber-100">{t.disclaimer}</div>
      <div className="surface-muted flex flex-wrap gap-2 p-4">
        <input className="control compact-control" type="date" value={dateRange.start} onChange={(event) => setDateRange({ ...dateRange, start: event.target.value })} />
        <input className="control compact-control" type="date" value={dateRange.end} onChange={(event) => setDateRange({ ...dateRange, end: event.target.value })} />
        {[t.reports.monthly, t.reports.quarterly, t.reports.yearly, t.reports.custom, t.reports.pdf, t.reports.csv, t.reports.json].map((label) => <Badge key={label}>{label}</Badge>)}
      </div>
      <Panel title={t.sections.taxSummary}><InfoGrid rows={Object.entries(report).map(([key, value]) => [key, typeof value === "number" ? money(value) : String(value)])} /></Panel>
    </div>
  );
}

function Backups({ t, organizationId, onDownload }: { t: ReturnType<typeof getDictionary>; organizationId: string; onDownload: () => void }) {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  return (
    <Panel title={t.sections.backupStatus}>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="surface-muted p-4">
          <p className="font-medium text-white">{t.backup.localReady}</p>
          <button className="primary-button mt-4" onClick={onDownload}><Download size={18} />{t.actions.downloadBackup}</button>
        </div>
        <div className="surface-muted p-4">
          <p className="font-medium text-white">{t.backup.r2Inactive}</p>
          <p className="mt-3 text-sm text-slate-500">{t.backup.path}: dealer-flow-backups/{organizationId}/{year}/{month}/dealer-flow-backup-{today()}.zip</p>
        </div>
      </div>
    </Panel>
  );
}

function SettingsPage({
  t,
  organizations,
  activeOrganization,
  onCreate,
  onJoin,
  onSaveDefaultPlateCommission,
  onSignOut,
}: {
  t: ReturnType<typeof getDictionary>;
  organizations: AppData["organizations"];
  activeOrganization: AppData["organizations"][number];
  onCreate: (formData: FormData) => void;
  onJoin: (formData: FormData) => void;
  onSaveDefaultPlateCommission: (formData: FormData) => void;
  onSignOut: () => void;
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
      <Panel title={t.sections.roleManagement}><Ledger rows={organizations.map((organization) => [organization.name, formatLabel(organization.role), organization.inviteCode])} /><div className="mt-4 flex flex-wrap gap-2">{ROLES.map((role) => <Badge key={role}>{formatLabel(role)}</Badge>)}</div></Panel>
      <Panel title={t.sections.vehicleDefaults}>
        <form className="space-y-3" action={onSaveDefaultPlateCommission}>
          <Field label={t.fields.defaultPlateCommission}>
            <input
              className="control w-full"
              name="defaultPlateCommissionAmount"
              type="number"
              min="0"
              step="0.01"
              defaultValue={activeOrganization.defaultPlateCommissionAmount}
            />
          </Field>
          <p className="text-sm text-slate-500">{t.settings.defaultPlateCommissionHelp}</p>
          <button className="secondary-button" type="submit">{t.actions.saveSettings}</button>
        </form>
      </Panel>
      <Panel title={t.sections.privateStorage}><p className="flex items-center gap-2 text-slate-300"><Lock size={18} />{activeOrganization.name}</p><p className="mt-3 text-sm text-slate-500">{t.backup.r2Inactive}</p></Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="panel"><h3 className="section-title">{title}</h3>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm text-slate-300"><span className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</span>{children}</label>;
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-xs font-medium uppercase tracking-[0.1em] text-slate-500">{label}</dt><dd className="mt-1 font-medium text-slate-100">{value}</dd></div>;
}

function InfoGrid({ rows }: { rows: Array<[React.ReactNode, React.ReactNode]> }) {
  return <dl className="mt-3 grid gap-3 sm:grid-cols-2">{rows.filter(([, value]) => value !== undefined && value !== "").map(([label, value], index) => <Info key={index} label={String(label)} value={value} />)}</dl>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-md border border-cyan-300/15 bg-cyan-300/8 px-2 py-1 text-xs font-medium text-cyan-100">{children}</span>;
}

function AttachmentList({ attachments }: { attachments: AppData["attachments"] }) {
  if (attachments.length === 0) return <p className="mt-3 text-sm text-slate-500">-</p>;
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
            <a className="mt-2 block text-cyan-100 underline-offset-4 hover:underline" href={attachment.urlOrPath} target="_blank" rel="noreferrer">
              {attachment.urlOrPath}
            </a>
          )}
          {attachment.type !== "link" && attachment.previewUrl && (
            <a className="mt-2 block text-cyan-100 underline-offset-4 hover:underline" href={attachment.previewUrl} target="_blank" rel="noreferrer">
              Open private file
            </a>
          )}
          {attachment.notes && <p className="mt-2 text-slate-400">{attachment.notes}</p>}
        </div>
      ))}
    </div>
  );
}

function Ledger({ rows }: { rows: React.ReactNode[][] }) {
  return <div className="overflow-x-auto"><table className="data-table"><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function tabLabel(t: ReturnType<typeof getDictionary>, key: string) {
  return t.vehicleTabs[key as keyof typeof t.vehicleTabs] ?? key;
}

function scopeData(data: AppData, organizationId: string): AppData {
  return {
    ...data,
    vehicles: data.vehicles.filter((row) => row.organizationId === organizationId),
    expenses: data.expenses.filter((row) => row.organizationId === organizationId),
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
