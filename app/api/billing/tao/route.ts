import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { normalize } from '@/lib/company-name';

// GET /api/billing/tao — company list for ACC's own Accounts/Tax billing
// page (app/billing/tao/page.tsx). Deliberately NOT the FYE-cycle renewal
// machinery behind /api/billing/renewals: Accounts/Tax services (Compilation
// Report/Quarterly/Monthly Accounts/Corporate Tax/GST/AIS/…) have no
// due-date tracking anywhere in this system, and real TAO invoice amounts
// are individually negotiated per client, not templated — so this only
// surfaces WHO is eligible, plus their last TAO invoice as context; ACC
// builds each invoice's lines by hand.
export interface TaoCompanyRow {
  companyId: number;
  companyName: string;
  lastInvoice: { invoiceNo: string; txnDate: string | null; totalAmt: number | null } | null;
}

export async function GET() {
  const supabase = createAdminClient();

  const [companiesRes, taoInvoices] = await Promise.all([
    supabase.from('companies').select('id, company_name, has_accounts, services_manual'),
    pageAll(() => supabase
      .from('quickbooks_invoices')
      .select('customer_name, invoice_no, txn_date, total_amt')
      .eq('qb_company', 'TAO')
      .order('txn_date', { ascending: false })) as Promise<Array<{ customer_name: string; invoice_no: string; txn_date: string | null; total_amt: number | null }>>,
  ]);
  if (companiesRes.error) return NextResponse.json({ error: companiesRes.error.message }, { status: 503 });

  // Same authoritative signal app/api/ar-reminder/route.ts already uses for
  // "has Accounts service" (companies.has_accounts + services_manual.accounts
  // staff override) — NOT master_list.acc_active, which is a separate, unsynced
  // Master List-only field confirmed to disagree with this one.
  const eligible = (companiesRes.data ?? []).filter(c => {
    const manual = (c.services_manual as Record<string, boolean> | null) ?? {};
    return manual.accounts !== undefined ? manual.accounts === true : c.has_accounts === true;
  });

  // Most recent TAO invoice per normalized company name, for on-page context
  // only (so ACC can see "last billed 2026-06-15" before hand-building the
  // next one) — not used to gate eligibility or compute anything.
  const lastByName = new Map<string, { invoiceNo: string; txnDate: string | null; totalAmt: number | null }>();
  for (const inv of taoInvoices) {
    const key = normalize(inv.customer_name);
    if (!key || lastByName.has(key)) continue; // already-sorted desc by txn_date — first hit wins
    lastByName.set(key, { invoiceNo: inv.invoice_no, txnDate: inv.txn_date, totalAmt: inv.total_amt });
  }

  const rows: TaoCompanyRow[] = eligible
    .map(c => ({
      companyId: c.id,
      companyName: c.company_name,
      lastInvoice: lastByName.get(normalize(c.company_name)) ?? null,
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));

  return NextResponse.json({ companies: rows });
}
