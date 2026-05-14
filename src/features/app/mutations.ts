export async function serverMutation(operation: string, formData: FormData) {
  const endpoint = mutationEndpoint(operation, formData);
  if (!endpoint) formData.set("operation", operation);
  const response = await fetch(endpoint?.url ?? "/api/mutations", { method: endpoint?.method ?? "POST", body: formData });
  const result = (await response.json()) as { ok?: boolean; message?: string; [key: string]: unknown };
  if (!response.ok || !result.ok) throw new Error(result.message || "Action failed.");
  return result;
}

export function mutationEndpoint(operation: string, formData: FormData): { url: string; method: string } | undefined {
  const vehicleId = encodeURIComponent(String(formData.get("vehicleId") || ""));
  const expenseId = encodeURIComponent(String(formData.get("expenseId") || ""));
  const saleId = encodeURIComponent(String(formData.get("saleId") || ""));
  const account = encodeURIComponent(String(formData.get("account") || ""));
  const transactionId = encodeURIComponent(String(formData.get("transactionId") || ""));
  if (operation === "createVehicle") return { url: "/api/vehicles", method: "POST" };
  if (operation === "updateVehicle" && vehicleId) return { url: `/api/vehicles/${vehicleId}`, method: "PATCH" };
  if (operation === "deleteVehicle" && vehicleId) return { url: `/api/vehicles/${vehicleId}/archive`, method: "POST" };
  if (operation === "createExpense" && vehicleId) return { url: `/api/vehicles/${vehicleId}/expenses`, method: "POST" };
  if (operation === "updateExpense" && vehicleId && expenseId) return { url: `/api/vehicles/${vehicleId}/expenses/${expenseId}`, method: "PATCH" };
  if (operation === "deleteExpense" && vehicleId && expenseId) return { url: `/api/vehicles/${vehicleId}/expenses/${expenseId}`, method: "DELETE" };
  if (operation === "recordSale" && vehicleId) return { url: `/api/vehicles/${vehicleId}/sale`, method: "POST" };
  if (operation === "voidSale" && saleId) return { url: `/api/sales/${saleId}/void`, method: "POST" };
  if (operation === "correctSale" && saleId) return { url: `/api/sales/${saleId}/correct`, method: "POST" };
  if (operation === "createCashTransaction") {
    const type = String(formData.get("type") || "");
    return { url: `/api/cash/${type.startsWith("external_") ? "external" : "company"}`, method: "POST" };
  }
  if (operation === "updateCashTransaction" && account && transactionId) return { url: `/api/cash/${account}/${transactionId}`, method: "PATCH" };
  if (operation === "deleteCashTransaction" && account && transactionId) return { url: `/api/cash/${account}/${transactionId}/reverse`, method: "POST" };
  return undefined;
}
