import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

const MONTH_ORDER: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

export async function GET() {
  const supabase = createAdminClient();

  // Default to whichever cycle staff are actually invoicing right now, not
  // whichever cycle AR Generate happens to have reached furthest into (that
  // window rolls 6 months ahead, so the newest fye pair in ar_reminder is
  // typically a not-yet-started future cycle with nothing billed yet).
  //
  // Deliberately the MODE of the most-recent batch of invoices, not just the
  // single latest row — a lone out-of-sequence invoice (e.g. one December-FYE
  // company invoiced early/individually) used to hijack this for the whole
  // page. Confirmed live: staff were clearly still working through May 2026
  // (29 of the last 30 invoices), but one December 2026 invoice created six
  // days after that batch made both the Billing and AR Reminder tabs default
  // to December — Vincent: "用户都说只开到了MAY，但是系统判断已经开到了12月
  // 2026的". Counting the last 30 invoices' (month, year) pair and taking the
  // most common one is robust to that single-row case while still tracking
  // a genuine batch changeover once enough new-cycle invoices exist.
  const { data: recentInvoices } = await supabase
    .from('generated_invoices')
    .select('fye_month, fye_year, created_at')
    .not('fye_month', 'is', null)
    .not('fye_year', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30);
  if (recentInvoices?.length) {
    const counts = new Map<string, { month: string; year: number; count: number; mostRecent: string }>();
    for (const r of recentInvoices) {
      const key = `${r.fye_month}-${r.fye_year}`;
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { month: r.fye_month, year: r.fye_year, count: 1, mostRecent: r.created_at });
    }
    const [best] = [...counts.values()].sort((a, b) => b.count - a.count || (b.mostRecent > a.mostRecent ? 1 : -1));
    return NextResponse.json({ month: best.month, year: best.year });
  }

  // No invoices generated yet anywhere (e.g. a fresh environment) — fall
  // back to the furthest-along ar_reminder cycle so the page isn't empty.
  const { data } = await supabase
    .from('ar_reminder')
    .select('fye_month, fye_year');

  if (!data?.length) {
    return NextResponse.json({ month: 'January', year: new Date().getFullYear() });
  }

  const pairs = [...new Map(data.map(r => [`${r.fye_year}-${r.fye_month}`, r])).values()];
  pairs.sort((a, b) => {
    if (b.fye_year !== a.fye_year) return b.fye_year - a.fye_year;
    return (MONTH_ORDER[b.fye_month] ?? 0) - (MONTH_ORDER[a.fye_month] ?? 0);
  });

  return NextResponse.json({ month: pairs[0].fye_month, year: pairs[0].fye_year });
}
