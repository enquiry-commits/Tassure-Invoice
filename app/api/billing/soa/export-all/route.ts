import { todaySGT } from '@/lib/date';
import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import type { QbCompany } from '@/lib/quickbooks';
import { computeSoaRows, effectiveOwner, tagAndMergeSoaRows, type SoaCompanyRow } from '@/lib/soa-data';
import { buildAllSheet, buildCompanySheet, buildPersonSheet, buildInternalSheet } from '@/lib/soa-export';
import { resolveStaffName } from '@/lib/staff-directory';

// The 14 staff-code tabs that exist in Vincent's real Google Sheet, in
// their real tab order (confirmed 2026-09-07 by reading the sheet's own
// htmlview tab list) — each one is that person's own cross-system book:
// every row from TAB/TAC/TAO where they're the effective Owner.
const STAFF_CODE_SHEETS = ['JF', 'YH', 'VC', 'JT', 'WE', 'VY', 'CS', 'QT', 'TSM', 'LHC', 'JL', 'ASM', 'HSX', 'CKY'];

type TableRow = { companyName: string; aging: SoaCompanyRow['aging']; totalOutstanding: number; owner: string | null };

// GET /api/billing/soa/export-all — Vincent, 2026-09-07: "另外要生成一个完
// 整版的EXCEL（和GOOGLE SHEET 那边的一样的），要有 TAB/TAC/TAO/每个人员的/
// internal的" — the FULL workbook, mirroring every real tab in his sheet
// (confirmed by reading its own tab list, not guessed): TAB, TAO, TAC (his
// real tab order), then one sheet per staff code, then a single "Internal"
// catch-all. Deliberately excludes his sheet's other 2 tabs ("Bank
// Account", "Template - PIC") since he asked for these specific 5
// categories, not "everything in the workbook". Extended same day, once
// the on-screen "All" combined view shipped: "因为现在多了一个All , 所有
// 等于在 EXPORT FULL WORKBOOK那边要加多一个 ALL 的 SHEET" — a 19th sheet,
// placed FIRST (matching the sidebar's All-before-TAB/TAC/TAO order), with
// every TAB/TAC/TAO row together and its own Source column.
export async function GET() {
  let tab: SoaCompanyRow[], tac: SoaCompanyRow[], tao: SoaCompanyRow[];
  try {
    [tab, tac, tao] = await Promise.all([computeSoaRows('TAB'), computeSoaRows('TAC'), computeSoaRows('TAO')]);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tassure';
  workbook.created = new Date();

  // Built from the same tab/tac/tao arrays already fetched above — no
  // second round trip to Supabase, and provably the same row set the
  // on-screen All page's own computeAllSoaRows() call would produce (same
  // shared tagAndMergeSoaRows() helper, see lib/soa-data.ts).
  buildAllSheet(workbook, tagAndMergeSoaRows(tab, tac, tao));

  // Real tab order on his sheet is TAB, TAO, TAC — not alphabetical.
  const byCompany: [QbCompany, SoaCompanyRow[]][] = [['TAB', tab], ['TAO', tao], ['TAC', tac]];
  for (const [company, rows] of byCompany) buildCompanySheet(workbook, company, rows);

  // Flatten all 3 systems into one list for the person/Internal sheets —
  // NOT deduplicated across systems: a company owing on 2 systems under the
  // same owner is 2 real separate rows on Vincent's real per-person tabs
  // too (confirmed against his real "CKY" tab).
  const allRows: TableRow[] = [...tab, ...tac, ...tao].map(r => ({
    companyName: r.companyName, aging: r.aging, totalOutstanding: r.totalOutstanding, owner: effectiveOwner(r),
  }));

  const staffSheetNames = new Set<string>();
  for (const code of STAFF_CODE_SHEETS) {
    const canonicalName = resolveStaffName(code);
    if (!canonicalName) continue; // shouldn't happen — every code here is a real, already-confirmed alias
    staffSheetNames.add(canonicalName);
    const rows = allRows.filter(r => r.owner === canonicalName).sort((a, b) => a.companyName.localeCompare(b.companyName));
    buildPersonSheet(workbook, code, rows);
  }

  // Everyone else with a real owner but no dedicated tab — grouped into one
  // block per person (see lib/soa-export.ts's buildInternalSheet doc
  // comment on why this doesn't replicate his sheet's own duplicate blocks).
  const internalByOwner = new Map<string, TableRow[]>();
  for (const r of allRows) {
    if (!r.owner || staffSheetNames.has(r.owner)) continue;
    const list = internalByOwner.get(r.owner) ?? [];
    list.push(r);
    internalByOwner.set(r.owner, list);
  }
  const internalGroups = [...internalByOwner.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([owner, rows]) => ({ owner, rows: rows.sort((a, b) => a.companyName.localeCompare(b.companyName)) }));
  buildInternalSheet(workbook, internalGroups);

  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = `SOA - Full Workbook - ${todaySGT()}.xlsx`;
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, "'")}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
