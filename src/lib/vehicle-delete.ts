import type { Vehicle } from "@/types/domain";

export function normalizeDeleteConfirmation(value: string) {
  return value.trim().toUpperCase();
}

export function normalizeVehicleVin(vin?: string) {
  return String(vin ?? "").trim().toUpperCase();
}

export function expectedVehicleDeleteConfirmation(vehicle: Pick<Vehicle, "id" | "vin">) {
  const identifier = normalizeVehicleVin(vehicle.vin) || vehicle.id.trim().toUpperCase();
  return `DELETE ${identifier}`;
}

export function isValidVehicleDeleteConfirmation(input: string, vehicle: Pick<Vehicle, "id" | "vin">) {
  const normalizedInput = normalizeDeleteConfirmation(input);
  return normalizedInput === expectedVehicleDeleteConfirmation(vehicle);
}

export function isArchivedVehicle(vehicle: Pick<Vehicle, "archivedAt">) {
  return Boolean(vehicle.archivedAt);
}

export function activeVehiclesOnly<T extends Pick<Vehicle, "archivedAt">>(vehicles: T[]) {
  return vehicles.filter((vehicle) => !isArchivedVehicle(vehicle));
}
