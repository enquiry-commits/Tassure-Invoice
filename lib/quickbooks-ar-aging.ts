import 'server-only';

import { getValidToken, correctedCustomerName, type QbCompany } from './quickbooks';
import type { AgingBucket } from './soa';
import { createAdminClient } from './supabase';
import { todaySGT } from './date';
import { replaceAutomationExceptions } from './automation-sync';

// Fetches and parses QuickBooks' own "Aged Receivable Detail" report —
// added 2026-09-15 after live verification found that syncing individual
// entity types (Invoice, CreditMemo) can never be assumed complete: this
// business's real QuickBooks data also has Payment, Journal Entry, and
// (TAB) Deposit transactions affecting Accounts Receivable, none of which
// this app synced before. This report is comprehensive BY CONSTRUCTION —
// QuickBooks' own accounting engine enumerates every entity type relevant
// to a customer's AR balance, including ones not yet seen in this specific
// data (a future 6th type requires zero code changes here) — and already
// converts multi-currency balances to the home currency (SGD). See
// docs/INVARIANTS.md INV-QB-017 for the full incident this responds to.
//
// Report structure (confirmed live against all 3 QB companies, 2026-09-15
// — verify again if QuickBooks' report format ever changes):
//   Columns: Date, Transaction Type, No., Customer, Location, Due Date,
//            Amount, Open Balance
//   Rows.Row[] — one entry per aging bucket SECTION, in this fixed order:
//     "91 or more days past due", "61 - 90 days past due",
//     "31 - 60 days past due", "1 - 30 days past due", "Current"
//     (then one final wrapper Section with no Header — the report's own
//     Grand Total, Summary only, no nested Rows)
//   Each bucket Section has: Header.ColData[0].value (the bucket label),
//     Rows.Row[] (the real transactions, type:'Data'), and its own
//     Summary (a per-bucket subtotal — skip, never treat as a transaction).
const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

// Matched by exact label first (fast path); the fallback array below is
// positional (QuickBooks always emits these 5 sections in this fixed
// order) so an unexpected label still lands in the right bucket instead of
// being silently miscategorized — see fetchAgedReceivableDetail's use of
// `bucketOrder`.
const BUCKET_LABEL_MAP: Record<string, AgingBucket> = {
  'current': 'current',
  '1 - 30 days past due': 'd1_30',
  '31 - 60 days past due': 'd31_60',
  '61 - 90 days past due': 'd61_90',
  '91 or more days past due': 'd91_plus',
};
const BUCKET_ORDER: AgingBucket[] = ['d91_plus', 'd61_90', 'd31_60', 'd1_30', 'current'];

export interface ParsedArAgingRow {
  agingBucket: AgingBucket;
  txnType: string;
  qbTxnId: string | null;
  docNumber: string | null;
  customerName: string;
  qbCustomerId: string | null;
  txnDate: string | null;
  dueDate: string | null;
  amount: number | null;
  openBalance: number;
  locationName: string | null;
}

interface ReportColData { value?: string; id?: string }
interface ReportRow {
  type?: string;
  Header?: { ColData?: ReportColData[] };
  Summary?: { ColData?: ReportColData[] };
  Rows?: { Row?: ReportRow[] };
  ColData?: ReportColData[];
}

function toNumberOrNull(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v: string | undefined): string | null {
  return v && v.trim() ? v : null;
}

export async function fetchAgedReceivableDetail(
  company: QbCompany, reportDate: string,
): Promise<{ rows: ParsedArAgingRow[]; grandTotal: number } | null> {
  const token = await getValidToken(company);
  if (!token) return null;

  const url = `${QB_BASE}/v3/company/${token.realm_id}/reports/AgedReceivableDetail?report_date=${reportDate}&minorversion=65`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.error('QB AgedReceivableDetail error:', company, res.status, await res.text());
    return null;
  }
  const report = await res.json();

  const columns: string[] = (report.Columns?.Column ?? []).map((c: { ColTitle?: string }) => c.ColTitle ?? '');
  const idx = (title: string) => columns.indexOf(title);
  const colDate = idx('Date'), colType = idx('Transaction Type'), colNo = idx('No.'),
    colCustomer = idx('Customer'), colLocation = idx('Location'), colDue = idx('Due Date'),
    colAmount = idx('Amount'), colOpenBalance = idx('Open Balance');

  const topRows: ReportRow[] = report.Rows?.Row ?? [];
  const rows: ParsedArAgingRow[] = [];
  let grandTotal = 0;

  let bucketPosition = 0;
  for (const section of topRows) {
    const label = section.Header?.ColData?.[0]?.value;
    if (label === undefined) {
      // The final, header-less wrapper Section — the report's own Grand
      // Total. No nested transactions here; just read its own Open Balance.
      grandTotal = toNumberOrNull(section.Summary?.ColData?.[colOpenBalance]?.value) ?? 0;
      continue;
    }
    const normalizedLabel = label.trim().toLowerCase();
    const bucket = BUCKET_LABEL_MAP[normalizedLabel] ?? BUCKET_ORDER[bucketPosition] ?? 'd91_plus';
    bucketPosition++;

    for (const txnRow of section.Rows?.Row ?? []) {
      if (txnRow.type !== 'Data' || !txnRow.ColData) continue;
      const cd = txnRow.ColData;
      const qbCustomerId = cd[colCustomer]?.id ?? null;
      const rawCustomerName = cd[colCustomer]?.value ?? '';
      rows.push({
        agingBucket: bucket,
        txnType: cd[colType]?.value ?? '',
        qbTxnId: cd[colType]?.id ?? null,
        docNumber: cd[colNo]?.value || null,
        customerName: correctedCustomerName(company, qbCustomerId ?? '', rawCustomerName),
        qbCustomerId,
        txnDate: toDateOrNull(cd[colDate]?.value),
        dueDate: toDateOrNull(cd[colDue]?.value),
        amount: toNumberOrNull(cd[colAmount]?.value),
        openBalance: toNumberOrNull(cd[colOpenBalance]?.value) ?? 0,
        locationName: cd[colLocation]?.value || null,
      });
    }
  }

  return { rows, grandTotal };
}

