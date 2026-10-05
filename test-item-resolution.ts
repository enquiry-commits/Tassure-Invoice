// TAB/TAC line items are resolved EXACTLY or not at all, and only real
// renewal items get the period check (docs/INVARIANTS.md INV-QB-033).
// Vincent, 2026-10-05: "拦下并说明原因" / "只检查真正的续费项目".
//
// Run: npx tsx test-item-resolution.ts
import { readFileSync } from 'fs';
import { buildInvoiceLineArray, QbItemLookupError } from './lib/qb-invoice-conventions';
import { needsRenewalPeriodCheck } from './lib/invoice-period';

let fail = 0;
const check = (name: string, cond: boolean) => { console.log((cond ? 'OK   ' : 'FAIL ') + name); if (!cond) fail++; };

console.log('--- which lines get the renewal-period check ---');
check('corporate secretarial retainer → checked', needsRenewalPeriodCheck({ service: 'Secretary', productService: 'Secretary:Corporate Secretarial Services' }));
check('registered address → checked', needsRenewalPeriodCheck({ service: 'Address', productService: 'Secretary:Registered Address Services' }));
check('nominee director fees → checked', needsRenewalPeriodCheck({ service: 'ND', productService: 'Secretary:Nominee Director Fees - WW' }));
check('Change of Director (one-off) → NOT checked', !needsRenewalPeriodCheck({ service: 'Secretary', productService: 'Secretary:Change of Director' }));
check('Strike Off / CTC / Shares Transfer → NOT checked', ['Secretary:Strike Off Services', 'Secretary:CTC', 'Secretary:Shares Transfer'].every(p => !needsRenewalPeriodCheck({ service: 'Secretary', productService: p })));
check('Nominee Director Deposit → NOT checked', !needsRenewalPeriodCheck({ service: 'ND', productService: 'Secretary:Nominee Director Deposit' }));
check('a line with no item name keeps the old service rule', needsRenewalPeriodCheck({ service: 'Secretary' }) && !needsRenewalPeriodCheck({ service: 'AR' }));
check('accounting\'s deferred twin → NOT checked', !needsRenewalPeriodCheck({ service: 'Secretary', productService: 'Deferred Revenue - Corp Sec' }));

console.log('\n--- item resolution never guesses ---');
const itemMap = new Map([
  ['secretary:corporate secretarial services', { id: '11', name: 'Secretary:Corporate Secretarial Services' }],
  ['secretary:cpf submission', { id: '22', name: 'Secretary:CPF Submission' }],
]);
const line = (o: Record<string, unknown>) => ({ service: 'Secretary', description: 'x', rate: 100, ...o });
const ref = (l: Record<string, unknown>) => buildInvoiceLineArray([line(l)], itemMap, null)[0].SalesItemLineDetail.ItemRef.value;
check('an exact item name resolves to that item', ref({ productService: 'Secretary:CPF Submission' }) === '22');
check('a line\'s existing item Id is used as-is (no name lookup)', ref({ productService: 'Old Item (deleted)', itemId: '99' }) === '99');
let threw: unknown = null;
try { buildInvoiceLineArray([line({ productService: 'Secretary:CPF Submission Services' })], itemMap, null); } catch (e) { threw = e; }
check('a TAB-only name in a book without it STOPS (no keyword guess)', threw instanceof QbItemLookupError && /CPF Submission Services/.test(String((threw as Error).message)));
check('a line with no item name still gets the service default', ref({}) === '11');

console.log('\n--- every write path stops cleanly ---');
const read = (p: string) => readFileSync(p, 'utf8');
const conv = read('lib/qb-invoice-conventions.ts');
check('a failed item-list read throws instead of an empty map', /if \(!res\.ok\) throw new QbItemLookupError/.test(conv));
for (const p of ['app/api/quickbooks/create-invoice/route.ts', 'app/api/quickbooks/update-invoice/route.ts', 'app/api/quickbooks/create-quotation/route.ts']) {
  check(`${p.split('/')[3]} turns a lookup failure into a plain error`, (read(p).match(/instanceof QbItemLookupError/g) ?? []).length >= 2);
}
check('update-invoice accepts only numeric item ids', /l\.itemId !== undefined && !\/\^\\d\+\$\/\.test/.test(read('app/api/quickbooks/update-invoice/route.ts')));
check('the editor carries each loaded line\'s item Id back on save', /itemId: l\.itemId \|\| undefined/.test(read('components/billing/ExpandedBillingRow.tsx')) && /itemId: l\.itemId, description/.test(read('components/billing/ExpandedBillingRow.tsx')) && /itemId: String\(itemRef\.value/.test(read('lib/quickbooks-invoice-lines.ts')));
check('screen and server use the same renewal rule', /needsRenewalPeriodCheck\(line\)/.test(read('components/billing/ExpandedBillingRow.tsx')) && /lines\.filter\(needsRenewalPeriodCheck\)/.test(read('app/api/quickbooks/create-invoice/route.ts')));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
