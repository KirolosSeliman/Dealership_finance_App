import JSZip from "jszip";
import type { AppData } from "@/types/domain";
import { generateTaxReport } from "@/lib/domain/calculations";

export async function generateBackupExport(data: AppData) {
  const zip = new JSZip();
  const report = generateTaxReport(data);

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
  zip.file(
    "summary.pdf.txt",
    [
      "Dealer Flow readable backup summary",
      "PDF generation adapter placeholder for server-side renderer.",
      `Total taxable profit: ${report.totalTaxableProfit}`,
      `Estimated tax due: ${report.taxDue}`,
    ].join("\n"),
  );

  return zip.generateAsync({ type: "blob" });
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
