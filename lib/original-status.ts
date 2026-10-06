import 'server-only';

import { createAdminClient } from './supabase';
import { pageAll } from './page-all';
import { getValidToken, qbQuery, type QbCompany } from './quickbooks';
import { createHttpAttachmentReader, type AttachmentReader } from './quickbooks-attachments-http';
import { prepareInvoiceForClient, type LiveInvoice } from './client-invoice-pdf';
import { ORIGINAL_COPY_LOOKUP_MODE } from './quickbooks-original-copy';
import { MAX_ORIGINAL_BYTES, selectVerifiedOriginal, type AttachmentFile, type InvoiceFacts, type OriginalCopyResult } from './original-copy';
import { readPdf } from './pdf-text';
import { chunk, fallbackWording, invoicesByIdQuery, mapLimit, queueRowFor, splitInvoiceRows, verdictKey, type OriginalStatusRow, type QueueResult, type QueueRow } from './original-status-core';
import { confirmedOriginalsFor, redrawDecisionFor } from './original-decisions';

// What the "Invoice Originals" page reads (INV-QB-037): the open invoices
// accounting has split (from the synced rows — no QuickBooks call), and for
// each, whether the system would use an original attached in QuickBooks —
// decided by the SAME proof the SOA runs (selectVerifiedOriginal), on the live
// invoice and the files attached to it, so the page can never list an invoice
// the real PDF path would serve its original, nor hide one it would redraw.
// READ ONLY: nothing here writes to QuickBooks or to any table.

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export async function loadOpenSplitInvoices(): Promise<OriginalStatusRow[]> {
  const sb = createAdminClient();
  const [items, invoices] = await Promise.all([
    pageAll<{ qb_company: string; qb_invoice_id: string; product_service: string | null }>(() => sb.from('quickbooks_invoice_items').select('qb_company, qb_invoice_id, product_service').ilike('product_service', '%deferred%')),
    pageAll<{ qb_company: string; qb_invoice_id: string; invoice_no: string | null; customer_name: string | null; txn_date: string | null; total_amt: number | null; balance: number | null }>(() => sb.from('quickbooks_invoices').select('qb_company, qb_invoice_id, invoice_no, customer_name, txn_date, total_amt, balance').gt('balance', 0)),
  ]);
  return splitInvoiceRows(items, invoices);
}

type LiveRow = LiveInvoice & { Id?: string | number; Balance?: number | string; TxnDate?: string; TotalAmt?: number };

// QuickBooks allows 500 requests a minute per book and the office works in it:
// one batched read per 50 invoices, never one request per invoice.
const INVOICES_PER_QUERY = 50;
// Files read and proven at the same time. The downloads are not QuickBooks API
// calls (a signed link on its file storage); the reading is this server's CPU.
const CONCURRENT_FILES = 6;

async function readLiveInvoices(book: QbCompany, ids: readonly string[]): Promise<Map<string, LiveRow>> {
  const out = new Map<string, LiveRow>();
  for (const part of chunk(ids, INVOICES_PER_QUERY)) {
    const result = await qbQuery(invoicesByIdQuery(part), book);
    if (!result) throw new Error(`QuickBooks ${book} could not be asked for its invoices`);
    for (const inv of result.rows as LiveRow[]) out.set(String(inv.Id), inv);
  }
  return out;
}

async function readTermNames(book: QbCompany): Promise<Map<string, string>> {
  const result = await qbQuery('SELECT * FROM Term MAXRESULTS 1000', book);
  if (!result) throw new Error(`QuickBooks ${book} could not be asked for its payment terms`);
  const out = new Map<string, string>();
  for (const t of result.rows as { Id?: string | number; Name?: string }[]) if (t.Id !== undefined && t.Name?.trim()) out.set(String(t.Id), t.Name.trim());
  return out;
}

// The answer of the look-up for one invoice, kept while neither the invoice
// nor its files change (verdictKey). Only answers that came from the proof
// itself are kept: a download or read that failed may be QuickBooks having a
// bad minute, and must be asked again.
type Remembered = { found: true } | { found: false; result: OriginalCopyResult };
const remembered = new Map<string, Remembered>();
const REMEMBER_LIMIT = 800;

