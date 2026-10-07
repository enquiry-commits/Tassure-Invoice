// An invoice is (book, QuickBooks Id); its number and total are whatever
// QuickBooks holds NOW (docs/INVARIANTS.md INV-QB-030). Vincent, 2026-10-05:
// "inv number qb 改了system 没有同步" → "单号问题先处理好".
//
// Run: npx tsx test-current-invoice-values.ts
import { readFileSync } from 'fs';
import { withCurrentQbValues, qbInvoiceKey } from './lib/current-invoice-values';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};

console.log('--- the real 2026-10-05 cases ---');
const current = new Map([
  [qbInvoiceKey('TAB', '25915'), { invoice_no: '02611112', total_amt: 1360 }],   // 1X EXCHANGE, renumbered in QuickBooks
  [qbInvoiceKey('TAB', '24726'), { invoice_no: '02610986', total_amt: 1720 }],   // NOVOZEE, payroll added in QuickBooks
]);
const logged = [
  { company_name: '1X EXCHANGE PTE. LTD.', qb_company: 'TAB', qb_invoice_id: '25915', invoice_no: '02611111', total_amt: 1360 },
  { company_name: 'NOVOZEE PTE. LTD.', qb_company: 'TAB', qb_invoice_id: '24726', invoice_no: '02610986', total_amt: 1120 },
  { company_name: 'OLD BACKFILL', qb_company: 'TAB', qb_invoice_id: null, invoice_no: '02510481', total_amt: 660 },
  { company_name: 'JUST CREATED', qb_company: 'TAB', qb_invoice_id: '99999', invoice_no: '02611200', total_amt: 500 },
];
const out = withCurrentQbValues(logged, current);
check('1X shows QuickBooks\' current #02611112, not #02611111 (now Nucon\'s)', out[0].invoice_no === '02611112', out[0].invoice_no ?? '');
check('Novozee shows QuickBooks\' current S$1,720, not the S$1,120 logged at creation', out[1].total_amt === 1720, String(out[1].total_amt));
check('a backfilled row with no QuickBooks Id keeps its logged values', out[2].invoice_no === '02510481' && out[2].total_amt === 660);
check('an invoice the mirror hasn\'t synced yet keeps its creation values', out[3].invoice_no === '02611200' && out[3].total_amt === 500);
check('the same Id in another book is a different invoice', withCurrentQbValues([{ qb_company: 'TAC', qb_invoice_id: '25915', invoice_no: 'X', total_amt: 1 }], current)[0].invoice_no === 'X');
check('the logged rows themselves are never modified (the log stays as created)', logged[0].invoice_no === '02611111' && logged[1].total_amt === 1120);
check('a row without total_amt doesn\'t gain one', !('total_amt' in withCurrentQbValues([{ qb_company: 'TAB', qb_invoice_id: '25915', invoice_no: '02611111' }], current)[0]));

console.log('\n--- every place that shows or sends a generated invoice reads the current values ---');
const read = (p: string) => readFileSync(p, 'utf8');
for (const [file, label] of [
  ['app/api/billing/renewals/route.ts', 'Billing Drafts (row chip, "Editing invoice #", PDF name, renewal evidence)'],
  ['lib/client-comms-resolve.ts', 'AR email invoice list'],
  ['app/api/ar-reminder/route.ts', 'AR Reminder invoice column'],
  ['lib/company-360.ts', 'Company 360'],
] as const) {
  const src = read(file);
  check(`${label} overlays QuickBooks' current values`, /withCurrentQbValues\(/.test(src) && /loadCurrentQbValues\(/.test(src));
}
const page = read('app/billing/page.tsx');
check('Billing chips for a generated invoice open it by QuickBooks Id', (page.match(/id=\{r\.qbId \?\? undefined\}/g) ?? []).length >= 4 && /qbId: g\.qbId/.test(page));
const pdf = read('app/api/quickbooks/invoice-pdf/route.ts');
check('opening by number refuses when two QuickBooks invoices share it (no "first match")', /rows\.length \?\? 0\) > 1/.test(pdf) && /status: 409/.test(pdf));
const refresh = read('app/api/client-communications/drafts/refresh-amounts/route.ts');
// The live amount is TotalAmt for AR/letter emails and Balance for an SOA (lib/draft-refresh.ts, INV-MAIL-007); both are read, with the number.
check('the pre-send check refreshes the number as well as the amount', /SELECT Id, DocNumber, TotalAmt, Balance, ExchangeRate FROM Invoice/.test(refresh) && /numberChanged/.test(refresh));
const helper = read('lib/draft-helper-client.ts');
check('no send path skips the pre-send check any more', !/skip_amount_refresh\s*\)/.test(helper) && !/skip_amount_refresh: true/.test(page) && !/skip_amount_refresh: true/.test(read('lib/campaign-draft-client.ts')));
check('attachment names follow the refreshed number', /refreshed\.corrected\s*\n?\s*\?\s*fetchedAttachments\.map/.test(helper));
const create = read('app/api/quickbooks/create-invoice/route.ts');
const conventions = read('lib/qb-invoice-conventions.ts');
check('the duplicate-number check fails closed (no answer from QuickBooks = no create)', /numberStatus === 'unknown'/.test(create) && !/invoiceDocNumberExists/.test(create + conventions));
check('after creating, a same-number invoice is reported', /invoiceDocNumberCount\(token, realmId, invoiceNo\)/.test(create) && /duplicateNumber/.test(read('components/billing/ExpandedBillingRow.tsx')));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
