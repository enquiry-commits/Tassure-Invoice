import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { todaySGT } from '@/lib/date';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';
import { getRequestAccount } from '@/lib/request-account';
import {
  findCustomer, getItemMap, buildInvoiceLineArray,
  nextEstimateDocNumber, estimateDocNumberExists,
  type DraftLineItem,
} from '@/lib/qb-invoice-conventions';
import { ESTIMATE_BOOKS } from '@/lib/quickbooks-estimates';

// POST /api/quickbooks/create-quotation — Vincent: "那个Quotation页面要可以
// 实际开Quotation的功能" (the Quotation page needs to actually be able to
// issue quotations). Everything else on that page (app/billing/quotation/
// page.tsx, lib/quickbooks-estimates.ts, lib/quotation-trace.ts) only ever
// READ QuickBooks Estimates; this is the first write path.
//
// Deliberately much smaller than /api/quickbooks/create-invoice: a
// quotation is a pre-sale document, not a renewal cycle, so none of that
// route's renewal-specific machinery applies here — no period-overlap
// validation (there is no "previous period" to compare against), no PIC/
// Class assignment (that convention is specifically about TAB Secretary/
// XBRL lines tied to an already-confirmed PIC; a prospect being quoted
// usually has none yet), no c/o or parent-company Bill-To override, and no
// idempotency_key reservation table — QuickBooks' own `requestid` parameter
// already de-duplicates a retried request with the same id, and a
// duplicate-invoice-style DocNumber race matters far less for a quotation
// than for a real financial invoice. Gated the same as the read route
// (canViewQuotation, Vincent-only for now) since this is the same feature.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export const preferredRegion = 'sin1';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

function quickBooksRequestId(book: QbCompany, requestKey: string) {
  const digest = createHash('sha256').update(`quotation:${book}:${requestKey}`).digest('hex').slice(0, 32);
  return `tcs-quote-${book.toLowerCase()}-${digest}`;
}

export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewQuotation) return NextResponse.json({ error: 'Your account cannot create quotations.' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const {
    book, companyName, txnDate, expirationDate, privateNote, lines, requestKey,
  } = body as {
    book?: string;
    companyName?: string;
    txnDate?: string;
    expirationDate?: string | null;
    privateNote?: string | null;
    lines?: DraftLineItem[];
    // Client-generated (crypto.randomUUID()), reused across a retry of the
    // exact same submission so QuickBooks' own requestid dedup applies —
    // same pattern create-invoice uses, without that route's own
    // Supabase-backed reservation table (see this file's header comment).
    requestKey?: string;
  };

  if (!book || !ESTIMATE_BOOKS.includes(book as QbCompany)) {
    return NextResponse.json({ error: 'book must be TAB, TAC or TAO' }, { status: 400 });
  }
  const name = companyName?.trim();
  if (!name) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });
  if (!lines?.length) return NextResponse.json({ error: 'At least one line is required' }, { status: 400 });
  if (lines.some(l =>
    !l.description?.trim()
    || !Number.isFinite(Number(l.rate))
    || !Number.isFinite(Number(l.qty ?? 1))
    || Number(l.qty ?? 1) <= 0
    || Math.abs(Number(l.rate)) > 10_000_000
  )) {
    return NextResponse.json({ error: 'Every line requires a description, finite rate and positive quantity.' }, { status: 400 });
  }
  if (!requestKey || !/^[A-Za-z0-9-]{16,100}$/.test(requestKey)) {
    return NextResponse.json({ error: 'A valid request key is required.' }, { status: 400 });
  }
  if (expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) {
    return NextResponse.json({ error: 'expirationDate must be YYYY-MM-DD.' }, { status: 400 });
  }

  const qbBook = book as QbCompany;
  const date = txnDate ?? todaySGT();
  const tokenRow = await getValidToken(qbBook);
  if (!tokenRow) return NextResponse.json({ error: `QuickBooks ${qbBook} not connected` }, { status: 503 });
  const { access_token: token, realm_id: realmId } = tokenRow;

  const customer = await findCustomer(token, realmId, name);
  if (!customer) return NextResponse.json({ error: `Customer not found in QB ${qbBook}: "${name}"` }, { status: 404 });

  const [itemMap, docNumber] = await Promise.all([
    getItemMap(token, realmId),
    nextEstimateDocNumber(token, realmId, date),
  ]);
  if (!docNumber) return NextResponse.json({ error: `Could not determine the next QuickBooks ${qbBook} quotation number.` }, { status: 503 });
  // Narrows the window between the number just estimated and this write —
  // same discipline as invoiceDocNumberExists before an invoice create.
  if (await estimateDocNumberExists(token, realmId, docNumber)) {
    return NextResponse.json({ error: `${docNumber} already exists in QuickBooks ${qbBook}. Try again.` }, { status: 409 });
  }

  const payload: Record<string, unknown> = {
    Line: buildInvoiceLineArray(lines, itemMap, null),
    CustomerRef: { value: customer.id, name: customer.name },
    TxnDate: date,
    DocNumber: docNumber,
    ...(expirationDate ? { ExpirationDate: expirationDate } : {}),
    ...(privateNote?.trim() ? { PrivateNote: privateNote.trim() } : {}),
  };

  const createUrl = new URL(`${QB_BASE}/v3/company/${realmId}/estimate`);
  createUrl.searchParams.set('minorversion', '75');
  createUrl.searchParams.set('requestid', quickBooksRequestId(qbBook, requestKey));
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!createRes.ok) {
    const errText = await createRes.text();
    return NextResponse.json({ error: `QB ${qbBook} quotation create failed: ${errText.slice(0, 300)}` }, { status: 502 });
  }

  const created = await createRes.json();
  const est = created.Estimate ?? {};
  if (!est.Id || typeof est.DocNumber !== 'string') {
    return NextResponse.json({ error: `QB ${qbBook} returned an incomplete quotation result. Check QuickBooks directly before retrying.` }, { status: 502 });
  }
  return NextResponse.json({
    success: true,
    book: qbBook,
    docNumber: est.DocNumber,
    qbEstimateId: est.Id,
    totalAmt: est.TotalAmt ?? 0,
  });
}
