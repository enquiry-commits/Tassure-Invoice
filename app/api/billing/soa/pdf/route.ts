import { todaySGT } from '@/lib/date';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';
import { findCustomer, addrToLines } from '@/lib/qb-invoice-conventions';
import { loadArAgingSnapshot, computeSoaRows, type SoaCompanyRow } from '@/lib/soa-data';
import { LEGAL_NAME } from '@/lib/soa-export';
import { drawStatementCoverPage, combineStatementRows, safeText, type StatementRow } from '@/lib/statement-pdf';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

async function fetchInvoicePdf(company: QbCompany, invoiceId: string): Promise<ArrayBuffer> {
  const token = await getValidToken(company);
  if (!token) throw new Error(`QuickBooks ${company} not connected`);
  const res = await fetch(`${QB_BASE}/v3/company/${token.realm_id}/invoice/${invoiceId}/pdf?minorversion=65`, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/pdf' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`QuickBooks ${company} PDF request failed for invoice ${invoiceId}`);
  return res.arrayBuffer();
}

// Same pattern as fetchInvoicePdf, QuickBooks' own symmetric endpoint for a
// CreditMemo's official PDF. Added 2026-09-15 so an unapplied Credit Note
// merges into the same statement as its own real, official QuickBooks
// document — not a number we computed ourselves — the client sees exactly
// what QuickBooks itself would show. See docs/INVARIANTS.md.
async function fetchCreditMemoPdf(company: QbCompany, creditMemoId: string): Promise<ArrayBuffer> {
  const token = await getValidToken(company);
  if (!token) throw new Error(`QuickBooks ${company} not connected`);
  const res = await fetch(`${QB_BASE}/v3/company/${token.realm_id}/creditmemo/${creditMemoId}/pdf?minorversion=65`, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/pdf' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`QuickBooks ${company} PDF request failed for credit memo ${creditMemoId}`);
  return res.arrayBuffer();
}

// Best-effort live fetch of a customer's real QuickBooks BillAddr, flattened
// to printable lines (see qb-invoice-conventions.ts's addrToLines) — Vincent,
// 2026-09-17, second round on the Statement cover page: "地址都没有看到" (his
// real reference PDF prints the client's registered mailing address under
// their name; this route used to omit it entirely). Never stored redundantly
// in this app's own tables, so this always reads live from QuickBooks itself
// at Statement-generation time — an unreachable book or a customer with no
// BillAddr on file just means the address block is skipped, same
// never-break-the-whole-Statement posture as the logo/font-safety fallbacks
// elsewhere on this page.
async function resolveBillAddrLines(book: QbCompany, customerName: string): Promise<string[]> {
  try {
    const token = await getValidToken(book);
    if (!token) return [];
    const customer = await findCustomer(token.access_token, token.realm_id, customerName);
    return customer ? addrToLines(customer.billAddr) : [];
  } catch {
    return [];
  }
}

// Real per-invoice number + line description, for the itemized table's
// DESCRIPTION column — Vincent, 2026-09-17, fourth round on this page:
// "这部分为什么生成出来的没有像这个那么完整" (pointing at the reference's
// rich "Invoice No.02610894: Due 31/07/2026. XBRL for the year (FYE
// 31.12.2025)" text). Two real gaps this closes: (1) SoaCompanyRow.lineItems
// (computeSoaRows()'s own fresh-snapshot path) can carry a doc_number with
// its leading zero silently stripped ("2610894" vs QuickBooks' own real
// "02610894" — confirmed against real data, quickbooks_invoices/
// quickbooks_invoice_items both still have it correctly). (2) it never
// carried the invoice's actual line Description at all. Rather than trust
// the possibly-stripped docNumber, this builds its lookup from `matched` —
// the same real `quickbooks_invoices` rows (qb_invoice_id + invoice_no,
// already fetched further up, never re-queried) already used to merge the
// real invoice PDFs below — and joins to quickbooks_invoice_items by exact
// qb_invoice_id, so both the printed invoice number and its description
// always come from the same real row this Statement is actually about. Keyed
// by the NUMERIC value of invoice_no (String(Number(...))) so a lookup by
// the possibly-stripped docNumber from SoaCompanyRow.lineItems still finds
// it. First invoice line (line_num ascending) only, matching the reference's
// own single-line style — a multi-line item description keeps only its
// first line (see statement-pdf.ts's own use of this).
async function resolveInvoiceDetails(
  matchedInvoices: Array<{ qb_company: string; qb_invoice_id: string; invoice_no: string }>,
): Promise<Map<string, { invoiceNo: string; description: string | null }>> {
  const result = new Map<string, { invoiceNo: string; description: string | null }>();
  const byBook = new Map<string, string[]>();
  for (const inv of matchedInvoices) {
    if (!inv.invoice_no) continue;
    const numKey = String(Number(inv.invoice_no));
    if (numKey === 'NaN') continue;
    result.set(numKey, { invoiceNo: inv.invoice_no, description: null });
    const ids = byBook.get(inv.qb_company) ?? [];
    ids.push(inv.qb_invoice_id);
    byBook.set(inv.qb_company, ids);
  }
  if (!result.size) return result;
  try {
    const supabase = createAdminClient();
    await Promise.all([...byBook.entries()].map(async ([book, ids]) => {
      const { data } = await supabase
        .from('quickbooks_invoice_items')
        .select('qb_invoice_id, invoice_no, description, line_num')
        .eq('qb_company', book)
        .in('qb_invoice_id', ids)
        .order('line_num', { ascending: true });
      for (const row of data ?? []) {
        if (!row.invoice_no || !row.description) continue;
        const numKey = String(Number(row.invoice_no));
        const entry = result.get(numKey);
        if (entry && !entry.description) entry.description = row.description;
      }
    }));
  } catch {
    // Best-effort enrichment only — a failed lookup here must never break
    // the Statement, it just falls back to the plainer "docNumber (Type)"
    // description the itemized table already used before this round.
  }
  return result;
}

const QB_COMPANIES: QbCompany[] = ['TAB', 'TAC', 'TAO'];

// Vincent, 2026-09-17, re-examining the "1V Capital" example that started
// this whole feature: "当我在All 那边点 Draft 是要一起附带上 TAB/TAO/TAC的
// 就和之前的一样...Total 也是TAB/TAO/TAC的 加在一起" — the All page's own
// Draft/PDF action is deliberately the ONE place this route combines all 3
// books into a single Statement (aging/total/line-items/merged invoice
// pages all summed across TAB+TAC+TAO for one customer) — every single-book
// page (TAB/TAC/TAO) stays exactly as scoped today. 'ALL' is this route's
// own pseudo-company for that mode, never a real QbCompany value stored
// anywhere.
type CompanySelector = QbCompany | 'ALL';
const COMPANY_SELECTORS: CompanySelector[] = ['TAB', 'TAC', 'TAO', 'ALL'];

// GET /api/billing/soa/pdf?companyName=...&company=TAB|TAC|TAO|ALL — Vincent,
// 2026-09-05: "关于那个PDF合并是存在的，只是每次都是要CHELSEA自己一张一张的
// 合并成一个PDF内，其实也花费了大量的时间" — this is that exact manual step,
// automated. Fetches every real unpaid invoice's PDF for the company IN ONE
// QuickBooks system (same `company` scoping as /api/billing/soa/detail, see
// its comment) and merges every page into one PDF — or, in 'ALL' mode,
// every unpaid invoice across ALL THREE systems for that one customer name.
export async function GET(req: NextRequest) {
  const companyName = req.nextUrl.searchParams.get('companyName')?.trim();
  if (!companyName) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });
  const company = req.nextUrl.searchParams.get('company') as CompanySelector | null;
  if (!company || !COMPANY_SELECTORS.includes(company)) {
    return NextResponse.json({ error: 'company must be one of TAB, TAC, TAO, ALL' }, { status: 400 });
  }
  const combineAllBooks = company === 'ALL';

  const supabase = createAdminClient();
  const target = normalize(companyName);

  const [invoices, creditMemos] = await Promise.all([
    pageAll(() => {
      const q = supabase.from('quickbooks_invoices')
        .select('customer_name, qb_company, qb_invoice_id, invoice_no, txn_date, balance')
        .gt('balance', 0);
      return combineAllBooks ? q.in('qb_company', QB_COMPANIES) : q.eq('qb_company', company);
    }) as Promise<Array<{
        customer_name: string; qb_company: string; qb_invoice_id: string; invoice_no: string; txn_date: string | null;
      }>>,
    // Unapplied CreditMemos — merged into the same PDF as their own real
    // QuickBooks document, see fetchCreditMemoPdf's comment.
    pageAll(() => {
      const q = supabase.from('quickbooks_credit_memos')
        .select('customer_name, qb_company, qb_credit_memo_id, doc_number, txn_date, balance')
        .gt('balance', 0);
      return combineAllBooks ? q.in('qb_company', QB_COMPANIES) : q.eq('qb_company', company);
    }) as Promise<Array<{
        customer_name: string; qb_company: string; qb_credit_memo_id: string; doc_number: string | null; txn_date: string | null;
      }>>,
  ]);

  const byName = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const key = normalize(inv.customer_name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(inv);
  }
  const creditByName = new Map<string, typeof creditMemos>();
  for (const cm of creditMemos) {
    const key = normalize(cm.customer_name);
    if (!key) continue;
    if (!creditByName.has(key)) creditByName.set(key, []);
    creditByName.get(key)!.push(cm);
  }

  let matched = byName.get(target);
  if (!matched) {
    const match = findUniqueBestMatch(companyName, [...byName.entries()], entry => entry[0], 70);
    matched = match.value?.[1];
  }
  let matchedCredits = creditByName.get(target);
  if (!matchedCredits) {
    const match = findUniqueBestMatch(companyName, [...creditByName.entries()], entry => entry[0], 70);
    matchedCredits = match.value?.[1];
  }
  if ((!matched || !matched.length) && (!matchedCredits || !matchedCredits.length)) {
    return NextResponse.json({ error: `No outstanding invoices found for "${companyName}".` }, { status: 404 });
  }
  matched = matched ?? [];
  matchedCredits = matchedCredits ?? [];

  // Oldest first, so the statement reads like a running account, same order
  // the detail view sorts by. Invoices and credit notes are interleaved by
  // date, not grouped, so the merged PDF reads as one chronological account.
  type MergeItem = { qbCompany: string; docLabel: string; txnDate: string | null; kind: 'invoice' | 'credit'; id: string };
  const mergeItems: MergeItem[] = [
    ...matched.map(inv => ({ qbCompany: inv.qb_company, docLabel: inv.invoice_no, txnDate: inv.txn_date, kind: 'invoice' as const, id: inv.qb_invoice_id })),
    ...matchedCredits.map(cm => ({ qbCompany: cm.qb_company, docLabel: cm.doc_number ?? cm.qb_credit_memo_id, txnDate: cm.txn_date, kind: 'credit' as const, id: cm.qb_credit_memo_id })),
  ].sort((a, b) => (a.txnDate ?? '').localeCompare(b.txnDate ?? ''));

  const merged = await PDFDocument.create();

  // Cover page first (see drawStatementCoverPage's own comment). Resolves
  // against the EXACT raw customer_name the invoice/credit-memo matching
  // above already settled on (not the free-text `companyName` query param
  // again) — computeSoaRows() runs its own independent match, and re-running
  // it against the same ambiguous free text risked resolving to a DIFFERENT
  // real customer than the one whose invoices are being merged below (two
  // real companies with similar/overlapping names both scoring a fuzzy
  // match). Using the already-resolved raw name as both the prefilter and
  // the match target means this can only land on the same customer's row,
  // or (if the snapshot/companies-table pipeline genuinely has no matching
  // entry for that exact name) no row at all — never someone else's. A
  // failure/no-match here must never break the pre-existing, working
  // invoice-PDF merge below — it degrades to no cover page rather than
  // failing the whole download.
  const resolvedRawName = matched[0]?.customer_name ?? matchedCredits[0]?.customer_name ?? companyName;
  const resolveOneBookRow = async (book: QbCompany): Promise<SoaCompanyRow | undefined> => {
    const soaRows = await computeSoaRows(book, { customerNamePrefilter: resolvedRawName });
    const resolvedTarget = normalize(resolvedRawName);
    const exact = soaRows.find(r => normalize(r.companyName) === resolvedTarget);
    if (exact) return exact;
    return findUniqueBestMatch(resolvedRawName, soaRows, r => r.companyName, 70).value ?? undefined;
  };
  let coverPageAdded = false;
  const pageCountBeforeCover = merged.getPageCount();
  try {
    // "Tassure Group" for the combined letterhead — TAB/TAC/TAO are 3
    // separate legal entities, so no single one of their names is accurate
    // here; this is the exact umbrella term Vincent's own real reminder
    // emails already use ("GENTLE REMINDER FROM TASSURE GROUP").
    let statementRow: StatementRow | null;
    let legalName: string;
    if (combineAllBooks) {
      const bookRows = (await Promise.all(QB_COMPANIES.map(resolveOneBookRow))).filter((r): r is SoaCompanyRow => !!r);
      statementRow = bookRows.length ? combineStatementRows(bookRows, resolvedRawName) : null;
      legalName = 'Tassure Group';
    } else {
      statementRow = (await resolveOneBookRow(company)) ?? null;
      legalName = LEGAL_NAME[company];
    }
    if (statementRow) {
      // Whichever book actually produced resolvedRawName (matched[0]/
      // matchedCredits[0] above) is the real QuickBooks Customer record to
      // pull the mailing address from — same book either way in single-book
      // mode; in 'ALL' mode this is just whichever of TAB/TAC/TAO happened
      // to come first in the pooled invoice/credit-memo list, which is fine
      // since it's the same real-world company's address regardless of book.
      const addrBook = (matched[0]?.qb_company ?? matchedCredits[0]?.qb_company ?? company) as QbCompany;
      const [billAddrLines, invoiceDetails] = await Promise.all([
        resolveBillAddrLines(addrBook, resolvedRawName),
        resolveInvoiceDetails(matched),
      ]);
      await drawStatementCoverPage(merged, legalName, statementRow, resolvedRawName, billAddrLines, invoiceDetails);
      coverPageAdded = true;
    }
  } catch {
    // Remove any pages drawStatementCoverPage managed to add before
    // throwing (e.g. mid-draw) — this must never ship a half-drawn page
    // silently merged into a real client PDF, regardless of WHY it failed.
    for (let i = merged.getPageCount() - 1; i >= pageCountBeforeCover; i--) merged.removePage(i);
    coverPageAdded = false;
  }

  const errors: string[] = [];
  for (const item of mergeItems) {
    try {
      const buf = item.kind === 'invoice'
        ? await fetchInvoicePdf(item.qbCompany as QbCompany, item.id)
        : await fetchCreditMemoPdf(item.qbCompany as QbCompany, item.id);
      const src = await PDFDocument.load(buf);
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const page of pages) merged.addPage(page);
    } catch (err) {
      errors.push(`${item.qbCompany} #${item.docLabel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Was `merged.getPageCount() === 0` — no longer a valid check now that the
  // cover page above can already occupy page 1. Only hard-fail when there is
  // truly nothing useful to send: every real invoice/credit-memo PDF fetch
  // failed AND the cover page itself didn't make it in either. When the
  // cover page DID succeed, a real (if incomplete — missing the underlying
  // invoice documents) Statement is still more useful to staff than an
  // outright error, so fall through and return it.
  if (mergeItems.length > 0 && errors.length === mergeItems.length && !coverPageAdded) {
    return NextResponse.json({ error: `Could not fetch any invoice PDFs. ${errors.join(' ')}` }, { status: 502 });
  }

  // Added 2026-09-15 (docs/INVARIANTS.md INV-QB-017) — Payment/Journal
  // Entry/Deposit/anything else QuickBooks' own AgedReceivableDetail report
  // counts against this customer's balance has no client-facing document
  // to merge (unlike Invoice/CreditMemo, which always do) — appending
  // nothing for these would leave the merged PDF's own total quietly short
  // of what the rest of the system shows for this customer. When the
  // report is fresh, list them on one appended summary page instead, so
  // the merged PDF's total always foots. Omitted entirely when there are
  // none (today's exact behavior, unchanged for the common case) or when
  // the report is stale for this company (falls back to exactly today's
  // behavior, same as the detail modal/collections email paths). In 'ALL'
  // mode this loops all 3 books, same "only a fresh book's snapshot counts"
  // rule applied per book, and tags each row with its own book since they
  // now come from more than one.
  const otherBooks = combineAllBooks ? QB_COMPANIES : [company as QbCompany];
  const otherRows: { book: QbCompany; txnDate: string | null; txnType: string; docNumber: string | null; qbTxnId: string | null; openBalance: number }[] = [];
  for (const book of otherBooks) {
    const snapshot = await loadArAgingSnapshot(book, companyName);
    if (!snapshot.fresh) continue;
    for (const row of snapshot.rows) {
      if (normalize(row.customerName) !== target || /invoice|credit/i.test(row.txnType)) continue;
      otherRows.push({ book, txnDate: row.txnDate, txnType: row.txnType, docNumber: row.docNumber, qbTxnId: row.qbTxnId, openBalance: row.openBalance });
    }
  }
  if (otherRows.length) {
    const font = await merged.embedFont(StandardFonts.Helvetica);
    const boldFont = await merged.embedFont(StandardFonts.HelveticaBold);
    const page = merged.addPage();
    const { width, height } = page.getSize();
    let y = height - 60;
    const left = 50;
    page.drawText('Other Adjustments', { x: left, y, size: 14, font: boldFont });
    y -= 20;
    page.drawText(`Not represented by an individual invoice/credit note document above.`, { x: left, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 24;
    const cols = combineAllBooks
      ? { book: left, date: left + 40, type: left + 120, doc: left + 260, amount: width - 50 }
      : { book: null, date: left, type: left + 80, doc: left + 220, amount: width - 50 };
    if (cols.book !== null) page.drawText('Book', { x: cols.book, y, size: 9, font: boldFont });
    page.drawText('Date', { x: cols.date, y, size: 9, font: boldFont });
    page.drawText('Type', { x: cols.type, y, size: 9, font: boldFont });
    page.drawText('No.', { x: cols.doc, y, size: 9, font: boldFont });
    page.drawText('Amount', { x: cols.amount - 50, y, size: 9, font: boldFont });
    y -= 16;
    let subtotal = 0;
    for (const row of otherRows.sort((a, b) => (a.txnDate ?? '').localeCompare(b.txnDate ?? ''))) {
      subtotal += row.openBalance;
      if (cols.book !== null) page.drawText(row.book, { x: cols.book, y, size: 9, font });
      page.drawText(row.txnDate ?? '—', { x: cols.date, y, size: 9, font });
      page.drawText(row.txnType, { x: cols.type, y, size: 9, font });
      page.drawText(safeText(font, row.docNumber ?? row.qbTxnId ?? '—'), { x: cols.doc, y, size: 9, font });
      const amountText = row.openBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      page.drawText(amountText, { x: width - 50 - font.widthOfTextAtSize(amountText, 9), y, size: 9, font });
      y -= 14;
    }
    y -= 6;
    page.drawText('Subtotal', { x: cols.type, y, size: 10, font: boldFont });
    const subtotalText = subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    page.drawText(subtotalText, { x: width - 50 - boldFont.widthOfTextAtSize(subtotalText, 10), y, size: 10, font: boldFont });
  }

  const bytes = Buffer.from(await merged.save());
  const fileName = `SOA - ${companyName} - ${todaySGT()}.pdf`;
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, "'")}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
      // Surfaced so the UI can warn if some (but not all) invoices failed to
      // merge, without failing the whole download.
      'X-Soa-Merge-Errors': String(errors.length),
    },
  });
}
