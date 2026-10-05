import type { SupabaseClient } from '@supabase/supabase-js';

// `generated_invoices` keeps the invoice number and total from the moment
// Billing Drafts created the invoice; QuickBooks lets staff change both
// afterwards (renumber it, add or drop a line), and nothing copies that back.
// A QuickBooks invoice's identity is (book, QuickBooks Id) — its number and
// total are just its current values. So wherever an invoice from
// `generated_invoices` is SHOWN or SENT, read its current number and total
// from the synced `quickbooks_invoices` mirror by that Id. The log itself is
// never rewritten (it records what was created). docs/INVARIANTS.md
// INV-QB-030 — found 2026-10-05: 1X EXCHANGE was generated as TAB #02611111,
// staff renumbered it #02611112 in QuickBooks (#02611111 was also Nucon's),
// and Billing Drafts kept showing #02611111 — whose chip opened Nucon's PDF.

export type QbInvoiceRef = { qb_company: string | null; qb_invoice_id: string | null };
export type CurrentQbValues = { invoice_no: string | null; total_amt: number | null };

export const qbInvoiceKey = (book: string | null | undefined, id: string | number | null | undefined) => `${book ?? ''}|${id ?? ''}`;

/** Current number + total per (book, QuickBooks Id), from the synced mirror. Rows without an Id are skipped. */
export async function loadCurrentQbValues(supabase: SupabaseClient, rows: readonly QbInvoiceRef[]): Promise<Map<string, CurrentQbValues>> {
  const current = new Map<string, CurrentQbValues>();
  const idsByBook = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.qb_company || !r.qb_invoice_id) continue;
    const ids = idsByBook.get(r.qb_company) ?? new Set<string>();
    ids.add(String(r.qb_invoice_id));
    idsByBook.set(r.qb_company, ids);
  }
  for (const [book, idSet] of idsByBook) {
    const ids = [...idSet];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from('quickbooks_invoices')
        .select('qb_company, qb_invoice_id, invoice_no, total_amt')
        .eq('qb_company', book).in('qb_invoice_id', ids.slice(i, i + 200));
      if (error) throw new Error(`Unable to read current QuickBooks invoice numbers: ${error.message}`);
      for (const q of data ?? []) current.set(qbInvoiceKey(q.qb_company, q.qb_invoice_id), { invoice_no: q.invoice_no ?? null, total_amt: q.total_amt ?? null });
    }
  }
  return current;
}

/**
 * The same rows with QuickBooks' current number and total wherever the mirror
 * has the invoice. An invoice the mirror doesn't hold yet (created minutes
 * ago, before the webhook/nightly sync) keeps its generated values.
 */
export function withCurrentQbValues<T extends QbInvoiceRef & { invoice_no?: string | null; total_amt?: number | null }>(
  rows: readonly T[], current: ReadonlyMap<string, CurrentQbValues>,
): T[] {
  return rows.map(r => {
    const now = r.qb_invoice_id ? current.get(qbInvoiceKey(r.qb_company, r.qb_invoice_id)) : undefined;
    if (!now) return r;
    return {
      ...r,
      ...(now.invoice_no ? { invoice_no: now.invoice_no } : {}),
      ...('total_amt' in r && now.total_amt !== null ? { total_amt: now.total_amt } : {}),
    };
  });
}
