import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

/**
 * Cross-cycle lookup for AR Reminder's search box (see useCrossCycleSearch
 * in app/billing/page.tsx). Unlike /api/companies (the TeamWork roster, used
 * for Billing Drafts' own escalation search), this searches ar_reminder
 * itself across every FYE month/year — the only way to find rows that exist
 * ONLY in AR Reminder, such as Late Filing's mirror of struck-off/orphaned
 * companies that have no row in `companies` at all (see
 * app/api/late-filing/sync/route.ts's manual-entry pass).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const term = (searchParams.get('q') ?? '').trim();
  if (!term) return NextResponse.json({ data: [] });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('ar_reminder')
    .select('entity_name, uen, fye_month, fye_year')
    .or(`entity_name.ilike.%${term}%,uen.ilike.%${term}%`)
    .or('status.is.null,status.neq.Excluded')
    .order('fye_year', { ascending: false })
    .limit(5);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
