import { NextResponse } from 'next/server';
import { computeAllSoaRows } from '@/lib/soa-data';
import { createAdminClient } from '@/lib/supabase';
import { loadSoaReminderHistory, resolveSoaReminderProgress } from '@/lib/soa-reminder-progress';
import { loadSoaRemarks, soaRemarksForCompany } from '@/lib/soa-remarks';

// GET /api/billing/soa/all — Vincent, 2026-09-07: "在 Outstanding -TAB的
// 上面加多一个3级标题（All）,这个All, 就是把 TAB/TAC/TAO的所有总和放进去
// ...当然在 ALL这边改OWNER，TAO/TAB也会有变化" — every row from all 3
// systems, NOT deduplicated (a company on 2 systems is 2 rows, tagged with
// which). Owner edits made from this page PATCH the exact same soa_owners
// row (keyed by customer name + THAT row's own qb_company) the individual
// TAB/TAC/TAO pages read — same data, just a combined view over it, so an
// edit here is immediately visible there and vice versa with no special
// sync logic needed.
export async function GET() {
  try {
    const admin = createAdminClient();
    const [rows, history, remarks] = await Promise.all([
      computeAllSoaRows(),
      loadSoaReminderHistory(admin),
      loadSoaRemarks(admin),
    ]);
    return NextResponse.json({
      companies: rows.map(row => ({
        ...row,
        reminderProgress: resolveSoaReminderProgress(history, row, row.qbCompany),
        remarks: soaRemarksForCompany(remarks, row.companyName),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
