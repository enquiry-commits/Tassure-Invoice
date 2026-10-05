// lib/deferred-pairing.ts — accounting's "Deferred Revenue" twins folded into
// their service, each service shown once at its full amount (INV-QB-029).
// Fixtures are the real shapes measured on 2026's split invoices
// (2026-10-05): Novozee TAB #02610986, 1X EXCHANGE TAB #02611112, TAC ND
// twins, twins with no service line (TAB ids 10500/10442/10443), a twin under
// an unrelated line, a twin with its own description.
//
// Run: npx tsx test-deferred-pairing.ts
import { pairDeferredLines, mergeDeferredForDisplay, expandMergedAmount, isDeferredItem, type PairableLine } from './lib/deferred-pairing';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};
const L = (productService: string, rate: number, description = '', qty = 1): PairableLine => ({ productService, description, qty, rate });
const SEC = 'Secretary:Corporate Secretarial Services';
const ADDR = 'Secretary:Registered Address Services';
const D_SEC = 'Deferred Revenue - Corp Sec';
const D_ADDR = 'Deferred Revenue - Reg Addr';
const amounts = (lines: PairableLine[]) => {
  const r = mergeDeferredForDisplay(lines);
  return r.ok ? r.lines.map(x => x.amount) : null;
};
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

console.log('--- real invoices fold into one line per service ---');
const novozee = [
  L(SEC, 350, 'Perform secretarial services for one-year [from Jul 2026 - Jun 2027]'),
  L(D_SEC, 350),
  L(ADDR, 180, 'Registered and mailing address services for one year (Jul 2026 - Jun 2027)'),
  L(D_ADDR, 180),
  L('Disbursement:Government fee for filing Annual Return', 60, '- Government fee for ACRA filing of Annual Return [FYE 30.06.2026]'),
  L('Secretary:Payroll Package Services', 300, 'Payroll services for one year (Jul 2026 - Jun 2027)'),
  L('Deferred Revenue - Payroll', 300),
];
check('Novozee: 350+350 / 180+180 / 60 / 300+300 → 700 / 360 / 60 / 600', JSON.stringify(amounts(novozee)) === JSON.stringify([700, 360, 60, 600]), JSON.stringify(amounts(novozee)));
check('Novozee: still 1,720 in total', sum(amounts(novozee) ?? []) === 1720);
const merged = mergeDeferredForDisplay(novozee);
check('Novozee: the merged line keeps the service line\'s own description', merged.ok && merged.lines[0].line.description.startsWith('Perform secretarial services'));
check('Novozee: no line left that names a deferred item', merged.ok && merged.lines.every(x => !isDeferredItem(x.line.productService)));
check('1X EXCHANGE #02611112: Secretary 175 + Deferred 525 → Secretary 700', JSON.stringify(amounts([L(SEC, 175, 'Perform secretarial services…'), L(D_SEC, 525)])) === '[700]');
check('TAC ND: "Nominee Director Fees - WYD" 1,250 + "Deferred Revenue - ND - WYD" 1,750 → 3,000', JSON.stringify(amounts([L('Secretary:Nominee Director Fees - WYD', 1250, 'Nominee director fee (Aug 2025 - Jul 2026)'), L('Deferred Revenue - ND - WYD', 1750)])) === '[3000]');
check('ND variant "Deferred - ND Fees - CD" pairs with "Nominee Director Fees - CD"', JSON.stringify(amounts([L('Secretary:Nominee Director Fees - CD', 900, 'ND'), L('Secretary:Deferred - ND Fees - CD', 600)])) === '[1500]');
check('ND item with a trailing dot ("- LXM.") still pairs', JSON.stringify(amounts([L('Secretary:Nominee Director Fees - LXM.', 500, 'ND'), L('Deferred - ND Fees - LXM', 500)])) === '[1000]');
check('CPF twin pairs with CPF Submission', JSON.stringify(amounts([L('Secretary:CPF Submission Services', 120, 'CPF'), L('Secretary:Deferred Revenue - CPF', 120)])) === '[240]');
check('an invoice with no deferred line is shown unchanged', JSON.stringify(amounts([L(SEC, 700, 'x'), L(ADDR, 360, 'y')])) === '[700,360]');

