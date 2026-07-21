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
  const { data: latestInvoice } = await supabase
    .from('generated_invoices')
    .select('fye_month, fye_year')
    .not('fye_month', 'is', null)
    .not('fye_year', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestInvoice?.fye_month && latestInvoice.fye_year) {
    return NextResponse.json({ month: latestInvoice.fye_month, year: latestInvoice.fye_year });
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
