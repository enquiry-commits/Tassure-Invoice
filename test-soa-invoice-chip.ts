// The invoice chip in the SOA detail (docs/INVARIANTS.md INV-QB-029 / INV-MAIL-006). A statement is a CLIENT document: the merged SOA
// PDF already uses the copy the client receives (each service once, the original when attached), but the invoice numbers opened from
// the SOA's own detail list still opened QuickBooks' own PDF — accounting's split lines. Vincent, 2026-10-07, after testing it live:
// "SOA合并是对的，但是 Source 那边的不对（显示的还是拆开的）". The chip now takes a `view`; ONLY the SOA detail asks for 'client'.
// Every other chip (Billing Drafts, AR, Company 360, TAO) is staff-facing and keeps QuickBooks' own PDF, byte for byte.
//
// Run: npx tsx test-soa-invoice-chip.ts
import fs from 'fs';
import path from 'path';
import { invoicePdfRequest } from './lib/invoice-pdf-request';
import type { QbCompany } from './lib/quickbooks';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (!cond && detail ? `\n       ${detail}` : ''));
  if (!cond) fail++;
};
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// The request the chip sent BEFORE `view` existed (components/billing/BillingInvoiceReference.tsx, 2026-09-16) — the reference every
// existing caller must still get, unchanged.
const before = (company: QbCompany, id: string | null, invoiceNo: string, docType: 'invoice' | 'credit') => {
  const params = new URLSearchParams({ company });
  if (id) params.set('id', id); else params.set('invoiceNo', invoiceNo);
  if (docType === 'credit') params.set('docType', 'creditmemo');
  return `/api/quickbooks/invoice-pdf?${params.toString()}`;
};

console.log('--- 1. the request ---');
{
  let same = true;
  for (const company of ['TAB', 'TAC', 'TAO'] as QbCompany[]) for (const id of ['12688', null]) for (const docType of ['invoice', 'credit'] as const) {
    const r = invoicePdfRequest({ company, id, lookupNo: '02610547', docType, view: 'quickbooks' });
    if (r.url !== before(company, id, '02610547', docType) || r.client) same = false;
  }
  check('the default view sends exactly what every chip sent before (3 books × with/without an Id × invoice/credit note)', same);

  const c = invoicePdfRequest({ company: 'TAB', id: '12688', lookupNo: '02610547', docType: 'invoice', view: 'client' });
  check('client view, an invoice with its QuickBooks Id → the client-copy route, by Id', c.client && c.url === '/api/billing/client-invoice-pdf?company=TAB&id=12688', c.url);

  const credit = invoicePdfRequest({ company: 'TAB', id: '77', lookupNo: 'CN-1', docType: 'credit', view: 'client' });
  check('client view, a CREDIT NOTE → still QuickBooks\' own credit-note PDF (the client route is for invoices only)',
    !credit.client && credit.url === before('TAB', '77', 'CN-1', 'credit'), credit.url);

  const noId = invoicePdfRequest({ company: 'TAC', id: null, lookupNo: '02680202', docType: 'invoice', view: 'client' });
  check('client view, a chip given only a number (no Id) → QuickBooks\' own PDF by number, never a guess', !noId.client && noId.url === before('TAC', null, '02680202', 'invoice'), noId.url);
  const emptyId = invoicePdfRequest({ company: 'TAC', id: '', lookupNo: '02680202', docType: 'invoice', view: 'client' });
  check('… an empty Id counts as no Id', !emptyId.client && emptyId.url === noId.url);
  check('the client route is never asked for a number (it only takes an Id)', !/invoiceNo/.test(c.url));
}

console.log('\n--- 2. wiring: only the SOA detail asks for the client copy ---');
{
  const chip = read('components/billing/BillingInvoiceReference.tsx');
  const soa = read('app/billing/soa/_components.tsx');
  const route = read('app/api/billing/client-invoice-pdf/route.ts');
  const pure = read('lib/invoice-pdf-request.ts');

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(rel); }
      else if (/\.tsx$/.test(e.name)) files.push(rel);
    }
  };
  ['app', 'components'].forEach(walk);
  const askers = files.filter(f => /<BillingInvoiceReference\b[^>]*\bview=["{]/.test(read(f).replace(/\n/g, ' ')));
  check('exactly ONE page asks for the client copy: the SOA detail (Billing Drafts, AR, Company 360 and TAO chips are staff-facing and keep QuickBooks\' own PDF)',
    askers.length === 1 && askers[0] === 'app/billing/soa/_components.tsx', askers.join(', '));
  check('… and it asks for it with view="client"', /<BillingInvoiceReference[^>]*view="client"/.test(soa.replace(/\n/g, ' ')));
  check('the chip\'s own default is QuickBooks\' own PDF', /view = 'quickbooks'/.test(chip));
  check('the chip sends what invoicePdfRequest decides — no second URL builder in the component', /fetch\(request\.url\)/.test(chip) && !/URLSearchParams/.test(chip)
    && /invoicePdfRequest\(\{ company, id, lookupNo: invoiceNo \? displayInvoiceNo\(invoiceNo\) : null, docType, view \}\)/.test(chip));
  check('a client copy that fell back to QuickBooks\' own split PDF is shown, never silent (the route\'s header is read; the chip turns amber with the reason)',
    /X-Client-Invoice-Fallback/.test(chip) && /#fffbeb/.test(chip) && /could not be drawn/.test(chip));
  check('the header is only read for a client-copy request', /const detail = clientView \? res\.headers\.get\('X-Client-Invoice-Fallback'\) : null;/.test(chip));
  check('the route the chip calls takes a numeric Id and sets that header', /\^\\d\+\$/.test(route) && /X-Client-Invoice-Fallback/.test(route));
  check('the request builder is pure (no database, no fetch, no server-only)', !/supabase|server-only|process\.env|fetch\(/.test(stripComments(pure)));
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
