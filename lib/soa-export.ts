import 'server-only';

import ExcelJS from 'exceljs';
import type { QbCompany } from './quickbooks';
import { effectiveOwner, type SoaCompanyRow, type SoaCompanyRowWithSource } from './soa-data';
import { AGING_BUCKETS } from './soa';

// Shared by GET /api/billing/soa/export (one TAB/TAC/TAO sheet) and
// GET /api/billing/soa/export-all (the full 18-sheet workbook mirroring
// every real tab in Vincent's Google Sheet) — one place building an aging
// table so the two can never drift into different layouts/number formats
// for what's meant to be the exact same row shape.

// The real legal entity name behind each QuickBooks company — exactly as
// it appears at the top of Vincent's own "A/R Ageing Summary Report" sheet
// (confirmed 2026-09-07 while investigating the SOA owner/PIC-per-tab
// mismatch — each tab's own row 1 literally is this).
export const LEGAL_NAME: Record<QbCompany, string> = {
  TAB: 'Tassure Asia Bizservices Pte Ltd',
  TAC: 'Tassure Asia Consultancy Pte Ltd',
  TAO: 'Tassure Asia Outsourcez Pte Ltd',
};

// Sheet-format bucket labels — deliberately NOT the on-screen AGING_BUCKETS
// labels ("Current"/"1-30"), which are a separate, tighter convention for
// the app's own table. These match the exact header text on Vincent's real
// sheet ("CURRENT" / "1 - 30" / ... / "91 AND OVER").
const SHEET_BUCKET_LABEL: Record<(typeof AGING_BUCKETS)[number]['key'], string> = {
  current: 'CURRENT', d1_30: '1 - 30', d31_60: '31 - 60', d61_90: '61 - 90', d91_plus: '91 AND OVER',
};

export const COLUMN_COUNT = 2 + AGING_BUCKETS.length + 2; // Company + 5 buckets + Total + PIC
const BOLD = { bold: true };

// `includeSource`: the "All" sheet (2026-09-07: "在 EXPORT FULL WORKBOOK那边
// 要加多一个 ALL 的 SHEET") is the one sheet whose rows can be the same
// company twice (once per system) — it alone carries an extra Source column
// right after Company Name, mirroring the on-screen All view's own 2nd
// column. Every other sheet (TAB/TAC/TAO, per-person, Internal) stays
// exactly as before — a plain boolean, not inferred from the row data,
// keeps an empty `rows` array from silently rendering the wrong header.
function setColumnWidths(sheet: ExcelJS.Worksheet, includeSource = false) {
  const columnCount = includeSource ? COLUMN_COUNT + 1 : COLUMN_COUNT;
  sheet.getColumn(1).width = 42;
  if (includeSource) sheet.getColumn(2).width = 10;
  for (let i = includeSource ? 3 : 2; i <= columnCount - 1; i++) sheet.getColumn(i).width = 13;
  sheet.getColumn(columnCount).width = 20;
}

