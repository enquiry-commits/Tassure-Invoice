import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';

// Fills in the handful of fields Bizfile genuinely can't provide (it's the
// official ACRA registry extract, not a TeamWork/Tassure-internal record)
// but that ARE already sitting in Supabase from other nightly syncs —
// Vincent: "这些资料在 TW其实都可以拿到，你之前也拿到了，只是我现在要你填写
// 进去系统内的空格."
//
// Deliberately does NOT attempt Contact No / Email Address / Birth Date /
// Nominee Shareholder: verified none of these have a real source anywhere
// in this system.
// - Contact/Email: lib/teamwork-company-profile.ts already checked
//   TeamWork's own per-company page for these back on 2026-08-06 and found
//   them essentially empty/placeholder garbage (0/18, 2/18 real values;
//   phone is almost always the bare "65-" country-code stub) — deliberately
//   never extracted there for exactly this reason. Auto-filling fake-looking
//   placeholder data into a real legal document would be worse than leaving
//   it blank.
// - Birth Date: not captured by any sync in this codebase (grepped
//   confirmed — the only "birth" references anywhere are the document
//   generation's own placeholder fields, no scraper ever populates it).
// - Nominee Shareholder: no equivalent to nd_appointments exists for
//   shareholders; "nominee shareholder" isn't a tracked TeamWork/Tassure
//   concept the way Nominee Director is.
export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const uen = (req.nextUrl.searchParams.get('uen') || '').trim().toUpperCase();
  const companyName = (req.nextUrl.searchParams.get('company') || '').trim();
  if (!uen && !companyName) return NextResponse.json({ error: 'uen or company is required' }, { status: 400 });

  const supabase = createAdminClient();

  const [{ data: companyRow }, { data: masterRow }, { data: ndAppointmentRows }, { data: ndPeople }] = await Promise.all([
    uen
      ? supabase.from('companies').select('fye_month').ilike('registration_no', uen).maybeSingle()
      : Promise.resolve({ data: null }),
    uen
      ? supabase.from('master_list').select('fye').ilike('roc_no', uen).maybeSingle()
      : Promise.resolve({ data: null }),
    companyName
      ? supabase.from('nd_appointments').select('nd_id').ilike('company_name', companyName).is('cessation_date', null)
      : Promise.resolve({ data: null }),
    // Same two-query-then-join-in-JS pattern app/api/nominee-directors/route.ts
    // already uses for this exact pair of tables, rather than assuming a
    // PostgREST-embeddable FK exists between them.
    companyName ? supabase.from('nominee_directors').select('id, name') : Promise.resolve({ data: null }),
  ]);

  // master_list.fye is manually curated (more likely to already be the
  // clean month name this form wants); companies.fye_month is the
  // TeamWork-self-corrected value. Only ever a bare month name in either
  // column — no source in this system has the day-of-month.
  const fyeRaw = ((masterRow as { fye?: string } | null)?.fye || (companyRow as { fye_month?: string } | null)?.fye_month || '').trim();
  const financialYearEndDayMonth = /^[A-Za-z]+$/.test(fyeRaw) ? fyeRaw : '';

  const ndNameById = new Map(((ndPeople ?? []) as { id: number; name: string }[]).map(p => [p.id, p.name]));
  const activeNdIds = new Set(((ndAppointmentRows ?? []) as { nd_id: number }[]).map(r => r.nd_id));
  const nomineeDirectorNames = [...new Set(
    [...activeNdIds].map(id => ndNameById.get(id)).filter((n): n is string => !!n && n.trim().length > 0).map(n => n.trim().toUpperCase()),
  )];

  return NextResponse.json({ financialYearEndDayMonth, nomineeDirectorNames });
}
