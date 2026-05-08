import type { Role } from "@/types/domain";

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/csv",
]);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_BACKUP_VERIFY_BYTES = 50 * 1024 * 1024;

export function canManageOperationalData(role?: Role | string) {
  return role === "owner" || role === "admin" || role === "member";
}

export function canManageCash(role?: Role | string) {
  return role === "owner" || role === "admin";
}

export function canManageBackups(role?: Role | string) {
  return role === "owner" || role === "admin";
}

export function canExportTaxReports(role?: Role | string) {
  return role === "owner" || role === "admin" || role === "accountant";
}

export function canManageRoles(role?: Role | string) {
  return role === "owner";
}

export function sanitizeStorageFileName(name: string) {
  const baseName = name.split(/[\\/]/).pop() || "upload";
  return baseName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "upload";
}

export function assertAllowedUpload(file: File) {
  if (file.size <= 0) throw new Error("Uploaded file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Uploaded file is larger than 10 MB.");
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.type)) {
    throw new Error("This file type is not allowed.");
  }
}

export function sanitizeCsvCell(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  const escapedFormula = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${escapedFormula.replaceAll('"', '""')}"`;
}
