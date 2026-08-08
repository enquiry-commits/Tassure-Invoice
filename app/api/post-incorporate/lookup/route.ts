import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { getSessionCookie } from '@/lib/teamwork-agm';
import { fetchCompanyProfileFull, inferIdType } from '@/lib/teamwork-company-profile';

// Looks up a company by UEN to pre-fill the Post Incorporate form.
//
// Company Information (name, UEN, address, secretary, FYE) comes from
// master_list/companies — fields this system already tracks reliably.
//
// Directors come from TeamWork's own per-company "Active Officials" page
// (view_company/<id>/?comp), which turns out to hold real, structured
// Name/Role/ID No./Address/Date of Appointment data per official — verified
// against 5 real companies before wiring this up. This is a genuinely
// reliable source, unlike master_list's own free-text `directors` column.
//
// Shareholders do NOT come from that same page automatically: TeamWork's
// table has no "Shareholder" role or share-count column, only "Controller"
// (Registrable Controller under RORC — commonly, but not legally always,
// the same people as shareholders, and with no share count on file either
// way). Controllers come back as `shareholderCandidates` for the page to
// offer as one-click-add suggestions, not silently inserted as shareholders.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

function looksLikeRealName(value: string | null): boolean {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  return !/^(yes|no|na|n\.a\.?)\b/i.test(v);
}

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const uen = (req.nextUrl.searchParams.get('uen') || '').trim().toUpperCase();
  if (!uen) return NextResponse.json({ error: 'UEN is required' }, { status: 400 });

  const supabase = createAdminClient();
  const [{ data: masterRow }, { data: companyRow }] = await Promise.all([
    supabase.from('master_list').select('company_name, roc_no, invoice_address, secretary, nominee_director, directors, shareholders, fye').ilike('roc_no', uen).maybeSingle(),
    supabase.from('companies').select('company_name, registration_no, fye_month, internal_id').ilike('registration_no', uen).maybeSingle(),
  ]);

  if (!masterRow && !companyRow) {
    return NextResponse.json({ found: false });
  }

  const name = masterRow?.company_name || companyRow?.company_name || '';
  const address = (masterRow?.invoice_address || '').replace(/\r\n/g, ', ').trim();
  let secretaryName = looksLikeRealName(masterRow?.secretary ?? null) ? (masterRow!.secretary as string).trim() : '';
  const fyeRaw = (masterRow?.fye || companyRow?.fye_month || '').trim();
  // Only pre-fill FYE when it's plainly a month name (matches what the
  // Post Incorporate form field expects) — master_list.fye is inconsistently
  // either a month name or a full date across rows, and a full date in the
  // wrong shape would be a worse starting point than leaving it blank.
  const financialYearEndDayMonth = /^[A-Za-z]+$/.test(fyeRaw) ? fyeRaw : '';

  const directors: { name: string; address: string; identificationType: string; identificationNumber: string }[] = [];
  const shareholderCandidates: { name: string; address: string; identificationType: string; identificationNumber: string }[] = [];
  let teamworkError: string | null = null;

  const internalId = companyRow?.internal_id ? String(companyRow.internal_id) : '';
  if (internalId) {
    try {
      const cookie = await getSessionCookie();
      const profile = await fetchCompanyProfileFull(cookie, internalId);
      for (const o of profile.officials) {
        const idType = inferIdType(o.idNo);
        const person = { name: o.name, address: o.address, identificationType: idType, identificationNumber: o.idNo };
        if (o.role === 'Director' && o.name) directors.push(person);
        if (o.role === 'Controller' && o.name) shareholderCandidates.push(person);
        if (o.role === 'Secretary' && o.name && !secretaryName) secretaryName = o.name;
      }
    } catch (error) {
      // TeamWork lookup is a bonus, not a hard requirement — a login/fetch
      // failure should still return the master_list-only data below rather
      // than fail the whole request.
      teamworkError = error instanceof Error ? error.message : String(error);
    }
  }

  return NextResponse.json({
    found: true,
    company: { name, uen, address, secretaryName, financialYearEndDayMonth },
    directors,
    shareholderCandidates,
    teamworkError,
    hints: {
      directors: directors.length ? '' : (looksLikeRealName(masterRow?.directors ?? null) ? masterRow!.directors : ''),
      shareholders: looksLikeRealName(masterRow?.shareholders ?? null) ? masterRow!.shareholders : '',
      nomineeDirector: looksLikeRealName(masterRow?.nominee_director ?? null) ? masterRow!.nominee_director : '',
    },
  });
}
