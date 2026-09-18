import { thisYearSGT } from '@/lib/date';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import { getApprovedAccount, type ApprovedAccount } from '@/lib/approved-accounts';

// GET /api/billing/tao — company list for ACC's own Accounts/Tax billing
// page (app/billing/tao/page.tsx). Deliberately NOT the FYE-cycle renewal
// machinery behind /api/billing/renewals: Accounts/Tax services (Compilation
// Report/Quarterly/Monthly Accounts/Corporate Tax/GST/AIS/…) have no
// due-date tracking anywhere in this system, and real TAO invoice amounts
// are individually negotiated per client, not templated — so this only
// surfaces WHO is eligible, plus their last TAO invoice as context; ACC
// builds each invoice's lines by hand.
export interface TaoCompanyRow {
  companyId: number | null;
  companyName: string;
  lastInvoice: { invoiceNo: string; txnDate: string | null; totalAmt: number | null } | null;
}

type QbItem = { customer_name: string; service_type: string };
type QbInvoice = { customer_name: string; invoice_no: string; txn_date: string | null; total_amt: number | null };

// Same tiny helper app/api/ar-reminder/route.ts uses: exact normalized match
// first, fuzzy fallback (lib/company-name.ts) only when that misses — kept
// local since it's the one caller here, mirroring that file's own pattern
// rather than promoting it to a shared lib for a single use.
function wordMatch<T>(target: string, map: Map<string, T>): T | null {
  const exact = map.get(target);
  if (exact !== undefined) return exact;
  const match = findUniqueBestMatch(target, [...map.entries()], entry => entry[0], 70);
  return match.value?.[1] ?? null;
}

