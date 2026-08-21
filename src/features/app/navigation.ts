export type View = "dashboard" | "vehicles" | "marketSnap" | "dealRadar" | "marketData" | "cash" | "contacts" | "taxes" | "backups" | "settings";
export type VehicleMode = "list" | "new" | "detail";
export type VehicleTab = "overview" | "details" | "expenses" | "documents" | "sale" | "timeline";

export function getRouteState(pathname: string, searchParams: string) {
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
  if (parts[0] === "market-snap" || parts[0] === "deal-radar" || parts[0] === "market-data") {
    return { view: "dashboard" as View, mode: "list" as VehicleMode };
  }
  const routeMap: Record<string, View> = {
    dashboard: "dashboard",
    cash: "cash",
    contacts: "contacts",
    taxes: "taxes",
    backups: "backups",
    settings: "settings",
  };
  if (root && routeMap[root]) {
    return { view: routeMap[root], mode: "list" as VehicleMode };
  }
  return { view: "dashboard" as View, mode: "list" as VehicleMode };
}

export function pathForView(view: View) {
  if (view === "dashboard") return "/dashboard";
  if (view === "marketSnap") return "/market-snap";
  if (view === "dealRadar") return "/deal-radar";
  if (view === "marketData") return "/market-data";
  return `/${view}`;
}
