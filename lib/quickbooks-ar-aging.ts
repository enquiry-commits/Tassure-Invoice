import { getValidToken, correctedCustomerName, type QbCompany } from './quickbooks';
import type { AgingBucket } from './soa';

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
