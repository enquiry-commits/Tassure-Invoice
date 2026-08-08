import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';

// Looks up a company by UEN to pre-fill the Post Incorporate form's Company
// Information section. Only pre-fills fields this system actually tracks
// reliably (name, UEN, address, secretary name, FYE) — deliberately does
// NOT try to auto-fill Directors/Shareholders from master_list's own
// `directors`/`shareholders`/`nominee_director` columns. Those are free-text
// notes staff have entered inconsistently over the years (sampled values
// include literal "YES"/"NO" flags, names mixed with flags like
// "YES (ZHANG YAN)", and at least one row where a name list had clearly
// landed in the wrong column entirely) — silently populating a real legal
// document with that would risk an actively wrong director name, worse than
// leaving the field for staff to type. Their raw text comes back as `hints`
// for the page to show as a reference next to the (still manual) Directors/
// Shareholders sections, not to auto-fill into them.
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
    supabase.from('companies').select('company_name, registration_no, fye_month').ilike('registration_no', uen).maybeSingle(),
  ]);

  if (!masterRow && !companyRow) {
    return NextResponse.json({ found: false });
  }

  const name = masterRow?.company_name || companyRow?.company_name || '';
  const address = (masterRow?.invoice_address || '').replace(/\r\n/g, ', ').trim();
  const secretaryName = looksLikeRealName(masterRow?.secretary ?? null) ? (masterRow!.secretary as string).trim() : '';
  const fyeRaw = (masterRow?.fye || companyRow?.fye_month || '').trim();
  // Only pre-fill FYE when it's plainly a month name (matches what the
  // Post Incorporate form field expects) — master_list.fye is inconsistently
  // either a month name or a full date across rows, and a full date in the
  // wrong shape would be a worse starting point than leaving it blank.
  const financialYearEndDayMonth = /^[A-Za-z]+$/.test(fyeRaw) ? fyeRaw : '';

  return NextResponse.json({
    found: true,
    company: { name, uen, address, secretaryName, financialYearEndDayMonth },
    hints: {
      directors: looksLikeRealName(masterRow?.directors ?? null) ? masterRow!.directors : '',
      shareholders: looksLikeRealName(masterRow?.shareholders ?? null) ? masterRow!.shareholders : '',
      nomineeDirector: looksLikeRealName(masterRow?.nominee_director ?? null) ? masterRow!.nominee_director : '',
    },
  });
}
