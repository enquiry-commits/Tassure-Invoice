import 'server-only';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { resolveCompany, normalize } from '@/lib/company-name';
import { computeTaoCompanies } from '@/app/api/billing/tao/route';

/**
 * READ-ONLY view of a company's TAO (ACC) billing history (2026-09-10).
 *
 * TAO was the one billing path with no chat coverage at all. It is also the
 * one that CANNOT be auto-drafted: unlike TAB/TAC's renewal cycle, no
 * periodicity model exists for Accounts/Tax services, which is exactly why
 * the TAO page is hand-built (Vincent, 2026-09-05: "不管周期，是判断之前开
 * 过的所有服务，然后用户才来自己打勾自己要开的单").
 *
 * So this tool deliberately answers the question a person actually has
 * before building one — "what have we billed this company for before, and
 * how much" — rather than pretending to draft anything. The card then
 * hands over the REAL builder (components/billing/TaoInvoiceBuilder.tsx).
 *
 * The tool is named for that question, not for 开单, on purpose: Chinese
 * 开单 is already ambiguous between TAB/TAC invoicing and this, and a
 * 31-tool surface has already mis-routed once (开SOA → invoice drafts).
 */

export type TaoPriorService = {
  productService: string;
  service: string;
  description: string | null;
  rate: number | null;
  qty: number | null;
  lastInvoiceNo: string;
  lastTxnDate: string | null;
};

export type TaoPreview = {
  companyName: string;
  companyId: number | null;
  // False for the 154-of-359 TAO customers with no `companies` row at all
  // — a real ACC client, just not a corporate-secretarial one. Never
  // present this as "not our client".
  inCompanyRoster: boolean;
  hasAccounts: boolean;
  hasTax: boolean;
  lastInvoice: { invoiceNo: string; txnDate: string | null; totalAmt: number | null } | null;
  priorServices: TaoPriorService[];
  // Sum of the services whose rate is actually known. Older TAO line items
  // in QuickBooks have a NULL rate (confirmed: Galaxia Capital's 2024
  // invoice, REMOBIE's 2025 one), and treating those as 0 produced a
  // confident "S$0" total for a company that was really billed S$1,200 —
  // so the count of unpriced services travels with the total and must be
  // stated whenever it is non-zero.
  totalIfAllRepeated: number;
  servicesWithoutRate: number;
};

export type TaoLookupResult =
  | { found: true; preview: TaoPreview }
  | { found: false; ambiguous: true; message: string; candidates: string[] }
  | { found: false; ambiguous?: false; message: string };

type CompanyLite = {
  id: number; company_name: string;
  has_accounts: boolean | null; has_tax: boolean | null;
  services_manual: Record<string, boolean> | null;
};

export async function previewTaoBilling(companyQuery: string): Promise<TaoLookupResult> {
  const sb = createAdminClient();
  const trimmed = companyQuery.trim();
  if (!trimmed) return { found: false, message: 'A company name is required.' };

  // Resolve against ACC's REAL client book, not the corporate-secretarial
  // roster. Confirmed on production: 154 of 359 TAO customers have no row
  // in `companies` at all — ACC bills accounting/tax clients who were never
  // CSS clients, and individuals for personal tax ("Wu Yan"). An earlier
  // version of this function resolved against active companies only and
  // answered "No active company matched" for 43% of ACC's real customers.
  // computeTaoCompanies() is the TAO page's own eligibility computation,
  // extracted rather than re-derived.
  const [taoCompanies, coRows] = await Promise.all([
    computeTaoCompanies(),
    sb.from('companies').select('id, company_name, has_accounts, has_tax, services_manual').eq('is_active', true),
  ]);
  const companies = (coRows.data ?? []) as CompanyLite[];

  const resolution = resolveCompany(trimmed, taoCompanies, c => c.companyName);
  if (resolution.kind === 'ambiguous') {
    return {
      found: false, ambiguous: true,
      message: `Several TAO customers match "${trimmed}" — ask which one.`,
      candidates: resolution.candidates.map(c => c.companyName),
    };
  }
  if (resolution.kind === 'none') {
    return { found: false, message: `No TAO (ACC) customer matched "${trimmed}". ACC's book is separate from the corporate-secretarial roster, so a company being a Secretary client does not mean it has ever been billed under TAO.` };
  }
  const taoRow = resolution.kind === 'exact' ? resolution.value : resolution.value;
  const wanted = normalize(taoRow.companyName);
  // The companies row is optional here — it only supplies the service flags.
  const company = companies.find(c => normalize(c.company_name) === wanted) ?? null;

  // Same source and ordering as /api/billing/tao/service-history: every
  // DISTINCT product/service ever billed under a real TAO invoice, most
  // recent occurrence of each. Matched on the NORMALIZED name — QuickBooks
  // customer names and companies.company_name are separate spellings of the
  // same client (INV-DATA-040's family).
  const [items, invoices] = await Promise.all([
    pageAll(() => sb.from('quickbooks_invoice_items')
      .select('customer_name, invoice_no, txn_date, product_service, description, service_type, rate, qty')
      .eq('qb_company', 'TAO')
      .order('txn_date', { ascending: false })
      .order('invoice_no', { ascending: true })
      .order('line_num', { ascending: true })) as Promise<Array<{
        customer_name: string; invoice_no: string; txn_date: string | null;
        product_service: string | null; description: string | null; service_type: string;
        rate: number | null; qty: number | null;
      }>>,
    pageAll(() => sb.from('quickbooks_invoices')
      .select('customer_name, invoice_no, txn_date, total_amt')
      .eq('qb_company', 'TAO')
      .order('txn_date', { ascending: false })) as Promise<Array<{
        customer_name: string; invoice_no: string; txn_date: string | null; total_amt: number | null;
      }>>,
  ]);

  const seen = new Set<string>();
  const priorServices: TaoPriorService[] = [];
  for (const it of items) {
    if (normalize(it.customer_name) !== wanted) continue;
    const key = it.product_service ?? it.description ?? it.service_type;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    priorServices.push({
      productService: it.product_service ?? key,
      service: it.service_type,
      description: it.description,
      rate: it.rate,
      qty: it.qty,
      lastInvoiceNo: it.invoice_no,
      lastTxnDate: it.txn_date,
    });
  }

  const lastInvoiceRow = invoices.find(i => normalize(i.customer_name) === wanted) ?? null;
  const manual = company?.services_manual ?? {};

  return {
    found: true,
    preview: {
      companyName: taoRow.companyName,
      companyId: taoRow.companyId,
      inCompanyRoster: !!company,
      hasAccounts: manual.accounts ?? !!company?.has_accounts,
      hasTax: manual.tax ?? !!company?.has_tax,
      lastInvoice: lastInvoiceRow
        ? { invoiceNo: lastInvoiceRow.invoice_no, txnDate: lastInvoiceRow.txn_date, totalAmt: lastInvoiceRow.total_amt }
        : (taoRow.lastInvoice ?? null),
      priorServices,
      totalIfAllRepeated: priorServices.reduce((s, p) => s + (p.rate ?? 0) * (p.qty ?? 1), 0),
      servicesWithoutRate: priorServices.filter(p => p.rate === null || p.rate === undefined).length,
    },
  };
}
