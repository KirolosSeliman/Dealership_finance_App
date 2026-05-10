export function normalizeDeleteConfirmation(value: string) {
  return value.trim().toUpperCase();
}

export function normalizeVehicleVin(vin?: string) {
  return String(vin ?? "").trim().toUpperCase();
}

export function isValidVehicleDeleteConfirmation(input: string, vin?: string) {
  const normalizedInput = normalizeDeleteConfirmation(input);
  if (!normalizedInput) return false;
  if (normalizedInput === "DELETE") return true;
  const normalizedVin = normalizeVehicleVin(vin);
  return Boolean(normalizedVin) && normalizedInput === normalizedVin;
}
