import { todaySGT } from '@/lib/date';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';
import { loadArAgingSnapshot, computeSoaRows, type SoaCompanyRow } from '@/lib/soa-data';
import { LEGAL_NAME } from '@/lib/soa-export';
import { AGING_BUCKETS, TXN_TYPE_TAGS } from '@/lib/soa';

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

// pdf-lib's StandardFonts (Helvetica) only encode WinAnsi — page.drawText()
// throws SYNCHRONOUSLY for any character outside it (confirmed against
// @pdf-lib/standard-fonts' Encoding.js), which is a real, not theoretical,
// risk here: row.companyName/item.docNumber below are raw QuickBooks/
// companies-table text, and this app's own real client base includes
// Chinese-registered names (see lib/quickbooks.ts's CUSTOMER_NAME_CORRECTIONS
// — 吉木锌国际贸易等). A throw here would leave whatever pages were already
// added to `merged` (via prior addPage() calls) silently shipped in the
// final client PDF, half-drawn — this must never happen for a document going
// out to a real paying client. Filters to only what the given font can
// actually encode; a name that's entirely unencodable renders as the
// fallback rather than a blank line, so it's visibly a gap, not invisible.
// Full CJK glyph rendering would need a real embedded font (pdf-lib +
// fontkit + a bundled font file) — deliberately out of scope for this round.
function safeText(font: PDFFont, text: string): string {
  try { font.encodeText(text); return text; } catch { /* fall through */ }
  let out = '';
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch { /* drop this one character */ }
  }
  out = out.trim();
  return out || '(name unavailable)';
}

const TASSURE_CONTACT_LINES = [
  '10 Anson Road',
  '#12-08 International Plaza',
  'Singapore 079903',
  '+6565701965',
  'enquiry@tassure.com',
];

// Vincent, 2026-09-17: this merged PDF used to be nothing but raw invoice/
// credit-memo pages concatenated together — no cover page at all, so a
// client received what looked like a stray invoice, not a real "Statement
// of Account" ("而且不是soa 是inv"). Draws a genuine Statement page —
// Tassure's own letterhead, the aging-bucket summary, and the itemized
// outstanding list — using EXACTLY the same computed row (computeSoaRows(),
// the same shared computation the on-screen SOA list/Excel export already
// use) so its numbers can never drift from what staff see elsewhere. Always
// added to `merged` BEFORE the real invoice/credit-memo pages get merged in
// below (matches Vincent's own framing: "inv 我们会放在soa 下面，在一个pdf
// 里面"). Still scoped to ONE QB company, same as the rest of this route —
// combining TAB+TAC+TAO into a single statement is a deliberately separate,
// larger follow-up (see docs/CURRENT_STATE.md), not attempted here.
async function drawStatementCoverPage(pdfDoc: PDFDocument, company: QbCompany, row: SoaCompanyRow) {
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const grey = rgb(0.4, 0.4, 0.4);
  const left = 50;

  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();
  let right = width - 50;
  let y = height - 50;
  const newPage = () => {
    page = pdfDoc.addPage();
    ({ width, height } = page.getSize());
    right = width - 50;
    y = height - 50;
  };
  const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  page.drawText(LEGAL_NAME[company], { x: left, y, size: 13, font: boldFont });
  y -= 16;
  for (const line of TASSURE_CONTACT_LINES) {
    page.drawText(line, { x: left, y, size: 9, font, color: grey });
    y -= 12;
  }

  y -= 16;
  page.drawText('Statement of Account', { x: left, y, size: 16, font: boldFont });
  y -= 10;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
  y -= 22;

  page.drawText('To:', { x: left, y, size: 9, font, color: grey });
  page.drawText(safeText(boldFont, row.companyName), { x: left + 24, y, size: 11, font: boldFont });
  const dateLabel = `As of ${todaySGT()}`;
  page.drawText(dateLabel, { x: right - font.widthOfTextAtSize(dateLabel, 9), y, size: 9, font, color: grey });
  y -= 28;

  // Aging bucket summary — same 5 buckets/order as the on-screen list and
  // Excel export (lib/soa.ts's AGING_BUCKETS), so this page's own numbers
  // are recognizable against both.
  page.drawText('Aging Summary', { x: left, y, size: 10, font: boldFont });
  y -= 16;
  const bucketColWidth = (right - left - 70) / (AGING_BUCKETS.length + 1);
  let bx = left;
  for (const b of AGING_BUCKETS) {
    page.drawText(b.label, { x: bx, y, size: 8, font: boldFont, color: grey });
    bx += bucketColWidth;
  }
  page.drawText('Total', { x: bx, y, size: 8, font: boldFont, color: grey });
  y -= 14;
  bx = left;
  for (const b of AGING_BUCKETS) {
    page.drawText(money(row.aging[b.key]), { x: bx, y, size: 9, font });
    bx += bucketColWidth;
  }
  page.drawText(`S$${money(row.totalOutstanding)}`, { x: bx, y, size: 9, font: boldFont });
  y -= 20;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
  y -= 22;

  // Itemized list — every real transaction behind the total (Invoice/
  // Credit Note/Payment/Journal Entry/Deposit — same TXN_TYPE_TAGS
  // shorthand as the on-screen list/detail modal, lib/soa.ts), oldest due
  // date first (SoaCompanyRow.lineItems is already sorted that way).
  page.drawText('Outstanding Items', { x: left, y, size: 10, font: boldFont });
  y -= 16;
  const cols = { due: left, doc: left + 75, type: left + 230, amount: right - 20 };
  const drawItemHeader = () => {
    page.drawText('Due Date', { x: cols.due, y, size: 8, font: boldFont, color: grey });
    page.drawText('Document No.', { x: cols.doc, y, size: 8, font: boldFont, color: grey });
    page.drawText('Type', { x: cols.type, y, size: 8, font: boldFont, color: grey });
    page.drawText('Amount', { x: cols.amount - 45, y, size: 8, font: boldFont, color: grey });
    y -= 6;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    y -= 12;
  };
  drawItemHeader();
  for (const item of row.lineItems) {
    if (y < 70) { newPage(); drawItemHeader(); }
    page.drawText(item.dueDate || '—', { x: cols.due, y, size: 9, font });
    page.drawText(safeText(font, item.docNumber), { x: cols.doc, y, size: 9, font });
    page.drawText(safeText(font, TXN_TYPE_TAGS[item.txnType] ?? item.txnType), { x: cols.type, y, size: 9, font });
    const amountText = money(item.amount);
    page.drawText(amountText, { x: cols.amount - font.widthOfTextAtSize(amountText, 9), y, size: 9, font });
    y -= 14;
  }
  y -= 6;
  if (y < 60) { newPage(); }
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
  y -= 16;
  page.drawText('Total Outstanding', { x: cols.type, y, size: 10, font: boldFont });
  const grandTotalText = `S$${money(row.totalOutstanding)}`;
  page.drawText(grandTotalText, { x: cols.amount - boldFont.widthOfTextAtSize(grandTotalText, 10), y, size: 10, font: boldFont });
}