function worthKeeping(result: OriginalCopyResult): boolean {
  return 'found' in result || !result.tried.some(t => t.outcome === 'refused' && /could not be read \(/.test(t.reason));
}

async function lookUp(book: QbCompany, invoiceId: string, facts: InvoiceFacts, files: AttachmentFile[], reader: AttachmentReader): Promise<OriginalCopyResult | { found: true }> {
  const key = verdictKey(book, invoiceId, facts, files);
  const hit = remembered.get(key);
  if (hit) return hit.found ? { found: true } : hit.result;
  // Vincent's decisions count here exactly as they do in the SOA's look-up (lib/original-decisions.ts).
  const result = await selectVerifiedOriginal({ list: async () => files, download: f => reader.download(f, MAX_ORIGINAL_BYTES), read: readPdf }, facts, confirmedOriginalsFor(book, invoiceId));
  if (worthKeeping(result)) {
    // The bytes of a found file are not kept — only that it was found.
    remembered.set(key, 'found' in result ? { found: true } : { found: false, result });
    while (remembered.size > REMEMBER_LIMIT) remembered.delete(remembered.keys().next().value as string);
  }
  return 'found' in result ? { found: true } : result;
}

// The queue: every open split invoice that has no original the system accepts,
// with the files attached to it and why none is accepted. Invoices that are no
// longer open (paid since the last sync) or no longer split are not listed
// either — the live invoice decides, not the synced rows.
let inFlight: Promise<QueueResult> | null = null;

export function loadOriginalsQueue(): Promise<QueueResult> {
  // Two people opening the page at once share one reading.
  inFlight ??= buildQueue().finally(() => { inFlight = null; });
  return inFlight;
}

async function buildQueue(): Promise<QueueResult> {
  const open = await loadOpenSplitInvoices();
  const out: QueueResult = { rows: [], done: 0, decided: 0, unknown: 0, errors: {}, generatedAt: new Date().toISOString() };
  const books = (['TAB', 'TAC'] as const).filter(b => ORIGINAL_COPY_LOOKUP_MODE[b] === 'live' && open.some(r => r.company === b));
  const perBook = await Promise.all(books.map(async (book): Promise<QueueRow[]> => {
    const mine = open.filter(r => r.company === book);
    try {
      const token = await getValidToken(book);
      if (!token) throw new Error(`QuickBooks ${book} is not connected`);
      const reader = createHttpAttachmentReader({ base: QB_BASE, realmId: token.realm_id, accessToken: token.access_token, timeoutMs: 30_000 });
      const [attachments, invoices, terms] = await Promise.all([reader.listAllForInvoices(), readLiveInvoices(book, mine.map(r => r.qbInvoiceId)), readTermNames(book)]);
      const failures: string[] = [];
      const rows = await mapLimit(mine, CONCURRENT_FILES, async (row): Promise<QueueRow | 'done' | 'decided' | 'closed' | 'unknown'> => {
        try {
          const live = invoices.get(row.qbInvoiceId);
          // Paid, voided or deleted since the last sync: not waiting for anything.
          if (!live || !(Number(live.Balance) > 0)) return 'closed';
          const prepared = prepareInvoiceForClient(book, live, live.SalesTermRef?.value ? terms.get(String(live.SalesTermRef.value)) ?? null : null);
          // No longer carries a Deferred Revenue line: QuickBooks' own PDF is right.
          if (!prepared.facts) return 'closed';
          const files = attachments.get(row.qbInvoiceId) ?? [];
          const answer = await lookUp(book, row.qbInvoiceId, prepared.facts, files, reader);
          if ('found' in answer) return 'done';
          // Vincent decided to leave it as it is (and it is still the invoice he decided about): not waiting for anything.
          if (redrawDecisionFor(book, row.qbInvoiceId, prepared.facts)) return 'decided';
          // The live figures, not the synced ones.
          return queueRowFor({ ...row, balance: Number(live.Balance), totalAmt: Number(live.TotalAmt ?? row.totalAmt), txnDate: live.TxnDate ?? row.txnDate }, files, answer, fallbackWording(prepared.decision)) ?? 'done';
        } catch (err) {
          // One invoice that cannot be judged must not hide the others: it is not
          // listed (it is not known to be waiting) and is counted as not checked.
          failures.push(err instanceof Error ? err.message : String(err));
          return 'unknown';
        }
      });
      out.done += rows.filter(r => r === 'done').length;
      out.decided += rows.filter(r => r === 'decided').length;
      if (failures.length) {
        out.unknown += failures.length;
        out.errors[book] = `${failures.length} invoice${failures.length === 1 ? '' : 's'} could not be checked (${failures[0]})`;
      }
      return rows.filter((r): r is QueueRow => typeof r === 'object');
    } catch (err) {
      out.errors[book] = err instanceof Error ? err.message : String(err);
      out.unknown += mine.length;
      return [];
    }
  }));
  out.rows = perBook.flat().sort((a, b) => String(b.txnDate ?? '').localeCompare(String(a.txnDate ?? '')) || b.invoiceNo.localeCompare(a.invoiceNo));
  return out;
}
