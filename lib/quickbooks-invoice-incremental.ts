import 'server-only';

import { getValidToken, type QbCompany } from '@/lib/quickbooks';
import { createAdminClient } from '@/lib/supabase';
import { parseInvoicePeriod } from '@/lib/invoice-period';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

const PRODUCT_MAP: { type: string; match: string[] }[] = [
  { type: 'Deferred',  match: ['deferred revenue'] },
  { type: 'Secretary', match: ['corporate secretarial services', 'secretary fees - offshore'] },
  { type: 'Address',   match: ['registered address services'] },
  { type: 'ND',        match: ['nominee director fees', 'nominee director deposit', 'nominee shareholder fees'] },
  { type: 'AR',        match: ['government fee for filing annual return'] },
  { type: 'XBRL',      match: ['company xbrl services'] },
  { type: 'Accounts',  match: ['yearly accounts services', 'monthly accounts services', 'compilation services'] },
  { type: 'Tax',       match: ['corporate tax services', 'personal income tax services', 'other tax services', 'application for waiver of income tax'] },
];

const SERVICE_PATTERNS = [
  { type: 'AR',        kw: ['annual return', 'ar filing', 'ar fee', 'a/r filing', 'acra annual', 'government fee for acra', 'government fee of'] },
  { type: 'AGM',       kw: ['agm', 'annual general meeting'] },
  { type: 'XBRL',      kw: ['xbrl', 'ixbrl', 'tagged financial'] },
  { type: 'Address',   kw: ['registered address', 'reg address', 'virtual office', 'address service', 'registered office'] },
  { type: 'ND',        kw: ['nominee director', 'nd service', 'nd fee', 'local director', 'resident director'] },
  { type: 'Secretary', kw: ['secretarial', 'secretary', 'corp sec', 'statutory', 'board resolution', 'share allot', 'share transfer', 'change of director', 'change of officer'] },
  { type: 'Accounts',  kw: ['bookkeeping', 'accounts preparation', 'management accounts', 'unaudited', 'financial statement', 'accounting fee', 'compilation'] },
  { type: 'Tax',       kw: ['tax return', 'tax filing', 'income tax', 'iras', 'form c', 'form cs', 'gst return', 'tax computation', 'corporate tax', 'eci'] },
  { type: 'Audit',     kw: ['audit', 'statutory audit', 'auditor'] },
  { type: 'Deferred',  kw: ['deferred revenue'] },
];

function classify(description: string, product: string) {
  const normalizedProduct = product.toLowerCase();
  for (const rule of PRODUCT_MAP) {
    if (rule.match.some(value => normalizedProduct.includes(value))) {
      return { type: rule.type, source: 'product' as const };
    }
  }
  const combined = `${description} ${product}`.toLowerCase();
  for (const rule of SERVICE_PATTERNS) {
    if (rule.kw.some(value => combined.includes(value))) {
      return { type: rule.type, source: 'description' as const };
    }
  }
  return { type: 'Other', source: 'unmapped' as const };
}

function invoiceRows(invoice: Record<string, unknown>, company: QbCompany, observedAt: string) {
  const customer = (invoice.CustomerRef as Record<string, unknown>) ?? {};
  const qbInvoiceId = String(invoice.Id ?? '');
  const qbCustomerId = String(customer.value ?? '');
  const invoiceNumber = String(invoice.DocNumber ?? '');
  const transactionDate = String(invoice.TxnDate ?? '');
  const balance = Number(invoice.Balance ?? 0);
  const total = Number(invoice.TotalAmt ?? 0);
  const invoiceRow = {
    qb_invoice_id: qbInvoiceId,
    invoice_no: invoiceNumber,
    qb_company: company,
    qb_customer_id: qbCustomerId || null,
    customer_name: String(customer.name ?? ''),
    txn_date: transactionDate,
    total_amt: total,
    balance,
    status: total === 0 && balance === 0 ? 'Voided' : balance === 0 ? 'Paid' : 'Open',
    scraped_at: observedAt,
    last_seen_sync_run: null,
  };

  const items: Record<string, unknown>[] = [];
  let lineNumber = 0;
  for (const line of (invoice.Line as Record<string, unknown>[] | undefined) ?? []) {
    if (line.DetailType !== 'SalesItemLineDetail') continue;
    lineNumber++;
    const detail = (line.SalesItemLineDetail as Record<string, unknown>) ?? {};
    const itemRef = (detail.ItemRef as Record<string, unknown>) ?? {};
    const product = String(itemRef.name ?? '');
    const description = String(line.Description ?? '');
    const classification = classify(description, product);
    const parsed = parseInvoicePeriod(description, classification.type) ?? {};
    const requiresPeriod = ['Secretary', 'Address', 'ND', 'Deferred'].includes(classification.type);
    const requiresFye = ['AR', 'XBRL'].includes(classification.type);
    items.push({
      invoice_no: invoiceNumber,
      qb_company: company,
      qb_invoice_id: qbInvoiceId,
      qb_line_id: String(line.Id ?? lineNumber),
      qb_customer_id: qbCustomerId || null,
      customer_name: String(customer.name ?? ''),
      txn_date: transactionDate,
      line_num: lineNumber,
      description: description || null,
      product_service: product || null,
      qty: detail.Qty ?? null,
      rate: detail.UnitPrice ?? null,
      amount: line.Amount ?? null,
      service_type: classification.type,
      classification_source: classification.source,
      period_parse_status: requiresPeriod
        ? (parsed.period_end ? 'parsed' : 'missing_period')
        : requiresFye
          ? (parsed.fye_date ? 'parsed' : 'missing_fye')
          : 'not_applicable',
      period_start: parsed.period_start ?? null,
      period_end: parsed.period_end ?? null,
      fye_date: parsed.fye_date ?? null,
      scraped_at: observedAt,
      last_seen_sync_run: null,
    });
  }
  return { invoiceRow, items };
}

