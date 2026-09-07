import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import type { QbCompany } from '@/lib/quickbooks';
import { computeSoaRows, effectiveOwner } from '@/lib/soa-data';
import { AGING_BUCKETS } from '@/lib/soa';

const QB_COMPANIES: QbCompany[] = ['TAB', 'TAC', 'TAO'];

// The real legal entity name behind each QuickBooks company — exactly as
// it appears at the top of Vincent's own "A/R Ageing Summary Report" sheet
// (confirmed 2026-09-07 while investigating the SOA owner/PIC-per-tab
// mismatch — each tab's own row 1 literally is this).
const LEGAL_NAME: Record<QbCompany, string> = {
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

// GET /api/billing/soa/export?company=TAB|TAC|TAO — Vincent, 2026-09-07:
// "我要可以导出EXCEL，要和GOOGLE SHEET的格式一样" — matches his real sheet's
// own layout (legal name / "A/R Ageing Summary Report" / "As of ..." title
// block, then Company/aging-buckets/Total/PIC columns) rather than this
// repo's other exports' generic single-header-row shape (lib/export-
// columns.ts), which doesn't have anywhere to put a multi-line title block.
// Reuses computeSoaRows — same numbers as the on-screen list, never a
// second, differently-computed copy.
export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get('company') as QbCompany | null;
  if (!company || !QB_COMPANIES.includes(company)) {
    return NextResponse.json({ error: 'company must be one of TAB, TAC, TAO' }, { status: 400 });
  }

  let rows;
  try {
    rows = await computeSoaRows(company);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tassure';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(`${company} A-R Ageing`);

  const columnCount = 2 + AGING_BUCKETS.length + 2; // Company + buckets + Total + PIC
  const bold = { bold: true };

  sheet.mergeCells(1, 1, 1, columnCount);
  sheet.getCell(1, 1).value = LEGAL_NAME[company];
  sheet.getCell(1, 1).font = { ...bold, size: 13 };
  sheet.getCell(1, 1).alignment = { horizontal: 'center' };

  sheet.mergeCells(2, 1, 2, columnCount);
  sheet.getCell(2, 1).value = 'A/R Ageing Summary Report';
  sheet.getCell(2, 1).font = bold;
  sheet.getCell(2, 1).alignment = { horizontal: 'center' };

  sheet.mergeCells(3, 1, 3, columnCount);
  sheet.getCell(3, 1).value = `As of ${new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  sheet.getCell(3, 1).alignment = { horizontal: 'center' };

  const headerRowNum = 5;
  const headerRow = sheet.getRow(headerRowNum);
  headerRow.values = ['Company Name', ...AGING_BUCKETS.map(b => SHEET_BUCKET_LABEL[b.key]), 'Total', 'PIC'];
  headerRow.font = bold;
  headerRow.eachCell(cell => { cell.alignment = { horizontal: 'center' }; cell.border = { bottom: { style: 'thin' } }; });
  headerRow.getCell(1).alignment = { horizontal: 'left' };

  for (const r of rows) {
    const row = sheet.addRow([
      r.companyName,
      ...AGING_BUCKETS.map(b => (r.aging[b.key] > 0 ? r.aging[b.key] : null)),
      r.totalOutstanding,
      effectiveOwner(r) ?? '',
    ]);
    for (let col = 2; col <= 1 + AGING_BUCKETS.length + 1; col++) {
      const cell = row.getCell(col);
      cell.numFmt = '#,##0.00';
      cell.alignment = { horizontal: 'right' };
    }
    row.getCell(1).alignment = { horizontal: 'left' };
    row.getCell(columnCount).alignment = { horizontal: 'left' };
  }

  sheet.getColumn(1).width = 42;
  for (let i = 2; i <= 1 + AGING_BUCKETS.length + 1; i++) sheet.getColumn(i).width = 13;
  sheet.getColumn(columnCount).width = 20;
  sheet.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: columnCount } };
  sheet.views = [{ state: 'frozen', ySplit: headerRowNum }];

  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = `${company} A-R Ageing - ${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, "'")}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
