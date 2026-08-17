import ExcelJS from 'exceljs';
import { toDisplayDate } from './date';
import { formatStaffName } from './staff-directory';

// Shared by app/api/export/company-data (the Dashboard's combined workbook)
// and app/api/ar-reminder/export (a single-cycle AR Reminder download) so
// the two never drift into different column sets/order/formatting for the
// same table.
//
// Uses exceljs, not the `xlsx` package used elsewhere in this repo for
// *reading* uploaded workbooks — `xlsx`'s free/community build silently
// drops cell styling (alignment, etc.) on write, confirmed by inspecting a
// generated file's raw XML: no `s="..."` on any cell, no alignment entries
// in styles.xml, even with `cellStyles: true` passed to XLSX.write(). Real
// per-cell formatting (Vincent, 2026-08-17: left-align every column) needs
// exceljs.
export type DataRow = Record<string, unknown>;
export type ExportColumn = {
  key: string;
  label: string;
  width: number;
  // 'date': render like the app does (toDisplayDate -> "D MMM YYYY"),
  // falling back to the raw text for a non-date value (e.g. Report Ready's
  // "DORMANT"). 'staffName': resolve through the same staff directory the
  // app itself uses (lib/staff-directory.ts) so "shi ming"/"Jay"/"jenny"
  // export as "Ang Shi Ming"/"Jay Tay"/"Jenny Lai", matching what's on
  // screen instead of whatever shorthand happened to get typed in.
  format?: 'date' | 'staffName';
};

export const AR_REMINDER_COLUMNS: ExportColumn[] = [
  { key: 'entity_name', label: 'Company Name', width: 42 },
  { key: 'uen', label: 'UEN', width: 18 },
  { key: 'fye_month', label: 'FYE Month', width: 14 },
  { key: 'fye_year', label: 'FYE Year', width: 12 },
  { key: 'fye_date', label: 'FYE Date', width: 14, format: 'date' },
  { key: 'due_date', label: 'Due Date', width: 14, format: 'date' },
  { key: 'reminder_note', label: 'Reminder', width: 18, format: 'date' },
  { key: 'prepared_date', label: 'Report Ready', width: 16, format: 'date' },
  { key: 'date_of_agm', label: 'AGM', width: 14, format: 'date' },
  { key: 'sent_date', label: 'To Client', width: 14, format: 'date' },
  { key: 'received_date', label: 'Signed', width: 14, format: 'date' },
  { key: 'filling_date', label: 'AR', width: 14, format: 'date' },
  { key: 'xbrl', label: 'XBRL', width: 14 },
  { key: 'software_update', label: 'TW Update', width: 16, format: 'date' },
  { key: 'dpo', label: 'DPO', width: 14 },
  { key: 'ond_ron', label: 'ROND RONS', width: 16 },
  { key: 'pic', label: 'SEC PIC', width: 18, format: 'staffName' },
  { key: 'acc_pic', label: 'ACC PIC', width: 18, format: 'staffName' },
  { key: 'tax_pic', label: 'TAX PIC', width: 18, format: 'staffName' },
  { key: 'remarks', label: 'Remarks', width: 36 },
  { key: 'status', label: 'Status', width: 16 },
  { key: 'updated_at', label: 'Last Updated', width: 22, format: 'date' },
];

export const ACTIVE_CLIENT_COLUMNS: ExportColumn[] = [
  { key: 'internal_code', label: 'Code', width: 12 },
  { key: 'company_name', label: 'Company Name', width: 42 },
  { key: 'roc_no', label: 'UEN / ROC No.', width: 18 },
  { key: 'status', label: 'Active', width: 12 },
  { key: 'join_date', label: 'Join Date', width: 14, format: 'date' },
  { key: 'add_here', label: 'Address Service', width: 18, format: 'staffName' },
  { key: 'invoice_address', label: 'Invoice / Registered Address', width: 42 },
  { key: 'contact_window', label: 'Contact Window', width: 24, format: 'staffName' },
  { key: 'email', label: 'Email', width: 34 },
  { key: 'tel', label: 'Telephone', width: 18 },
  { key: 'nominee_director', label: 'Nominee Director', width: 22, format: 'staffName' },
  { key: 'secretary', label: 'Secretary', width: 22, format: 'staffName' },
  { key: 'annual_return', label: 'Annual Return', width: 18 },
  { key: 'fye', label: 'FYE', width: 14 },
  { key: 'last_ar_date', label: 'Last AR Date', width: 16, format: 'date' },
  { key: 'last_agm_date', label: 'Last AGM Date', width: 16, format: 'date' },
  { key: 'last_accounts_date', label: 'Last Accounts Date', width: 18, format: 'date' },
  { key: 'next_agm_due_date', label: 'Next AGM Due Date', width: 19, format: 'date' },
  { key: 'months_from_last_accounts', label: '>13M Accounts', width: 16 },
  { key: 'remark', label: 'Remark', width: 36 },
  { key: 'referral', label: 'Referral', width: 18 },
  { key: 'risk_level', label: 'Risk Level', width: 14 },
  { key: 'incorp_with_us', label: 'Incorporated With Us', width: 20 },
  { key: 'mas', label: 'MAS', width: 14 },
  { key: 'grade', label: 'Grade', width: 12 },
];

function formatCell(raw: unknown, format: ExportColumn['format']): string {
  const text = raw == null ? '' : String(raw).trim();
  if (!text) return '';
  if (format === 'date') return toDisplayDate(text) ?? text;
  if (format === 'staffName') return formatStaffName(text);
  return text;
}

function addSheet(workbook: ExcelJS.Workbook, name: string, rows: DataRow[], columns: ExportColumn[]) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map(c => ({ header: c.label, key: c.key, width: c.width }));
  for (const row of rows) {
    sheet.addRow(Object.fromEntries(columns.map(c => [c.key, formatCell(row[c.key], c.format)])));
  }
  // Vincent, 2026-08-17: every column left-aligned — set explicitly per
  // cell (header included) rather than relying on column-level defaults,
  // since a cell added via addRow() only inherits a column's style if that
  // style was set before the row existed.
  sheet.eachRow(row => row.eachCell(cell => { cell.alignment = { horizontal: 'left', vertical: 'top' }; }));
  const lastCol = sheet.getColumn(columns.length).letter;
  sheet.autoFilter = `A1:${lastCol}1`;
  return sheet;
}

export async function buildWorkbook(
  sheets: { name: string; rows: DataRow[]; columns: ExportColumn[] }[],
  props?: { title?: string; subject?: string },
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tassure';
  workbook.created = new Date();
  if (props?.title) workbook.title = props.title;
  if (props?.subject) workbook.subject = props.subject;
  for (const s of sheets) addSheet(workbook, s.name, s.rows, s.columns);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