export async function syncQuickBooksInvoiceChanges(company: QbCompany, changedSince: string) {
  const token = await getValidToken(company);
  if (!token) throw new Error(`QuickBooks ${company} is not connected.`);

  const url = new URL(`${QB_BASE}/v3/company/${token.realm_id}/cdc`);
  url.searchParams.set('entities', 'Invoice');
  url.searchParams.set('changedSince', changedSince);
  url.searchParams.set('minorversion', '75');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`QuickBooks ${company} CDC failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }

  const payload = await response.json() as {
    CDCResponse?: Array<{ QueryResponse?: Array<{ Invoice?: Record<string, unknown>[] }> }>;
  };
  const changedInvoices = (payload.CDCResponse ?? [])
    .flatMap(block => block.QueryResponse ?? [])
    .flatMap(block => block.Invoice ?? []);
  const deletedIds = changedInvoices
    .filter(invoice => String(invoice.status ?? '').toLowerCase() === 'deleted')
    .map(invoice => String(invoice.Id ?? ''))
    .filter(Boolean);
  const currentInvoices = changedInvoices.filter(invoice =>
    String(invoice.status ?? '').toLowerCase() !== 'deleted' && invoice.Id,
  );

  const supabase = createAdminClient();
  if (deletedIds.length) {
    const { error: itemDeleteError } = await supabase.from('quickbooks_invoice_items')
      .delete().eq('qb_company', company).in('qb_invoice_id', deletedIds);
    if (itemDeleteError) throw new Error(`Unable to remove deleted QB line items: ${itemDeleteError.message}`);
    const { error: invoiceDeleteError } = await supabase.from('quickbooks_invoices')
      .delete().eq('qb_company', company).in('qb_invoice_id', deletedIds);
    if (invoiceDeleteError) throw new Error(`Unable to remove deleted QB invoices: ${invoiceDeleteError.message}`);
  }

  const observedAt = new Date().toISOString();
  let invoicesSynced = 0;
  let itemsSynced = 0;
  for (const invoice of currentInvoices) {
    const { invoiceRow, items } = invoiceRows(invoice, company, observedAt);
    const { error: invoiceError } = await supabase.from('quickbooks_invoices')
      .upsert(invoiceRow, { onConflict: 'qb_company,qb_invoice_id' });
    if (invoiceError) throw new Error(`Unable to refresh QB invoice: ${invoiceError.message}`);
    invoicesSynced++;
    if (items.length) {
      const { error: itemError } = await supabase.from('quickbooks_invoice_items')
        .upsert(items, { onConflict: 'qb_company,qb_invoice_id,qb_line_id' });
      if (itemError) throw new Error(`Unable to refresh QB invoice items: ${itemError.message}`);
      itemsSynced += items.length;
    }
    const { data: existingItems, error: existingItemsError } = await supabase.from('quickbooks_invoice_items')
      .select('qb_line_id').eq('qb_company', company).eq('qb_invoice_id', String(invoice.Id));
    if (existingItemsError) throw new Error(`Unable to reconcile QB invoice items: ${existingItemsError.message}`);
    const currentLineIds = new Set(items.map(item => String(item.qb_line_id)));
    const staleLineIds = (existingItems ?? [])
      .map(item => String(item.qb_line_id))
      .filter(lineId => !currentLineIds.has(lineId));
    if (staleLineIds.length) {
      const { error: staleItemsError } = await supabase.from('quickbooks_invoice_items')
        .delete().eq('qb_company', company).eq('qb_invoice_id', String(invoice.Id)).in('qb_line_id', staleLineIds);
      if (staleItemsError) throw new Error(`Unable to remove stale QB line items: ${staleItemsError.message}`);
    }
  }

  return { company, invoicesSynced, itemsSynced, invoicesDeleted: deletedIds.length };
}
