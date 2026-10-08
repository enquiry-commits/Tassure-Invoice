import { attachmentDisposition } from '@/lib/content-disposition';
import { todaySGT } from '@/lib/date';
import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import type { QbCompany } from '@/lib/quickbooks';
import { createAdminClient } from '@/lib/supabase';
import { computeSoaRows, responsiblePeople, tagAndMergeSoaRows, type SoaCompanyRow } from '@/lib/soa-data';
import { buildAllSheet, buildCompanySheet, type SoaNotesFor } from '@/lib/soa-export';
import { peopleWithBooks, personLabel, rowsInPersonBook, sheetNameForPerson } from '@/lib/soa-person-book';
import { loadSoaReminderHistory, resolveSoaReminderProgress } from '@/lib/soa-reminder-progress';
import { loadSoaRemarks, soaRemarksForCompany } from '@/lib/soa-remarks';

// GET /api/billing/soa/export-all — Vincent, 2026-09-07: "另外要生成一个完
// 整版的EXCEL（和GOOGLE SHEET 那边的一样的），要有 TAB/TAC/TAO/每个人员的/
// internal的" — originally the FULL workbook mirroring every real tab in
// his sheet: TAB, TAO, TAC (his real tab order), then one sheet per staff
// code, then a single "Internal" catch-all, plus an "All" sheet added the
// same day once the on-screen combined view shipped.
//
// 2026-09-16, Vincent: "Export Excel 那边只保留 All / TAB / TAO/ TAC, 后面
// 的 PIC 和 Internal 不需要导出" — narrowed to just these 4 sheets. The
// per-person (buildPersonSheet) and Internal (buildInternalSheet) sheet
// builders in lib/soa-export.ts were removed in the same change since this
// was their only real caller — see that file's git history if a future
// request brings this back rather than re-deriving it from scratch.
export async function GET() {
  let tab: SoaCompanyRow[], tac: SoaCompanyRow[], tao: SoaCompanyRow[];
  let notesFor: SoaNotesFor;
  try {
    const admin = createAdminClient();
    const tabRows = computeSoaRows('TAB'); // TAC's ND rows read TAB's Main PIC from it (INV-PIC-010)
    const [rows, history, remarks] = await Promise.all([
      Promise.all([tabRows, computeSoaRows('TAC', { tabRows }), computeSoaRows('TAO')]),
      loadSoaReminderHistory(admin),
      loadSoaRemarks(admin),
    ]);
    [tab, tac, tao] = rows;
    // Same Remarks (one shared note per company) and Reminder status (per
    // company + system, from verified Outlook sends) the on-screen list shows.
    notesFor = (row, source) => {
      const progress = resolveSoaReminderProgress(history, row, source);
      const sent = progress.completedAt
        ? new Date(progress.completedAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' })
        : null;
      return {
        remarks: soaRemarksForCompany(remarks, row.companyName),
        // A client that paid more than it was billed gets no collection reminder.
        reminder: row.totalOutstanding < 0 ? 'We owe client (overpaid)' : progress.completedLabel ? `${progress.completedLabel}${sent ? ` — ${sent}` : ''}` : '',
      };
    };
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
  // Vincent, 2026-09-16: same exclusion as the on-screen SOA list — a
  // company whose net is $0 or negative has nothing to chase, so it
  // shouldn't clutter any sheet in this workbook either. See
  // app/billing/soa/_components.tsx's picScoped comment for the full
  // reasoning (including why this stays a live filter, not a stored one).
  // Filtered once here, before any sheet builder reads them.
  // 2026-10-07, Vincent: the workbook must also leave out the rows the
  // on-screen list hides — a company with no PIC at all (no confirmed or
  // suggested owner, e.g. the QuickBooks customer named "0", "143 LIVE").
  // Same rule as app/billing/soa/_components.tsx's hasAnyPic; still a live
  // filter, so a company reappears once it gets a PIC.
  // 2026-10-07: a NEGATIVE net (the client overpaid — we owe it) is listed too, as a negative; a net of exactly 0 stays out.
  const visible = (r: SoaCompanyRow) => r.totalOutstanding !== 0 && (r.picOptions.length > 0 || responsiblePeople(r).length > 0);
  tab = tab.filter(visible);
  tac = tac.filter(visible);
  tao = tao.filter(visible);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tassure';
  workbook.created = new Date();

  // Built from the same tab/tac/tao arrays already fetched above — no
  // second round trip to Supabase, and provably the same row set the
  // on-screen All page's own computeAllSoaRows() call would produce (same
  // shared tagAndMergeSoaRows() helper, see lib/soa-data.ts).
  const allRows = tagAndMergeSoaRows(tab, tac, tao);
  buildAllSheet(workbook, allRows, notesFor);

  // Real tab order on his sheet is TAB, TAO, TAC — not alphabetical.
  const byCompany: [QbCompany, SoaCompanyRow[]][] = [['TAB', tab], ['TAO', tao], ['TAC', tac]];
  for (const [company, rows] of byCompany) buildCompanySheet(workbook, company, rows, notesFor);

  // One sheet per person (Chelsea, 2026-10-07): their Main-PIC rows plus the OTHER sources of the same clients, the same
  // rule as the page's "My book" (lib/soa-person-book.ts). Placed after All / TAB / TAO / TAC.
  const taken = new Set(['all', 'tab', 'tao', 'tac']);
  for (const person of peopleWithBooks(allRows)) {
    buildAllSheet(workbook, rowsInPersonBook(allRows, person), notesFor, {
      sheetName: sheetNameForPerson(person, taken),
      title: `${personLabel(person)} \u2014 book (TAB + TAC + TAO)`,
    });
  }

  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = `SOA - Full Workbook - ${todaySGT()}.xlsx`;
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': attachmentDisposition(fileName),
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