console.log('\n--- pairing is by item name, never by position ---');
const underUnrelated = pairDeferredLines([L(SEC, 350, 'sec'), L(ADDR, 180, 'addr'), L(D_SEC, 350)]);
check('a Corp Sec twin sitting under the ADDRESS line still joins Corporate Secretarial', underUnrelated.ok && JSON.stringify(underUnrelated.groups) === JSON.stringify([{ primary: 0, deferred: [2] }]));
const twinFirst = pairDeferredLines([L(D_SEC, 350), L(SEC, 350, 'sec')]);
check('a twin that is the invoice\'s FIRST line joins its service below it', twinFirst.ok && JSON.stringify(twinFirst.groups) === JSON.stringify([{ primary: 1, deferred: [0] }]));
const twoSec = pairDeferredLines([L(SEC, 100, 'a'), L(D_SEC, 100), L(SEC, 200, 'b'), L(D_SEC, 200)]);
check('two Corporate Secretarial lines: each twin joins the nearest one above it', twoSec.ok && JSON.stringify(twoSec.groups) === JSON.stringify([{ primary: 0, deferred: [1] }, { primary: 2, deferred: [3] }]));

console.log('\n--- unclear → not merged, with a reason (callers show QuickBooks as it is) ---');
const onlyTwins = pairDeferredLines([L(D_SEC, 350), L(D_ADDR, 180)]);
check('twins with no service line at all (TAB 10500 shape) → not ok', !onlyTwins.ok && onlyTwins.reasons.length === 2);
const wrongInitials = pairDeferredLines([L('Secretary:Nominee Director Fees - WYD', 1250, 'ND'), L('Deferred - ND Fees - LJW', 1750)]);
check('ND twin for a different director → not ok', !wrongInitials.ok);
const described = pairDeferredLines([L('Secretary:Nominee Director Fees - NKH', 2250, 'Nominee director service one year [Apr 2026 - Dec 2026]'), L('Deferred - ND Fees - NKH', 750, 'Nominee director service one year [Jan 2027 - Mar 2027]')]);
check('a twin describing a DIFFERENT period (Anmed TAC #02680138) → not ok', !described.ok);
const repeated = amounts([L(SEC, 1100, 'Perform secretarial services for one-year [from Feb 2026 - Jan 2027]\n- Safe custody of statutory records'), L(D_SEC, 100, 'Perform secretarial services for one-year [from Feb 2026 - Jan 2027]')]);
check('a twin repeating part of its service\'s own text (Mandi Capital TAB #02610362) → merges, 1,200', JSON.stringify(repeated) === '[1200]', JSON.stringify(repeated));
const unknown = pairDeferredLines([L(SEC, 350, 'sec'), L('Deferred Revenue - Something New', 50)]);
check('a deferred item this system does not know → not ok', !unknown.ok);
const qty2 = pairDeferredLines([L(SEC, 175, 'sec', 2), L(D_SEC, 350)]);
check('quantity other than 1 → not ok (never re-shapes qty × rate)', !qty2.ok);

console.log('\n--- saving puts QuickBooks\' real lines back ---');
const primary = { ...L(SEC, 175, 'Perform secretarial services…'), picClassId: '12' };
const twin = { ...L(D_SEC, 525), picClassId: '12' };
const same = expandMergedAmount(primary, [twin], 700);
check('amount unchanged → the service line and its twin exactly as they were', same.ok && same.primary === primary && same.deferred[0] === twin);
const up = expandMergedAmount(primary, [twin], 800);
check('700 → 800: the difference goes on the service line (175 → 275), the twin is untouched', up.ok && up.primary.rate === 275 && up.primary.qty === 1 && up.deferred[0] === twin && up.primary.picClassId === '12');
const down = expandMergedAmount(primary, [twin], 600.5);
check('700 → 600.50: service line 75.50, twin untouched', down.ok && down.primary.rate === 75.5);
const tooLow = expandMergedAmount(primary, [twin], 400);
check('700 → 400 is refused (the service line would go negative) with a reason', !tooLow.ok && /Chelsea/.test(tooLow.error));
const zero = expandMergedAmount(primary, [twin], 525);
check('700 → 525 is refused too (service line would be 0)', !zero.ok);

console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
process.exit(fail === 0 ? 0 : 1);