const QB_COMPANIES: QbCompany[] = ['TAB', 'TAC', 'TAO'];

// GET /api/billing/soa/pdf?companyName=...&company=TAB|TAC|TAO — Vincent,
// 2026-09-05: "关于那个PDF合并是存在的，只是每次都是要CHELSEA自己一张一张的
// 合并成一个PDF内，其实也花费了大量的时间" — this is that exact manual step,
// automated. Fetches every real unpaid invoice's PDF for the company IN ONE
// QuickBooks system (same `company` scoping as /api/billing/soa/detail, see
// its comment) and merges every page into one PDF.
export async function GET(req: NextRequest) {
  const companyName = req.nextUrl.searchParams.get('companyName')?.trim();
  if (!companyName) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });
  const company = req.nextUrl.searchParams.get('company') as QbCompany | null;
  if (!company || !QB_COMPANIES.includes(company)) {
    return NextResponse.json({ error: 'company must be one of TAB, TAC, TAO' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const target = normalize(companyName);

  const [invoices, creditMemos] = await Promise.all([
    pageAll(() => supabase
      .from('quickbooks_invoices')
      .select('customer_name, qb_company, qb_invoice_id, invoice_no, txn_date, balance')
      .eq('qb_company', company)
      .gt('balance', 0)) as Promise<Array<{
        customer_name: string; qb_company: string; qb_invoice_id: string; invoice_no: string; txn_date: string | null;
      }>>,
    // Unapplied CreditMemos — merged into the same PDF as their own real
    // QuickBooks document, see fetchCreditMemoPdf's comment.
    pageAll(() => supabase
      .from('quickbooks_credit_memos')
      .select('customer_name, qb_company, qb_credit_memo_id, doc_number, txn_date, balance')
      .eq('qb_company', company)
      .gt('balance', 0)) as Promise<Array<{
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
  let coverPageAdded = false;
  const pageCountBeforeCover = merged.getPageCount();
  try {
    const soaRows = await computeSoaRows(company, { customerNamePrefilter: resolvedRawName });
    const resolvedTarget = normalize(resolvedRawName);
    let row = soaRows.find(r => normalize(r.companyName) === resolvedTarget);
    if (!row) {
      const match = findUniqueBestMatch(resolvedRawName, soaRows, r => r.companyName, 70);
      row = match.value ?? undefined;
    }
    if (row) {
      await drawStatementCoverPage(merged, company, row);
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
  // behavior, same as the detail modal/collections email paths).
  const snapshot = await loadArAgingSnapshot(company, companyName);
  if (snapshot.fresh) {
    const otherRows = snapshot.rows.filter(row => {
      const key = normalize(row.customerName);
      return key === target && !/invoice|credit/i.test(row.txnType);
    });
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
      const cols = { date: left, type: left + 80, doc: left + 220, amount: width - 50 };
      page.drawText('Date', { x: cols.date, y, size: 9, font: boldFont });
      page.drawText('Type', { x: cols.type, y, size: 9, font: boldFont });
      page.drawText('No.', { x: cols.doc, y, size: 9, font: boldFont });
      page.drawText('Amount', { x: cols.amount - 50, y, size: 9, font: boldFont });
      y -= 16;
      let subtotal = 0;
      for (const row of otherRows.sort((a, b) => (a.txnDate ?? '').localeCompare(b.txnDate ?? ''))) {
        subtotal += row.openBalance;
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
