import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';

// Looks up a company by UEN to pre-fill the Post Incorporate form.
//
// Company Information (name, UEN, address, secretary, FYE) comes from
// master_list/companies — fields this system already tracks reliably.
//
// Directors and Shareholders come from teamwork_company_officials /
// teamwork_shareholder_shares — a nightly-synced snapshot of TeamWork's
// per-company profile page (view_company/<id>/?comp), populated by
// app/api/teamwork/sync-secretary/route.ts's existing rotating batch (added
// 2026-08-09, per Vincent: "这些可以做每天更新吗？...可以记录在数据库，更方便
// 调用在post incorp"). This route is now a pure Supabase read — no live
// TeamWork login/fetch on the request path, so it's fast and has no
// Playwright dependency here.
//
// Directors come back ready to auto-fill directly (name/address/ID number).
// Shareholders come back as `shareholderCandidates` for one-click-add rather
// than auto-inserted: TeamWork's share register occasionally needs a
// human's judgment (e.g. confirming which currently-active shareholder to
// use) that Directors generally don't.
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
  const [{ data: masterRow }, { data: companyRow }, { data: officialRows }, { data: shareRows }] = await Promise.all([
    supabase.from('master_list').select('company_name, roc_no, invoice_address, secretary, nominee_director, directors, shareholders, fye').ilike('roc_no', uen).maybeSingle(),
    supabase.from('companies').select('company_name, registration_no, fye_month').ilike('registration_no', uen).maybeSingle(),
    supabase.from('teamwork_company_officials').select('name, role, id_no, id_type, address').ilike('uen', uen),
    supabase.from('teamwork_shareholder_shares').select('shareholder_name, number_of_shares, paid_up_capital, currency, share_type').ilike('uen', uen),
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

  const officials = officialRows ?? [];
  const byName = new Map(officials.map(o => [(o.name || '').trim().toUpperCase(), o]));

  const directors = officials
    .filter(o => o.role === 'Director' && o.name)
    .map(o => ({ name: o.name as string, address: (o.address || '') as string, identificationType: (o.id_type || '') as string, identificationNumber: (o.id_no || '') as string }));

  if (!secretaryName) {
    const secretaryRow = officials.find(o => o.role === 'Secretary' && o.name);
    if (secretaryRow) secretaryName = secretaryRow.name as string;
  }

  const shareholderCandidates = (shareRows ?? [])
    .filter(s => s.shareholder_name)
    .map(s => {
      const matched = byName.get((s.shareholder_name || '').trim().toUpperCase());
      return {
        name: s.shareholder_name as string,
        address: (matched?.address || '') as string,
        identificationType: (matched?.id_type || '') as string,
        identificationNumber: (matched?.id_no || '') as string,
        numberOfShares: (s.number_of_shares || '') as string,
        paidUpCapital: (s.paid_up_capital || '') as string,
        currency: (s.currency || '') as string,
        shareType: (s.share_type || '') as string,
      };
    });

  return NextResponse.json({
    found: true,
    company: { name, uen, address, secretaryName, financialYearEndDayMonth },
    directors,
    shareholderCandidates,
    hints: {
      directors: directors.length ? '' : (looksLikeRealName(masterRow?.directors ?? null) ? masterRow!.directors : ''),
      shareholders: shareholderCandidates.length ? '' : (looksLikeRealName(masterRow?.shareholders ?? null) ? masterRow!.shareholders : ''),
      nomineeDirector: looksLikeRealName(masterRow?.nominee_director ?? null) ? masterRow!.nominee_director : '',
    },
  });
}