// Renders one header row + one data row per `rows`, then (unless
// `totalLabel` is explicitly null) a bottom sum row — real Excel SUM()
// formulas over the exact data range, not a precomputed static number, so
// the total stays correct if a row is ever edited/deleted directly in
// Excel. Returns the row number immediately after everything just written,
// so a caller stacking multiple tables (Internal's per-person sections)
// knows where to continue.
//
// `totalLabel`: 'TOTAL' for the TAB/TAC/TAO sheets AND the per-person
// sheets (Vincent, 2026-09-07: "个人的也是要有TOTAL" — his own real sheet's
// per-person sum row actually has no "TOTAL" text, a deliberate departure
// from matching it exactly here since he asked for the label directly), or
// null to omit the total row entirely (Internal's own per-person
// sub-sections never get one, on his real sheet or here).
export function renderAgingTable(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  rows: { companyName: string; source?: QbCompany; aging: SoaCompanyRow['aging']; totalOutstanding: number; owner: string | null }[],
  totalLabel: string | null,
  opts?: { includeSource?: boolean },
): number {
  const includeSource = opts?.includeSource ?? false;
  const columnCount = includeSource ? COLUMN_COUNT + 1 : COLUMN_COUNT;
  // Aging buckets start one column later, and Total/PIC each shift right by
  // one, whenever a Source column is inserted right after Company Name.
  const firstAgingCol = includeSource ? 3 : 2;
  const totalCol = firstAgingCol + AGING_BUCKETS.length;
  const picCol = columnCount;

  const headerRow = sheet.getRow(startRow);
  headerRow.values = includeSource
    ? ['Company Name', 'Source', ...AGING_BUCKETS.map(b => SHEET_BUCKET_LABEL[b.key]), 'Total', 'PIC']
    : ['Company Name', ...AGING_BUCKETS.map(b => SHEET_BUCKET_LABEL[b.key]), 'Total', 'PIC'];
  headerRow.font = BOLD;
  headerRow.eachCell(cell => { cell.alignment = { horizontal: 'center' }; cell.border = { bottom: { style: 'thin' } }; });
  headerRow.getCell(1).alignment = { horizontal: 'left' };

  let rowNum = startRow;
  for (const r of rows) {
    rowNum++;
    const row = sheet.getRow(rowNum);
    row.values = [
      // Vincent, 2026-09-07: "公司名要统一...都大字母" — same display-only
      // uppercasing as the on-screen list (app/billing/soa/_components.tsx)
      // — some companies are already ALL CAPS (matched via companies
      // .company_name), others fall back to a raw, possibly mixed-case
      // QuickBooks customer_name.
      r.companyName.toUpperCase(),
      ...(includeSource ? [r.source ?? ''] : []),
      ...AGING_BUCKETS.map(b => (r.aging[b.key] > 0 ? r.aging[b.key] : null)),
      r.totalOutstanding,
      r.owner ?? '',
    ];
    for (let col = firstAgingCol; col <= totalCol; col++) {
      const cell = row.getCell(col);
      cell.numFmt = '#,##0.00';
      cell.alignment = { horizontal: 'right' };
    }
    row.getCell(1).alignment = { horizontal: 'left' };
    if (includeSource) row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(picCol).alignment = { horizontal: 'left' };
  }

  if (totalLabel !== null) {
    const firstDataRow = startRow + 1;
    const lastDataRow = rowNum;
    rowNum++;
    const totalRow = sheet.getRow(rowNum);
    if (totalLabel) totalRow.getCell(1).value = totalLabel;
    totalRow.font = BOLD;
    // Vincent, 2026-09-07: "TOTAL,没有整合每一列的数值总额" — the SUM()
    // formula alone rendered blank/0 for him: ExcelJS never evaluates a
    // formula it writes, and ships no cached value alongside it, so a
    // viewer that doesn't force a full recalc on open (observed with a
    // Google Sheets import) shows nothing until someone manually
    // recalculates. Precomputing the real sum here and passing it as
    // `result` alongside the formula means the correct number is visible
    // immediately either way — the formula is still there (and still
    // authoritative) if a row is later edited/deleted directly in Excel.
    const sums = AGING_BUCKETS.map(b => rows.reduce((s, r) => s + (r.aging[b.key] > 0 ? r.aging[b.key] : 0), 0));
    sums.push(rows.reduce((s, r) => s + r.totalOutstanding, 0));
    for (let col = firstAgingCol; col <= totalCol; col++) {
      const colLetter = sheet.getColumn(col).letter;
      const cell = totalRow.getCell(col);
      cell.value = rows.length
        ? { formula: `SUM(${colLetter}${firstDataRow}:${colLetter}${lastDataRow})`, result: sums[col - firstAgingCol] }
        : 0;
      cell.numFmt = '"S$"#,##0.00';
      cell.alignment = { horizontal: 'right' };
      cell.border = { top: { style: 'thin' } };
    }
    totalRow.getCell(1).border = { top: { style: 'thin' } };
    if (includeSource) totalRow.getCell(2).border = { top: { style: 'thin' } };
    totalRow.getCell(picCol).border = { top: { style: 'thin' } };
  }

  return rowNum + 1;
}

