import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';

// Fills in fields Bizfile genuinely can't provide (it's the official ACRA
// registry extract, not a TeamWork/Tassure-internal record) but that ARE
// already sitting in Supabase from other nightly syncs.
//
// - Financial Year End, Nominee Director status: from companies/master_list
//   and Tassure's own nd_appointments roster (unchanged from the first
//   version of this route).
// - Birth Date / Individual Email / Individual Mobile: from
//   teamwork_company_officials' dob/email/mobile/telephone columns —
//   sourced from TeamWork's own per-person "Directors / Shareholders /
//   Secretaries / Controllers / ..." detail cards (see
//   lib/teamwork-company-profile.ts's extractOfficerDetails), a different,
//   richer section of the company profile page than the plain summary table
//   this route originally read from. Vincent pointed out these were real
//   and populated ("你之前讲找不到具体的DIRECTORS / SHAREHOLDERS/SECRETARIES
//   详细资料，我这边给你看") — confirmed against a live fetch before wiring
//   this up, not assumed. This is NOT the same source as the earlier
//   2026-08-06 finding that TeamWork's bulk getCompanies API and this same
//   page's plain "Active Officials" table have empty/placeholder contact
//   fields — that finding was correct for those two sources specifically,
//   just didn't cover this third, richer one.
// - Nominee Shareholder status: still not returned — no equivalent to
//   nd_appointments exists for shareholders.
export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const uen = (req.nextUrl.searchParams.get('uen') || '').trim().toUpperCase();
  const companyName = (req.nextUrl.searchParams.get('company') || '').trim();
  if (!uen && !companyName) return NextResponse.json({ error: 'uen or company is required' }, { status: 400 });

  const supabase = createAdminClient();

  const [{ data: companyRow }, { data: masterRow }, { data: ndAppointmentRows }, { data: ndPeople }, { data: officialRows }, { data: shareRows }] = await Promise.all([
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
    uen
      ? supabase.from('teamwork_company_officials').select('name, role, dob, email, mobile, telephone, sub_roles').ilike('uen', uen)
      : Promise.resolve({ data: null }),
    // The REAL share register — a Controller (Registrable Controller under
    // RORC) is commonly but NOT always the same person as a Shareholder (no
    // share-count column on the officials table at all), so shareholder
    // comparison uses this table, not the Controller role above.
    uen
      ? supabase.from('teamwork_shareholder_shares').select('shareholder_name').ilike('uen', uen)
      : Promise.resolve({ data: null }),
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

  // Returned in full (not just a name list) so the caller can both (a) fill
  // in dob/email/mobile for people it already matched from Bizfile, and (b)
  // notice TeamWork-known people in a role that Bizfile's own result didn't
  // include at all — Vincent: "系统从BIZFILE检测出来的结构和TW的不同要跳出
  // 弹窗提示是否要修改."
  const teamworkOfficials = ((officialRows ?? []) as {
    name: string; role: string; dob: string | null; email: string | null; mobile: string | null; telephone: string | null; sub_roles: string | null;
  }[]).map(o => ({
    name: o.name, role: o.role, dob: o.dob || '', email: o.email || '', mobile: o.mobile || '',
    telephone: o.telephone || '', subRoles: o.sub_roles || '',
  }));

  const teamworkShareholderNames = [...new Set(
    ((shareRows ?? []) as { shareholder_name: string }[]).map(s => s.shareholder_name.trim().toUpperCase()).filter(Boolean),
  )];

  return NextResponse.json({ financialYearEndDayMonth, nomineeDirectorNames, teamworkOfficials, teamworkShareholderNames });
}