// Extracted 2026-09-10 so lib/tao-lookup.ts's single-company chat preview
// reuses this EXACT eligibility computation instead of re-deriving a second,
// divergent one. That matters more here than almost anywhere else: 154 of
// 359 real TAO customers have NO row in `companies` at all (ACC bills
// accounting/tax clients who were never corporate-secretarial clients, and
// even individuals for personal tax), so a naive "resolve against active
// companies" lookup silently reports "no such client" for 43% of ACC's real
// book. This function already gets that right — see the eligibleNames /
// displayNameByNorm comments below — and the chat path must not re-invent it.
// Verbatim body, mechanically moved out of GET().
export async function computeTaoCompanies(): Promise<TaoCompanyRow[]> {
  const supabase = createAdminClient();
  const currentYear = thisYearSGT();

  const [companiesRes, qbItemsRes, taoInvoicesRes] = await Promise.all([
    supabase.from('companies').select('id, company_name, has_accounts, has_tax, services_manual'),
    pageAll(() => supabase
      .from('quickbooks_invoice_items')
      .select('customer_name, service_type')
      .in('service_type', ['Accounts', 'Tax'])
      .gte('txn_date', `${currentYear - 3}-01-01`)) as Promise<QbItem[]>,
    pageAll(() => supabase
      .from('quickbooks_invoices')
      .select('customer_name, invoice_no, txn_date, total_amt')
      .eq('qb_company', 'TAO')
      .order('txn_date', { ascending: false })) as Promise<QbInvoice[]>,
  ]);
  if (companiesRes.error) throw new Error(companiesRes.error.message);

  const companies = companiesRes.data ?? [];
  const companyByNormName = new Map(companies.map(c => [normalize(c.company_name), c]));

  // Most recent TAO invoice per normalized company name, for on-page context
  // (so ACC can see "last billed 2026-06-15" before hand-building the next
  // one) — first hit wins since taoInvoicesRes is already sorted desc.
  const lastByName = new Map<string, QbInvoice>();
  for (const inv of taoInvoicesRes) {
    const key = normalize(inv.customer_name);
    if (!key || lastByName.has(key)) continue;
    lastByName.set(key, inv);
  }

  // Real "has Accounts/Tax service" signal — same one app/api/ar-reminder/
  // route.ts computes (qbSvcs.has('Accounts') || compMatch?.has_accounts),
  // NOT the raw companies.has_accounts column read alone: that column is a
  // rarely-set manual override (confirmed live 2026-09-05 — true for 1 of
  // 945 companies), never the primary source. The real signal is actual
  // QuickBooks invoice history. A company with zero recent Accounts/Tax line
  // items but real TAO invoice history is included too (ACC's actual client
  // base is the ground truth), and the manual override still applies on top
  // for a genuinely new client with no invoice history yet.
  const namesWithQbService = new Set(qbItemsRes.map(i => normalize(i.customer_name)).filter(Boolean));
  const namesWithTaoHistory = new Set(lastByName.keys());
  const namesWithManualOverride = new Set(
    companies
      .filter(c => {
        const manual = (c.services_manual as Record<string, boolean> | null) ?? {};
        return manual.accounts === true || manual.tax === true || c.has_accounts === true || c.has_tax === true;
      })
      .map(c => normalize(c.company_name)),
  );
  const eligibleNames = new Set([...namesWithQbService, ...namesWithTaoHistory, ...namesWithManualOverride]);

  // Real QB customer names, kept around so a company with no companies-table
  // match still gets a real display name rather than being dropped.
  const displayNameByNorm = new Map<string, string>();
  for (const i of qbItemsRes) displayNameByNorm.set(normalize(i.customer_name), i.customer_name);
  for (const inv of taoInvoicesRes) displayNameByNorm.set(normalize(inv.customer_name), inv.customer_name);
  for (const c of companies) displayNameByNorm.set(normalize(c.company_name), c.company_name);

  const rows: TaoCompanyRow[] = [...eligibleNames]
    .map(name => {
      const companyMatch = companyByNormName.get(name) ?? wordMatch(name, companyByNormName);
      return {
        companyId: companyMatch?.id ?? null,
        companyName: companyMatch?.company_name ?? displayNameByNorm.get(name) ?? name,
        lastInvoice: lastByName.get(name)
          ? { invoiceNo: lastByName.get(name)!.invoice_no, txnDate: lastByName.get(name)!.txn_date, totalAmt: lastByName.get(name)!.total_amt }
          : null,
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName));

  return rows;
}

export async function GET() {
  try {
    return NextResponse.json({ companies: await computeTaoCompanies() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}

// POST /api/billing/tao — add a genuinely new company, one never synced from
// TeamWork and with no QuickBooks history yet. Vincent, 2026-09-05: TAO's
// candidate list (GET above) only ever draws from `companies` + real
// QuickBooks history, both of which a brand-new client has none of — this is
// the entry point he asked for so ACC isn't blocked waiting on a TeamWork
// sync just to start billing a new Accounts client. Minimal insert (just the
// name, `has_accounts: true` so it's immediately eligible above) — every
// other `companies` column is nullable and gets filled in properly later,
// either by staff or once TeamWork does pick this company up.
export async function POST(req: NextRequest) {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data: authData } = await auth.auth.getUser();
  const account: ApprovedAccount | null = getApprovedAccount(authData.user?.email);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { companyName } = await req.json().catch(() => ({})) as { companyName?: string };
  const name = companyName?.trim();
  if (!name) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });

  const supabase = createAdminClient();
  const target = normalize(name);
  const { data: existingRows, error: existingError } = await supabase.from('companies').select('id, company_name');
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 503 });

  // Guard against creating a shadow duplicate of a company that's already in
  // the system (e.g. staff mistyping a search and not realizing it already
  // exists) — exact match first, fuzzy fallback same as the GET handler.
  const exact = (existingRows ?? []).find(c => normalize(c.company_name) === target);
  const fuzzy = exact ? null : findUniqueBestMatch(name, existingRows ?? [], c => c.company_name, 85);
  const collision = exact ?? fuzzy?.value;
  if (collision) {
    return NextResponse.json({ error: `"${collision.company_name}" already exists in the system (id ${collision.id}) — search for it instead of adding a duplicate.` }, { status: 409 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from('companies')
    .insert({ company_name: name, has_accounts: true })
    .select('id, company_name')
    .single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 503 });

  return NextResponse.json({ company: { companyId: inserted.id, companyName: inserted.company_name, lastInvoice: null } });
}