// One TAB/TAC/TAO-style sheet: legal name / "A/R Ageing Summary Report" /
// "As of ..." title block, then the aging table with a labeled "TOTAL" row.
export function buildCompanySheet(workbook: ExcelJS.Workbook, company: QbCompany, rows: SoaCompanyRow[]) {
  const sheet = workbook.addWorksheet(company);

  sheet.mergeCells(1, 1, 1, COLUMN_COUNT);
  sheet.getCell(1, 1).value = LEGAL_NAME[company];
  sheet.getCell(1, 1).font = { ...BOLD, size: 13 };
  sheet.getCell(1, 1).alignment = { horizontal: 'center' };

  sheet.mergeCells(2, 1, 2, COLUMN_COUNT);
  sheet.getCell(2, 1).value = 'A/R Ageing Summary Report';
  sheet.getCell(2, 1).font = BOLD;
  sheet.getCell(2, 1).alignment = { horizontal: 'center' };

  sheet.mergeCells(3, 1, 3, COLUMN_COUNT);
  sheet.getCell(3, 1).value = `As of ${new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  sheet.getCell(3, 1).alignment = { horizontal: 'center' };

  const headerRowNum = 5;
  const rowsForTable = rows.map(r => ({ companyName: r.companyName, aging: r.aging, totalOutstanding: r.totalOutstanding, owner: effectiveOwner(r) }));
  renderAgingTable(sheet, headerRowNum, rowsForTable, 'TOTAL');

  setColumnWidths(sheet);
  sheet.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: COLUMN_COUNT } };
  sheet.views = [{ state: 'frozen', ySplit: headerRowNum }];
  return sheet;
}

// The "All" sheet — Vincent, 2026-09-07: "因为现在多了一个All , 所有等于在
// EXPORT FULL WORKBOOK那边要加多一个 ALL 的 SHEET" — every TAB/TAC/TAO row
// together, NOT deduplicated (same principle as buildPersonSheet below: a
// company owing on 2 systems is 2 real, separate rows), mirroring the
// on-screen All page exactly — including its own Source column, right
// after Company Name. Placed first in the workbook, matching the sidebar's
// own All-before-TAB/TAC/TAO ordering; there's no real tab on Vincent's own
// Google Sheet to match here (it has no "All" tab), so this is free to
// follow the app's own new convention instead.
export function buildAllSheet(workbook: ExcelJS.Workbook, rows: SoaCompanyRowWithSource[]) {
  const sheet = workbook.addWorksheet('All');
  const columnCount = COLUMN_COUNT + 1;

  sheet.mergeCells(1, 1, 1, columnCount);
  sheet.getCell(1, 1).value = 'All Systems Combined (TAB + TAC + TAO)';
  sheet.getCell(1, 1).font = { ...BOLD, size: 13 };
  sheet.getCell(1, 1).alignment = { horizontal: 'center' };

  sheet.mergeCells(2, 1, 2, columnCount);
  sheet.getCell(2, 1).value = 'A/R Ageing Summary Report';
  sheet.getCell(2, 1).font = BOLD;
  sheet.getCell(2, 1).alignment = { horizontal: 'center' };

  sheet.mergeCells(3, 1, 3, columnCount);
  sheet.getCell(3, 1).value = `As of ${new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  sheet.getCell(3, 1).alignment = { horizontal: 'center' };

  const headerRowNum = 5;
  const rowsForTable = rows.map(r => ({
    companyName: r.companyName, source: r.qbCompany, aging: r.aging, totalOutstanding: r.totalOutstanding, owner: effectiveOwner(r),
  }));
  renderAgingTable(sheet, headerRowNum, rowsForTable, 'TOTAL', { includeSource: true });

  setColumnWidths(sheet, true);
  sheet.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: columnCount } };
  sheet.views = [{ state: 'frozen', ySplit: headerRowNum }];
  return sheet;
}

// One staff member's own cross-system book: every row (from any of
// TAB/TAC/TAO) where they're the effective Owner — NOT deduplicated across
// systems, since a company owing on 2 systems under the same owner is 2
// real, separate rows on Vincent's real per-person tabs too (confirmed
// against his real "CKY" tab: e.g. "1V Capital" appears once per system).
// No title block. His real sheet's own sum row has no "TOTAL" text, but
// Vincent, 2026-09-07: "个人的也是要有TOTAL,也是要有整合" — deliberately
// diverges from that to add the label here, since he asked for it directly.
export function buildPersonSheet(workbook: ExcelJS.Workbook, sheetName: string, rows: { companyName: string; aging: SoaCompanyRow['aging']; totalOutstanding: number; owner: string | null }[]) {
  const sheet = workbook.addWorksheet(sheetName);
  renderAgingTable(sheet, 1, rows, 'TOTAL');
  setColumnWidths(sheet);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMN_COUNT } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return sheet;
}

// The catch-all "Internal" tab: everyone who owns at least one real
// outstanding row but doesn't have their own dedicated staff sheet, grouped
// into one stacked mini-table per person (own header row, own rows, one
// blank separator row before the next person) — matches his real sheet's
// structure. Vincent's real Internal tab has a couple of duplicate
// mini-blocks for the same person (BD appears twice, evidently pasted in
// separately over time) — deliberately not replicated here: this groups
// each person into exactly ONE clean block.
export function buildInternalSheet(
  workbook: ExcelJS.Workbook,
  groups: { owner: string; rows: { companyName: string; aging: SoaCompanyRow['aging']; totalOutstanding: number; owner: string | null }[] }[],
) {
  const sheet = workbook.addWorksheet('Internal');
  let rowNum = 1;
  for (const group of groups) {
    rowNum = renderAgingTable(sheet, rowNum, group.rows, null);
    rowNum++; // blank separator row before the next person's block
  }
  setColumnWidths(sheet);
  return sheet;
}
