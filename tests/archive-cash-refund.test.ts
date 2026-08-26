import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  COMPANY_CASH_TRANSACTION_TYPES,
  EXTERNAL_CASH_TRANSACTION_TYPES,
} from "@/lib/domain/constants";
import {
  calculateCompanyCashBalance,
  calculateExternalCashBalance,
} from "@/lib/domain/calculations";
import type {
  CompanyCashTransaction,
  ExternalCashTransaction,
} from "@/types/domain";

const migrationPath = join(process.cwd(), "supabase/migrations/20260825_archive_vehicle_cash_refund.sql");

function migrationSource() {
  return readFileSync(migrationPath, "utf8");
}

function countOccurrences(source: string, pattern: RegExp) {
  return [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))].length;
}

test("archive refund migration defines the existing archive RPC as one atomic owner/admin workflow", () => {
  const sql = migrationSource();

  assert.match(sql, /create or replace function archive_vehicle\(\s*p_organization_id uuid,\s*p_vehicle_id uuid,\s*p_reason text default null\s*\)/i);
  assert.match(sql, /auth\.uid\(\) is null/i);
  assert.match(sql, /has_org_role\(p_organization_id, array\['owner','admin'\]::app_role\[\]\)/i);
  assert.match(sql, /from organizations[\s\S]+for update/i);
  assert.match(sql, /from vehicles[\s\S]+for update/i);
  assert.match(sql, /vehicle already archived/i);
  assert.match(sql, /'vehicle_archived'/i);
});

test("archive refund eligibility is limited to live original vehicle-cost payments", () => {
  const sql = migrationSource();

  assert.ok(countOccurrences(sql, /type\s*=\s*'vehicle_cost_paid'/i) >= 1);
  assert.ok(countOccurrences(sql, /type\s*=\s*'external_vehicle_expense_paid'/i) >= 1);
  assert.ok(countOccurrences(sql, /deleted_at\s+is\s+null/i) >= 2);
  assert.ok(countOccurrences(sql, /correction_of_transaction_id\s+is\s+null/i) >= 2);
  assert.ok(countOccurrences(sql, /reversed_transaction_id\s+is\s+null/i) >= 2);
  assert.ok(countOccurrences(sql, /voided_at\s+is\s+null/i) >= 2);
  assert.match(sql, /source_vehicle_id\s*=\s*p_vehicle_id/i);
  assert.doesNotMatch(sql, /sum\s*\([^)]*vehicle_expenses/i);
  assert.doesNotMatch(sql, /calculateVehicleTotalCost/i);
});

test("archive refund migration creates one linked refund for each original and reverses originals without deletion", () => {
  const sql = migrationSource();

  assert.match(sql, /for\s+company_original\s+in\s+select\s+\*[\s\S]+from\s+company_cash_transactions[\s\S]+loop/i);
  assert.match(sql, /for\s+external_original\s+in\s+select\s+\*[\s\S]+from\s+external_cash_transactions[\s\S]+loop/i);
  assert.ok(countOccurrences(sql, /correction_of_transaction_id\s*,\s*\n?\s*created_by/i) >= 2);
  assert.match(sql, /company_original\.amount/i);
  assert.match(sql, /external_original\.amount/i);
  assert.ok(countOccurrences(sql, /reversed_transaction_id\s*=\s*refund_id/i) >= 2);
  assert.ok(countOccurrences(sql, /voided_at\s*=\s*now\(\)/i) >= 2);
  assert.doesNotMatch(sql, /delete\s+from\s+(vehicles|sales|vehicle_expenses|company_cash_transactions|external_cash_transactions|activity_logs)/i);
});

test("archive refund migration blocks active sales and preserves sale cash", () => {
  const sql = migrationSource();

  assert.match(sql, /from\s+sales[\s\S]+vehicle_id\s*=\s*p_vehicle_id[\s\S]+voided_at\s+is\s+null[\s\S]+status\s*=\s*'active'/i);
  assert.match(sql, /Sold vehicles with an active sale cannot be archived\. Void the sale first\./i);
  assert.doesNotMatch(sql, /type\s*=\s*'paper_sale_received'[\s\S]+vehicle_cost_refunded/i);
  assert.doesNotMatch(sql, /type\s*=\s*'external_commission_earned'[\s\S]+external_vehicle_expense_refunded/i);
});

test("archive refund includes purchase-price payments without reading expense categories or totals", () => {
  const sql = migrationSource();

  assert.match(sql, /type\s*=\s*'vehicle_cost_paid'/i);
  assert.match(sql, /company_original\.amount/i);
  assert.match(sql, /external_original\.amount/i);
  assert.doesNotMatch(sql, /category\s*=\s*'vehicle_purchase_price'/i);
  assert.doesNotMatch(sql, /total_amount/i);
});

