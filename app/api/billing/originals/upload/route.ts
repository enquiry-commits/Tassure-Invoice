import { NextRequest, NextResponse } from 'next/server';
import { canAccountOpen } from '@/lib/approved-accounts';
import { getRequestAccount } from '@/lib/request-account';
import { MAX_ORIGINAL_BYTES } from '@/lib/original-copy';
import { httpStatusFor } from '@/lib/original-upload';
import { uploadOriginalToQuickBooks } from '@/lib/original-upload-live';
import type { QbCompany } from '@/lib/quickbooks';

// POST /api/billing/originals/upload (multipart: company, id, file) — a staff
// member uploads the ORIGINAL invoice PDF they found for one split invoice on the
// Invoice Originals page (INV-QB-037). The file is checked against the LIVE
// invoice with the same proof the SOA uses and attached to the invoice in
// QuickBooks only if it passes; a wrong file is refused and nothing is attached.
// The one write of that page: it adds one attachment to one invoice and never
// removes or changes anything. Needs an account that may open the page — the
// proxy only checks sign-in on /api.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const preferredRegion = 'sin1';

const BOOKS = new Set<QbCompany>(['TAB', 'TAC']);
const noStore = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!canAccountOpen(account, '/billing/soa/originals', new URLSearchParams())) {
    return NextResponse.json({ error: 'Your account does not have access to Invoice Originals.' }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const company = String(form?.get('company') ?? '') as QbCompany;
  const id = String(form?.get('id') ?? '').trim();
  const file = form?.get('file');
  if (!BOOKS.has(company)) return NextResponse.json({ error: 'company must be TAB or TAC' }, { status: 400 });
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'A valid QuickBooks invoice id is required.' }, { status: 400 });
  if (!file || !(file instanceof File)) return NextResponse.json({ error: 'A PDF file is required (field name "file").' }, { status: 400 });
  if (file.size > MAX_ORIGINAL_BYTES) {
    return NextResponse.json({ status: 'refused', reason: `the file is larger than ${MAX_ORIGINAL_BYTES / 1024 / 1024} MB — an invoice PDF is 80-260 KB`, hint: 'An invoice PDF is well under 1 MB — use the PDF QuickBooks printed, not a scan.' }, { status: 422, headers: noStore });
  }

  try {
    const result = await uploadOriginalToQuickBooks(company, id, new Uint8Array(await file.arrayBuffer()), { name: account.name, email: account.email });
    // Ids and the outcome only — file names carry client names.
    console.info(`[originals/upload] ${company} ${id} ${result.status} (${account.email})`);
    return NextResponse.json(result, { status: httpStatusFor(result), headers: noStore });
  } catch (err) {
    console.error('[originals/upload] failed', company, id, err);
    return NextResponse.json({ status: 'failed', error: err instanceof Error ? err.message : String(err) }, { status: 500, headers: noStore });
  }
}
