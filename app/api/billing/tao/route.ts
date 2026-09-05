import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';

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

export async function GET() {
  const supabase = createAdminClient();
  const currentYear = new Date().getFullYear();

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
  if (companiesRes.error) return NextResponse.json({ error: companiesRes.error.message }, { status: 503 });

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

  return NextResponse.json({ companies: rows });
}
