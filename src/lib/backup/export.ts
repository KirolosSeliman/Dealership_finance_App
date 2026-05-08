import JSZip from "jszip";
import type { AppData } from "@/types/domain";
import { generateTaxReport } from "@/lib/domain/calculations";

export const BACKUP_VERSION = 1;

export async function generateBackupExport(data: AppData) {
  const zip = new JSZip();
  const report = generateTaxReport(data);
  const manifest = {
    appName: "Dealer Flow",
    backupVersion: BACKUP_VERSION,
    generatedAt: new Date().toISOString(),
    organizationId: data.activeOrganizationId,
    counts: {
      vehicles: data.vehicles.length,
      expenses: data.expenses.length,
      sales: data.sales.length,
      companyCashTransactions: data.companyCashTransactions.length,
      externalCashTransactions: data.externalCashTransactions.length,
      contacts: data.contacts.length,
      attachments: data.attachments.length,
      activityLogs: data.activityLogs.length,
    },
  };

  zip.file("backup-manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("full-backup.json", JSON.stringify(data, null, 2));
  zip.file("vehicles.csv", toCsv(data.vehicles));
  zip.file("expenses.csv", toCsv(data.expenses));
  zip.file("sales.csv", toCsv(data.sales));
  zip.file("company-cash-transactions.csv", toCsv(data.companyCashTransactions));
  zip.file("external-cash-transactions.csv", toCsv(data.externalCashTransactions));
  zip.file("contacts.csv", toCsv(data.contacts));
  zip.file("tax-reports.csv", toCsv([report]));
  zip.file("attachments-metadata.json", JSON.stringify(data.attachments, null, 2));
  zip.file("activity-logs.csv", toCsv(data.activityLogs));
  const summaryPdf = await generateReportPdf({
    title: "Dealer Flow Backup Summary",
    organizationId: data.activeOrganizationId,
    lines: [
      `Generated: ${manifest.generatedAt}`,
      "These calculations are estimates and must be validated by an accountant or tax professional.",
      `Vehicles: ${data.vehicles.length}`,
      `Expenses: ${data.expenses.length}`,
      `Sales: ${data.sales.length}`,
      `Company cash transactions: ${data.companyCashTransactions.length}`,
      `External cash transactions: ${data.externalCashTransactions.length}`,
      `Contacts: ${data.contacts.length}`,
      `Total taxable profit: ${report.totalTaxableProfit}`,
      `Estimated tax due: ${report.taxDue}`,
    ],
  });
  zip.file("summary.pdf", await summaryPdf.arrayBuffer());

  return zip.generateAsync({ type: "blob" });
}

export async function verifyBackupExport(file: Blob) {
  const requiredFiles = [
    "backup-manifest.json",
    "full-backup.json",
    "vehicles.csv",
    "expenses.csv",
    "sales.csv",
    "company-cash-transactions.csv",
    "external-cash-transactions.csv",
    "contacts.csv",
    "tax-reports.csv",
    "attachments-metadata.json",
    "activity-logs.csv",
    "summary.pdf",
  ];
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const missing = requiredFiles.filter((name) => !zip.file(name));
  const errors: string[] = [];
  let manifest: Record<string, unknown> | null = null;

  if (missing.length === 0) {
    try {
      const parsedManifest = JSON.parse(await zip.file("backup-manifest.json")!.async("text")) as Record<string, unknown>;
      manifest = parsedManifest;
      const fullBackup = JSON.parse(await zip.file("full-backup.json")!.async("text")) as Record<string, unknown>;
      JSON.parse(await zip.file("attachments-metadata.json")!.async("text"));
      if (!parsedManifest.organizationId) errors.push("backup-manifest.json is missing organizationId.");
      if (!parsedManifest.generatedAt) errors.push("backup-manifest.json is missing generatedAt.");
      if (parsedManifest.backupVersion !== BACKUP_VERSION) errors.push("Unsupported backup version.");
      if (!fullBackup.activeOrganizationId) errors.push("full-backup.json is missing activeOrganizationId.");
      for (const name of requiredFiles.filter((item) => item.endsWith(".csv"))) {
        await zip.file(name)!.async("text");
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Backup JSON files could not be parsed.");
    }
  }

  return {
    ok: missing.length === 0 && errors.length === 0,
    valid: missing.length === 0 && errors.length === 0,
    invalid: missing.length > 0 || errors.length > 0,
    warnings: [] as string[],
    missing,
    errors,
    manifest,
  };
}

export async function restoreBackupDryRun(file: Blob) {
  const verification = await verifyBackupExport(file);
  if (!verification.ok) {
    return {
      ok: false,
      verification,
      summary: null,
      conflicts: verification.errors,
    };
  }

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const fullBackup = JSON.parse(await zip.file("full-backup.json")!.async("text")) as AppData;
  const duplicateIds = findDuplicateIds([
    ...fullBackup.vehicles.map((row) => `vehicle:${row.id}`),
    ...fullBackup.expenses.map((row) => `expense:${row.id}`),
    ...fullBackup.sales.map((row) => `sale:${row.id}`),
    ...fullBackup.companyCashTransactions.map((row) => `company_cash:${row.id}`),
    ...fullBackup.externalCashTransactions.map((row) => `external_cash:${row.id}`),
    ...fullBackup.contacts.map((row) => `contact:${row.id}`),
  ]);
  const conflicts = [
    ...duplicateIds.map((id) => `Duplicate record id in backup: ${id}`),
    ...fullBackup.vehicles.filter((row) => !row.organizationId).map((row) => `Vehicle ${row.id} is missing organizationId.`),
    ...fullBackup.expenses.filter((row) => !row.organizationId || !row.vehicleId).map((row) => `Expense ${row.id} is missing organizationId or vehicleId.`),
    ...fullBackup.sales.filter((row) => !row.organizationId || !row.vehicleId).map((row) => `Sale ${row.id} is missing organizationId or vehicleId.`),
  ];

  return {
    ok: conflicts.length === 0,
    verification,
    summary: {
      organizationId: fullBackup.activeOrganizationId,
      vehicles: fullBackup.vehicles.length,
      expenses: fullBackup.expenses.length,
      sales: fullBackup.sales.length,
      companyCashTransactions: fullBackup.companyCashTransactions.length,
      externalCashTransactions: fullBackup.externalCashTransactions.length,
      contacts: fullBackup.contacts.length,
      attachments: fullBackup.attachments.length,
      taxReports: 0,
    },
    conflicts,
  };
}

export async function generateReportPdf(input: { title: string; organizationId: string; lines: string[] }) {
  const textLines = [input.title, `Organization: ${input.organizationId}`, ...input.lines].map(escapePdfText);
  const content = [
    "BT",
    "/F1 18 Tf",
    "50 780 Td",
    `(${textLines[0]}) Tj`,
    "/F1 10 Tf",
    ...textLines.slice(1).flatMap((line) => ["0 -18 Td", `(${line}) Tj`]),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

export function toCsv<T extends object>(rows: T[]) {
  if (rows.length === 0) return "";
  const normalizedRows = rows.map((row) => row as Record<string, unknown>);
  const headers = Array.from(new Set(normalizedRows.flatMap((row) => Object.keys(row))));
  const lines = normalizedRows.map((row) =>
    headers
      .map((header) => {
        const value = row[header];
        const text = value === undefined || value === null ? "" : String(value);
        return `"${text.replaceAll('"', '""')}"`;
      })
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

function findDuplicateIds(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return Array.from(duplicates);
}

function escapePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}