// None of these tables carry a real `company_id`/UEN FK to `companies`
// except ar_reminder and email_drafts (see lib/company-360.ts's own "Reliable
// links" comment) — everything else here is matched by company_name text,
// the same convention that whole file already documents. A query ERROR must
// never read as "0, safe to delete" — that would be a silent false negative
// letting a real client's data get deleted; every branch below explicitly
// throws instead of defaulting a failed count to zero.
async function companyDeletionBlockers(
  supabase: ReturnType<typeof createAdminClient>,
  company: { id: number; company_name: string; registration_no: string | null },
): Promise<string[]> {
  const name = company.company_name;
  type CountResult = { count: number | null; error: { message: string } | null };
  const checks: Array<[string, Promise<CountResult>]> = [
    ['AR Reminder cycle(s)', Promise.resolve(supabase.from('ar_reminder').select('id', { count: 'exact', head: true }).eq('company_id', company.id))],
    ['email draft(s)', Promise.resolve(supabase.from('email_drafts').select('id', { count: 'exact', head: true }).eq('company_id', company.id))],
    ['QuickBooks invoice(s)', Promise.resolve(supabase.from('quickbooks_invoices').select('qb_invoice_id', { count: 'exact', head: true }).ilike('customer_name', name))],
    ['QuickBooks credit memo(s)', Promise.resolve(supabase.from('quickbooks_credit_memos').select('qb_credit_memo_id', { count: 'exact', head: true }).ilike('customer_name', name))],
    ['generated invoice(s)', Promise.resolve(supabase.from('generated_invoices').select('id', { count: 'exact', head: true }).ilike('company_name', name))],
    ['trademark record(s)', Promise.resolve(supabase.from('trademark_records').select('id', { count: 'exact', head: true }).ilike('company_name', name))],
    ['ND appointment(s)', Promise.resolve(supabase.from('nd_appointments').select('nd_id', { count: 'exact', head: true }).ilike('company_name', name))],
  ];
  if (company.registration_no) {
    checks.push(['Post Incorporate record(s)', Promise.resolve(supabase.from('post_incorporate_operations').select('id', { count: 'exact', head: true }).ilike('company_uen', company.registration_no))]);
  }
  const results = await Promise.all(checks.map(async ([label, query]) => {
    const { count, error } = await query;
    if (error) throw new Error(`Could not verify "${label}" is clear: ${error.message}`);
    return count && count > 0 ? `${count} ${label}` : null;
  }));
  return results.filter((r): r is string => r !== null);
}

// DELETE /api/billing/tao — undo a manual "+ Add new company" mistake (the
// POST handler above), never a general company-delete tool. Vincent,
// 2026-09-18, after manually asking for exactly this once (a placeholder
// "AAAA" row from testing the Add button): "以后这种自己在系统开的公司for
// 开单的，能不能可以添加过后删除" (companies I create myself in the system
// for billing — can they be deletable after adding). Deliberately narrow and
// defense-in-depth, not a single check: (1) refuses outright if TeamWork has
// ever synced this company (a real `tw_status`) — this route is only for a
// row that's STILL in the exact state POST leaves it in, a real client
// TeamWork picked up is never this route's business regardless of whether
// it has invoices yet; (2) refuses if any real dependent record exists
// anywhere in the system (see companyDeletionBlockers, checked against every
// table a real client's data could live in), with the specific reason(s) in
// the error so a genuine "can't delete, here's why" reads as a real answer,
// not a mystery. Hard delete, not a soft one — the AAAA precedent was a
// clean hard delete with zero data loss because it genuinely had nothing to
// lose; that is precisely the state this route requires before proceeding.
export async function DELETE(req: NextRequest) {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data: authData } = await auth.auth.getUser();
  const account: ApprovedAccount | null = getApprovedAccount(authData.user?.email);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { companyId } = await req.json().catch(() => ({})) as { companyId?: number };
  if (!companyId) return NextResponse.json({ error: 'companyId is required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('id, company_name, registration_no, tw_status')
    .eq('id', companyId)
    .maybeSingle();
  if (companyError) return NextResponse.json({ error: companyError.message }, { status: 503 });
  if (!company) return NextResponse.json({ error: 'Company not found — it may already have been removed.' }, { status: 404 });

  if (company.tw_status) {
    return NextResponse.json({ error: `"${company.company_name}" has been synced from TeamWork (status: ${company.tw_status}) — it's a real tracked client, not something this can remove.` }, { status: 409 });
  }

  let blockers: string[];
  try {
    blockers = await companyDeletionBlockers(supabase, company);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
  if (blockers.length) {
    return NextResponse.json({ error: `Can't remove "${company.company_name}" — it already has real history: ${blockers.join(', ')}.` }, { status: 409 });
  }

  const { error: deleteError } = await supabase.from('companies').delete().eq('id', companyId);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 503 });

  return NextResponse.json({ ok: true });
}
