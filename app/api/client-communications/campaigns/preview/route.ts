import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { normalize } from '@/lib/company-name';
import type { QbCompany } from '@/lib/quickbooks';
import { onlyActiveCompanies, isActiveCompany } from '@/lib/company-lifecycle';
import {
  loadCompanies, loadInvoicesByCompany, loadAutoTargetNames, loadAlreadySent, loadArPicByCompany, loadLastReminderSentAt, buildRow, makeCompanyFinder,
  type CompanyRow,
} from '@/lib/client-comms-resolve';
import { resolveDraftCompany, soaBodyInvoices, soaBodyFuzzyKeys, customerBelongsToAnotherCompany, SOA_BOOKS } from '@/lib/soa-draft-resolution';

// Preview-before-generate: resolves the same candidate set Campaign Centre
// would generate, WITHOUT writing anything, so a reviewer can check/uncheck
// or hand-add companies before any drafts are created.
//
// POST = bulk auto-resolve (the AR cycle / unpaid-SOA / typed letter list).
// GET  = single ad-hoc lookup for the "add a company" control, which is
// allowed to resolve a company outside the auto target list on purpose.

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { type, fyeMonth, fyeYear, companyNames, onlyUnsent = true } = body as {
    type: 'letter' | 'ar' | 'soa'; fyeMonth?: string; fyeYear?: number;
    companyNames?: string[]; onlyUnsent?: boolean;
  };
  if (!type || !['letter', 'ar', 'soa'].includes(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  if (type === 'ar' && (!fyeMonth || !fyeYear)) return NextResponse.json({ error: 'fyeMonth and fyeYear required for type=ar' }, { status: 400 });

  const supabase = createAdminClient();
  // loadCompanies alone measured ~850ms (906 active companies, several JSON/
  // array columns) — it used to run before this Promise.all even started,
  // adding its full cost on top instead of overlapping it. Nothing here
  // reads companyList/findCompany until the loop below, well after all of
  // these have resolved either way, so there's no ordering reason to keep
  // it sequential.
  const [companyList, invoicesByCompany, targetNames, alreadySent, arPicByCompany, lastReminderSentAtByCompany] = await Promise.all([
    loadCompanies(supabase),
    loadInvoicesByCompany(supabase, type, fyeMonth, fyeYear),
    loadAutoTargetNames(supabase, type, fyeMonth, fyeYear, companyNames),
    onlyUnsent ? loadAlreadySent(supabase, type, fyeMonth, fyeYear) : Promise.resolve(new Set<string>()),
    type === 'ar' ? loadArPicByCompany(supabase, fyeMonth, fyeYear) : Promise.resolve(new Map<string, { acc_pic: string | null; tax_pic: string | null }>()),
    type === 'soa' ? loadLastReminderSentAt(supabase, type) : Promise.resolve(new Map<string, string>()),
  ]);
  const findCompany = makeCompanyFinder(companyList);

  const seen = new Set<string>();
  const rows = [];
  for (const rawName of targetNames) {
    if (!rawName) continue;
    const key = normalize(rawName);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(buildRow(rawName, findCompany, invoicesByCompany, alreadySent, type, arPicByCompany, lastReminderSentAtByCompany));
  }
  rows.sort((a, b) => a.companyName.localeCompare(b.companyName));

  return NextResponse.json({ rows });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lookup = sp.get('lookup');
  const type = sp.get('type') as 'letter' | 'ar' | 'soa' | null;
  const fyeMonth = sp.get('fyeMonth') ?? undefined;
  const fyeYear = sp.get('fyeYear') ? Number(sp.get('fyeYear')) : undefined;
  // Optional — only the ad-hoc single-company SOA draft flow passes this
  // (lib/soa-actions-client.ts's buildSoaDraft), to scope the resolved row
  // to the one QuickBooks book its "Draft Email" button was clicked on. See
  // buildRow()'s own comment on qbCompanyFilter for why this can't just
  // default to always-on — Campaign Centre's bulk SOA flow (the POST
  // handler above) deliberately stays cross-book.
  const qbCompanyParam = sp.get('qbCompany');
  const qbCompany = qbCompanyParam && (['TAB', 'TAC', 'TAO'] as const).includes(qbCompanyParam as QbCompany)
    ? (qbCompanyParam as QbCompany) : undefined;
  // The "All" mode of that same SOA Draft flow (its statements are attached per book): the body then covers every book.
  const allBooks = sp.get('allBooks') === '1';
  if (!lookup || !type) return NextResponse.json({ error: 'lookup and type are required' }, { status: 400 });
  if (!['letter', 'ar', 'soa'].includes(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 });

  const supabase = createAdminClient();

  // Fast path: this route's other caller (Billing Drafts' Email Drafts
  // popover) always passes back a company_name it already got FROM this
  // same companies table, byte-for-byte — an indexed exact match is a single
  // cheap row lookup, versus unconditionally fetching all ~900 active
  // companies (~850ms measured) just to fuzzy-scan for what's actually an
  // exact hit (Vincent, 2026-08-27: "点击DRAFT...至少要2秒"). Only Campaign
  // Centre's "add a company" control types a genuinely approximate name —
  // that still falls through to the exact same full fuzzy match as before,
  // completely unchanged, just no longer paid by the common exact-match case.
  // Run the attempt alongside the other three queries (none of them depend
  // on which company this resolves to) rather than before them, so the
  // common case costs one round trip, not two.
  const [exactMatch, invoicesByCompany, alreadySent, arPicByCompany, lastReminderSentAtByCompany] = await Promise.all([
    onlyActiveCompanies(supabase.from('companies')
      .select('id, company_name, best_email, primary_contact, tw_to_emails, tw_cc_emails, tw_recipient_source, tw_recipient_synced_at, pic'))
      .eq('company_name', lookup).maybeSingle()
      .then(r => r.data as CompanyRow | null),
    loadInvoicesByCompany(supabase, type, fyeMonth, fyeYear),
    loadAlreadySent(supabase, type, fyeMonth, fyeYear),
    type === 'ar' ? loadArPicByCompany(supabase, fyeMonth, fyeYear) : Promise.resolve(new Map<string, { acc_pic: string | null; tax_pic: string | null }>()),
    type === 'soa' ? loadLastReminderSentAt(supabase, type) : Promise.resolve(new Map<string, string>()),
  ]);

  let company: CompanyRow | null = exactMatch;
  let everyCompany: CompanyRow[] | undefined;
  let findCompany: (name: string) => CompanyRow | null = () => company;
  if (!company) {
    // An SOA chases a debt, and a debt outlives the client relationship (Vincent, 2026-10-07: "我们还是需要发SOA 去追债"):
    // for type 'soa' a company that is inactive, Terminated, Striking Off or no longer in TeamWork is still found — by EXACT
    // name, before the fuzzy match over the live roster could hand it to a similarly named active company. AR, letters and
    // Campaign Centre's bulk list keep the active-only rule (INV-TW-024 / INV-AR-017 / INV-AR-018). INV-MAIL-006.
    everyCompany = type === 'soa' ? await loadCompanies(supabase, { includeInactive: true }) : undefined;
    const findActive = makeCompanyFinder(everyCompany ? everyCompany.filter(isActiveCompany) : await loadCompanies(supabase));
    findCompany = name => resolveDraftCompany(name, findActive, everyCompany);
    company = findCompany(lookup);
  }
  if (!company) {
    return NextResponse.json({
      error: type === 'soa'
        ? `"${lookup}" is not in the company list, so there is no email address on file for it — add the company and its contact first.`
        : `No matching company found for "${lookup}".`,
    }, { status: 404 });
  }

  // An SOA Draft's body must list what its attached statement(s) show. The statement finds the QuickBooks customer for the name that
  // was clicked, with a fuzzy match when the company list spells it differently; buildRow only knows the company's own name, which
  // left the email saying "(no invoices)" and S$0.00 next to a statement with a balance (INV-MAIL-006). Only the Draft flow asks
  // for this (single book: `qbCompany`; "All": `allBooks`), and only for the books where the name found nothing exactly. A
  // customer that fits ANOTHER company in the list better (a look-alike: Yu An Bulk Holding for Yu An (SGP) Holding) is never
  // taken, so the company list is loaded for it — but only when the fuzzy step would actually take a customer.
  const draftBooks = qbCompany ? [qbCompany] : allBooks ? SOA_BOOKS : null;
  let invoicesForBody = invoicesByCompany;
  if (type === 'soa' && draftBooks) {
    const resolved = company;
    let everyone = everyCompany;
    if (!everyone && soaBodyFuzzyKeys(lookup, invoicesByCompany, draftBooks).length) everyone = await loadCompanies(supabase, { includeInactive: true });
    const known = everyone;
    const belongsToOther = known ? (customerKey: string) => customerBelongsToAnotherCompany(customerKey, lookup, resolved, known) : undefined;
    const refs = soaBodyInvoices(lookup, invoicesByCompany, draftBooks, belongsToOther);
    const key = normalize(resolved.company_name);
    const own = invoicesByCompany.get(key) ?? [];
    if (refs.length !== own.length || refs.some((r, i) => r !== own[i])) invoicesForBody = new Map(invoicesByCompany).set(key, refs);
  }

  const row = buildRow(company.company_name, findCompany, invoicesForBody, alreadySent, type, arPicByCompany, lastReminderSentAtByCompany, qbCompany);
  return NextResponse.json({ row });
}
