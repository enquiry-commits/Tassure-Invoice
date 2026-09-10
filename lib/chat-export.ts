import 'server-only';
import { listCompanies, type CompanyListFilters } from '@/lib/company-list-lookup';
import { getCollectionsWorklist } from '@/lib/outstanding-lookup';
import { getUpcomingDeadlines } from '@/lib/deadlines-lookup';
import { getLateFilingList } from '@/app/api/late-filing/route';
import { categorizeLateFilingRow } from '@/lib/late-filing-categorize';
import { type DataRow, type ExportColumn } from '@/lib/export-columns';
import type { QbCompany } from '@/lib/quickbooks';
import { todaySGT } from '@/lib/date';

/**
 * "Hand me the list" — the .xlsx behind a chat answer (2026-09-10).
 *
 * The gap this closes: chat could finally ANSWER list questions ("哪些客户
 * 12月FYE", "谁欠钱", "现在有几家逾期") but a person cannot work from a
 * number, or from the first 40 of 419 names printed in a chat bubble. They
 * need the actual list, in the tool they actually work in — Excel. Without
 * this the honest end of every such answer was "go to the page, re-apply
 * the filter yourself, then export" — which is the manual work the chat was
 * supposed to remove.
 *
 * THE LOAD-BEARING RULE: nothing the model wrote ever reaches the file.
 * An export names a KIND and its PARAMETERS; this module then re-runs the
 * same tested lookup the chat tool ran, server-side, and builds the sheet
 * from THAT. If the model hallucinated a company into its prose, the
 * spreadsheet still contains only what the query really returned. This is
 * the same reasoning as INV-DATA-033 (chat previews, never chat writes) and
 * INV-DATA-032 (real counts come from real queries, never from a capped
 * read) applied to files instead of to screens.
 *
 * Second rule: an export is NEVER truncated. Being cut off at 40 rows is
 * precisely the failure this exists to fix, so every kind here deliberately
 * asks its lookup for everything (CompanyListFilters.unlimited, an
 * effectively-unbounded collections limit) rather than reusing the chat
 * tool's display cap.
 */

export type ChatExportSpec =
  | { kind: 'company_list'; filters: CompanyListFilters }
  | { kind: 'collections'; owner: string | null }
  | { kind: 'deadlines'; rangeDays: number }
  | { kind: 'late_filing' };

// What a list-shaped chat tool attaches to its result so the UI can offer
// the download. It carries the QUERY, never the rows — the file is built by
// re-running that query server-side (see the module comment above).
export type ChatExportOffer = {
  spec: ChatExportSpec;
  label: string;
  count: number;
};

export type ChatExportResult = {
  filename: string;
  sheetName: string;
  titleRow: string;
  rows: DataRow[];
  columns: ExportColumn[];
};

const COMPANY_COLUMNS: ExportColumn[] = [
  { key: 'companyName', label: 'Company Name', width: 44 },
  { key: 'uen', label: 'UEN', width: 18 },
  { key: 'status', label: 'Status', width: 18 },
  { key: 'pic', label: 'Secretary PIC', width: 20, format: 'staffName' },
  { key: 'companyType', label: 'Company Type', width: 28 },
  { key: 'industry', label: 'Industry (SSIC)', width: 40 },
  { key: 'services', label: 'Services', width: 30 },
];

const COLLECTIONS_COLUMNS: ExportColumn[] = [
  { key: 'companyName', label: 'Customer', width: 44 },
  { key: 'qbCompany', label: 'QB Book', width: 12 },
  { key: 'totalOutstanding', label: 'Outstanding (SGD)', width: 20 },
  { key: 'invoiceCount', label: 'Open Invoices', width: 15 },
  { key: 'oldestAgingBucketLabel', label: 'Oldest Aging', width: 18 },
  { key: 'owner', label: 'Owner', width: 22, format: 'staffName' },
];

const DEADLINE_COLUMNS: ExportColumn[] = [
  { key: 'companyName', label: 'Company Name', width: 44 },
  { key: 'kindLabel', label: 'Deadline Type', width: 20 },
  { key: 'dueDate', label: 'Due Date', width: 16, format: 'date' },
  { key: 'status', label: 'Status', width: 16 },
  { key: 'daysUntilDue', label: 'Days Until Due', width: 16 },
  { key: 'pic', label: 'PIC', width: 20, format: 'staffName' },
  { key: 'extendedFrom', label: 'Extended From (EOT)', width: 20, format: 'date' },
  { key: 'detail', label: 'Detail', width: 30 },
];

const LATE_FILING_COLUMNS: ExportColumn[] = [
  { key: 'company_name', label: 'Company Name', width: 44 },
  { key: 'uen', label: 'UEN', width: 18 },
  { key: 'category', label: 'Category', width: 14 },
  { key: 'late_fy', label: 'Outstanding FY', width: 16 },
  { key: 'financial_year_end', label: 'FYE', width: 16, format: 'date' },
  { key: 'next_agm_due_date', label: 'AGM Due', width: 16, format: 'date' },
  { key: 'last_annual_return_date', label: 'Last AR Filed', width: 16, format: 'date' },
  { key: 'last_agm_date', label: 'Last AGM Held', width: 16, format: 'date' },
  { key: 'pic', label: 'Secretary PIC', width: 20, format: 'staffName' },
  { key: 'source', label: 'Source', width: 12 },
  { key: 'remarks', label: 'Remarks', width: 40 },
];