test("deleted company and external expense payments are excluded before archive refund", () => {
  const sql = migrationSource();
  const companyLoop = sql.slice(sql.indexOf("for company_original"), sql.indexOf("for external_original"));
  const externalLoop = sql.slice(sql.indexOf("for external_original"));

  assert.match(companyLoop, /deleted_at\s+is\s+null/i);
  assert.match(externalLoop, /deleted_at\s+is\s+null/i);
  assert.match(companyLoop, /source_vehicle_id\s*=\s*p_vehicle_id/i);
  assert.match(externalLoop, /source_vehicle_id\s*=\s*p_vehicle_id/i);
});

test("already-reversed payments and archived vehicles cannot produce a second refund", () => {
  const sql = migrationSource();

  assert.match(sql, /reversed_transaction_id\s+is\s+null/i);
  assert.match(sql, /voided_at\s+is\s+null/i);
  assert.match(sql, /if\s+vehicle_record\.archived_at\s+is\s+not\s+null\s+then[\s\S]+vehicle already archived/i);
  assert.match(sql, /company_vehicle_cost_refund_original_unique_idx/i);
  assert.match(sql, /external_vehicle_expense_refund_original_unique_idx/i);
});

test("archive refund preserves unrelated organizations, vehicles, transfers, and sale income", () => {
  const sql = migrationSource();
  const archiveFunction = sql.slice(sql.indexOf("create or replace function archive_vehicle"));

  assert.match(archiveFunction, /organization_id\s*=\s*p_organization_id/i);
  assert.match(archiveFunction, /source_vehicle_id\s*=\s*p_vehicle_id/i);
  assert.doesNotMatch(archiveFunction, /company_cash_added|company_cash_withdrawn|external_cash_transferred_to_company|external_cash_personally_removed/i);
  assert.doesNotMatch(archiveFunction, /paper_sale_received|external_commission_earned/i);
});

test("archive refund guards keep refund rows immutable and block post-archive expense deletion", () => {
  const sql = migrationSource();

  assert.match(sql, /Vehicle archive refund rows are system-generated/i);
  assert.match(sql, /Vehicle archive refund rows cannot be edited or deleted/i);
  assert.match(sql, /Reversed vehicle cost payments cannot be edited or deleted/i);
  assert.match(sql, /type\s*=\s*'vehicle_cost_refunded'\s+then\s+coalesce\(p_amount, 0\)/i);
  assert.match(sql, /type\s*=\s*'external_vehicle_expense_refunded'\s+then\s+coalesce\(p_amount, 0\)/i);
});

test("refund transaction types are controlled and have positive cash effects", () => {
  assert.ok(COMPANY_CASH_TRANSACTION_TYPES.includes("vehicle_cost_refunded" as CompanyCashTransaction["type"]));
  assert.ok(EXTERNAL_CASH_TRANSACTION_TYPES.includes("external_vehicle_expense_refunded" as ExternalCashTransaction["type"]));

  const companyPaid: CompanyCashTransaction = {
    id: "company-paid",
    organizationId: "org-1",
    type: "vehicle_cost_paid",
    amount: 4200,
    date: "2026-08-25",
    createdAt: "2026-08-25",
    createdBy: "user-1",
  };
  const companyRefund: CompanyCashTransaction = {
    ...companyPaid,
    id: "company-refund",
    type: "vehicle_cost_refunded" as CompanyCashTransaction["type"],
    correctionOfTransactionId: companyPaid.id,
  };
  const externalPaid: ExternalCashTransaction = {
    id: "external-paid",
    organizationId: "org-1",
    type: "external_vehicle_expense_paid",
    amount: 300,
    date: "2026-08-25",
    createdAt: "2026-08-25",
    createdBy: "user-1",
  };
  const externalRefund: ExternalCashTransaction = {
    ...externalPaid,
    id: "external-refund",
    type: "external_vehicle_expense_refunded" as ExternalCashTransaction["type"],
    correctionOfTransactionId: externalPaid.id,
  };

  assert.equal(calculateCompanyCashBalance([companyPaid, companyRefund]), 0);
  assert.equal(calculateExternalCashBalance([externalPaid, externalRefund]), 0);
});

test("archive refund SQL preserves deleted and already-reversed payments as no-refund cases", () => {
  const sql = migrationSource();

  assert.match(sql, /deleted_at\s+is\s+null[\s\S]+reversed_transaction_id\s+is\s+null[\s\S]+voided_at\s+is\s+null/i);
  assert.match(sql, /correction_of_transaction_id\s+is\s+null[\s\S]+deleted_at\s+is\s+null/i);
  assert.match(sql, /vehicle archive refund/i);
  assert.match(sql, /source_expense_id/i);
});