// ── QuickBooks Aged Receivable Detail report sync ────────────────────────
// Added 2026-09-15 — supersedes the Invoice+CreditMemo netting above as the
// TOTAL/aging source (lib/soa-data.ts's computeSoaRows() reads this table
// when fresh; falls back to legacyComputeSoaRows() otherwise). Live
// verification found the Invoice+CreditMemo approach could never be
// assumed complete — this business's real QuickBooks data also has
// Payment, Journal Entry, and (TAB) Deposit transactions affecting AR that
// were never synced, plus multi-currency balances never converted to SGD.
// This report is comprehensive by construction (QuickBooks' own accounting
// engine enumerates every entity type relevant to AR) and already SGD-
// converts. See scripts/add-quickbooks-ar-aging-detail.sql and
// docs/INVARIANTS.md INV-QB-017 for the full incident.
//
// Unlike syncYear/syncCreditMemoYear, this is NOT date-ranged and does NOT
// upsert-by-id — a report row has no stable identity across two different
// days' runs, so every run inserts an entirely new snapshot tagged with
// this run's id, then deletes the previous run's rows for this company
// (insert-new-then-delete-old, never delete-then-insert, so a concurrent
// read never sees a company with zero rows mid-sync).
//
// Moved here 2026-09-16 (was a non-exported local function in
// app/api/quickbooks/sync/route.ts) and exported so lib/quickbooks-webhook-
// queue.ts can call the SAME function on a QuickBooks webhook event, not a
// second copy — see docs/INVARIANTS.md INV-QB-021 for why "real-time"
// Outstanding updates reuse this exact report sync rather than syncing
// individual entity types (the reactive pattern INV-QB-017 already rejected
// once) triggered by the webhook instead.
export async function syncAgedReceivableDetail(company: QbCompany, runId: string) {
  const reportDate = todaySGT();
  const parsed = await fetchAgedReceivableDetail(company, reportDate);
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  if (!parsed) {
    await supabase.from('quickbooks_ar_aging_sync_state').upsert({
      qb_company: company, last_status: 'error', last_synced_at: now,
      last_error: `QuickBooks ${company} AgedReceivableDetail fetch failed or not connected`,
    }, { onConflict: 'qb_company' });
    return { error: `QuickBooks ${company} AgedReceivableDetail fetch failed or not connected` };
  }

  const rows = parsed.rows.map(r => ({
    qb_company: company,
    report_date: reportDate,
    aging_bucket: r.agingBucket,
    txn_type: r.txnType,
    qb_txn_id: r.qbTxnId,
    doc_number: r.docNumber,
    qb_customer_id: r.qbCustomerId,
    customer_name: r.customerName,
    txn_date: r.txnDate,
    due_date: r.dueDate,
    amount: r.amount,
    open_balance: r.openBalance,
    location_name: r.locationName,
    sync_run_id: runId,
    scraped_at: now,
  }));

  let done = 0;
  let upsertErr: { message: string } | null = null;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('quickbooks_ar_aging_detail').insert(rows.slice(i, i + 200));
    if (error) { upsertErr = error; break; }
    done += Math.min(200, rows.length - i);
  }

  if (upsertErr) {
    await supabase.from('quickbooks_ar_aging_sync_state').upsert({
      qb_company: company, last_status: 'error', last_synced_at: now,
      last_row_count: done, last_error: upsertErr.message,
    }, { onConflict: 'qb_company' });
    return { error: `QuickBooks ${company} AgedReceivableDetail insert failed: ${upsertErr.message}`, ar_aging_rows_synced: done };
  }

  // Only now that this run's new rows are fully written, remove the
  // previous run's rows for this company — never the other way around.
  const { error: staleError } = await supabase
    .from('quickbooks_ar_aging_detail')
    .delete()
    .eq('qb_company', company)
    .neq('sync_run_id', runId);
  if (staleError) {
    await supabase.from('quickbooks_ar_aging_sync_state').upsert({
      qb_company: company, last_status: 'error', last_synced_at: now,
      last_row_count: done, last_error: `Stale-row cleanup failed: ${staleError.message}`,
    }, { onConflict: 'qb_company' });
    return { error: `QuickBooks ${company} AgedReceivableDetail stale-row cleanup failed: ${staleError.message}`, ar_aging_rows_synced: done };
  }

  // Cheap, high-value self-check: does our parsed row sum match the
  // report's own printed Grand Total? A large delta means a parsing bug or
  // an unhandled report quirk, caught immediately instead of silently
  // trusted — see the table comment on last_grand_total_check.
  const parsedSum = rows.reduce((s, r) => s + r.open_balance, 0);
  const delta = Math.abs(parsedSum - parsed.grandTotal);
  await replaceAutomationExceptions('quickbooks', `ar_aging_grand_total_mismatch_${company}`,
    delta > 0.05 ? [{
      key: company,
      name: `${company} AgedReceivableDetail parse mismatch`,
      details: { parsedSum, reportGrandTotal: parsed.grandTotal, delta, rowCount: rows.length },
    }] : []);

  await supabase.from('quickbooks_ar_aging_sync_state').upsert({
    qb_company: company, last_status: 'success', last_synced_at: now,
    last_row_count: rows.length, last_error: null, last_grand_total_check: delta,
  }, { onConflict: 'qb_company' });

  return { ar_aging_rows_synced: rows.length, grand_total_delta: delta };
}