const DEADLINE_KIND_LABEL: Record<string, string> = {
  ar_filing: 'AR Filing',
  agm: 'AGM',
  trademark_renewal: 'Trademark Renewal',
};

// A filename a person can find again a week later, not "export(3).xlsx".
// SGT — a file a Singapore office generates at 9am must not be stamped
// with yesterday's date (UTC is still the previous day until 08:00 SGT).
const stamp = () => todaySGT();
const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';

function describeFilters(filters: CompanyListFilters): string {
  const parts: string[] = [];
  if (filters.pic) parts.push(`PIC: ${filters.pic}`);
  if (filters.fyeMonth) parts.push(`FYE: ${filters.fyeMonth}`);
  if (filters.service) parts.push(`Service: ${filters.service}`);
  if (filters.industry) parts.push(`Industry: ${filters.industry}`);
  if (filters.companyType) parts.push(`Type: ${filters.companyType}`);
  if (filters.customerSource) parts.push(`Source: ${filters.customerSource}`);
  if (filters.status) parts.push(`Status: ${filters.status}`);
  parts.push(filters.activeOnly === false ? 'Including inactive' : 'Active clients only');
  return parts.join(' · ');
}

export async function buildChatExport(spec: ChatExportSpec): Promise<ChatExportResult> {
  if (spec.kind === 'company_list') {
    const result = await listCompanies({ ...spec.filters, unlimited: true });
    return {
      filename: `Companies-${safe(describeFilters(spec.filters).slice(0, 40))}-${stamp()}.xlsx`,
      sheetName: 'Companies',
      titleRow: `Company List — ${describeFilters(spec.filters)} — ${result.totalMatched} companies as at ${stamp()}`,
      columns: COMPANY_COLUMNS,
      rows: result.companies.map(c => ({ ...c, services: c.services.join(', ') })),
    };
  }

  if (spec.kind === 'collections') {
    const books: QbCompany[] = ['TAB', 'TAC', 'TAO'];
    // Effectively unbounded: getCollectionsWorklist's `limit` exists to keep
    // the chat reply readable, which is not a constraint a spreadsheet has.
    const worklist = await getCollectionsWorklist(spec.owner, books, 100_000);
    const who = worklist.owner ?? 'All owners';
    return {
      filename: `Collections-${safe(who)}-${stamp()}.xlsx`,
      sheetName: 'Collections',
      titleRow: `Collections Worklist — ${who} — ${worklist.companyCount} customers, S$${worklist.totalOutstanding.toFixed(2)} outstanding as at ${stamp()}`,
      columns: COLLECTIONS_COLUMNS,
      rows: worklist.rows as unknown as DataRow[],
    };
  }

  if (spec.kind === 'deadlines') {
    const result = await getUpcomingDeadlines(spec.rangeDays, 100_000);
    const toRow = (d: { kind: string; companyName: string; dueDate: string; daysUntilDue: number; pic: string | null; extendedFrom: string | null; detail: string | null }, status: string): DataRow => ({
      companyName: d.companyName,
      kindLabel: DEADLINE_KIND_LABEL[d.kind] ?? d.kind,
      dueDate: d.dueDate,
      status,
      daysUntilDue: d.daysUntilDue,
      pic: d.pic,
      extendedFrom: d.extendedFrom,
      detail: d.detail,
    });
    // Overdue first — that is the order someone works the list in.
    const rows = [
      ...result.overdue.map(d => toRow(d, 'OVERDUE')),
      ...result.upcoming.map(d => toRow(d, 'Upcoming')),
    ];
    return {
      filename: `Deadlines-next-${spec.rangeDays}-days-${stamp()}.xlsx`,
      sheetName: 'Deadlines',
      titleRow: `Deadlines — ${result.overdue.length} overdue + ${result.upcoming.length} due within ${spec.rangeDays} days, as at ${result.today}`,
      columns: DEADLINE_COLUMNS,
      rows,
    };
  }

  // late_filing — the same "still relevant" set the Late Filing page's own
  // default view is built from (getLateFilingList), carrying each row's
  // real category from the shared categoriser rather than a second opinion.
  const rows = await getLateFilingList();
  const withCategory = rows
    .map(r => ({ ...r, category: categorizeLateFilingRow(r) }))
    .sort((a, b) => a.company_name.localeCompare(b.company_name));
  const active = withCategory.filter(r => r.category !== 'resolved').length;
  return {
    filename: `Late-Filing-${stamp()}.xlsx`,
    sheetName: 'Late Filing',
    titleRow: `Late Filing — ${active} active overdue of ${withCategory.length} rows, as at ${stamp()}`,
    columns: LATE_FILING_COLUMNS,
    rows: withCategory as unknown as DataRow[],
  };
}
