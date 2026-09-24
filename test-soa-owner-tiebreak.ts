// lib/soa-owner.ts — computeSuggestedOwner() breaks a same-day tie by the
// LOWER (earlier-created) QuickBooks Id, explicitly, instead of by whatever
// order the database returned the rows in. The shapes below are the two real
// customers where the choice mattered on 2026-09-24 (of 411 TAB/TAO
// customers): both have a month-end batch of same-day invoices whose Class
// tags name different people. See docs/INVARIANTS.md INV-DATA-066.
//
// Run: npx tsx test-soa-owner-tiebreak.ts
import { computeSuggestedOwner, type OwnerInvoiceSignal } from './lib/soa-owner';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name);
  if (!cond) fail++;
};

const permutations = <T,>(xs: T[]): T[][] =>
  xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p]));

const sig = (qbInvoiceId: string, txnDate: string, locationName: string | null = null): OwnerInvoiceSignal => ({ qbInvoiceId, txnDate, locationName });

// MINYOTECH PTE. LTD. (TAB): 2026-06-30 has #02610788 (qb id 18267, Hoo Seng Xin)
// and #02610789 (qb id 18268, Tey Shemin); an older paid invoice is Hoo Seng Xin.
{
  const invoices = [sig('18268', '2026-06-30', 'Chelsea Ang'), sig('18267', '2026-06-30', 'Chelsea Ang'), sig('13142', '2026-05-11', 'Hoo Seng Xin')];
  const classes = new Map<string, string[]>([['18268', ['Tey Shemin', 'Tey Shemin']], ['18267', ['Hoo Seng Xin', 'Hoo Seng Xin']], ['13142', ['Hoo Seng Xin']]]);
  const answers = new Set(permutations(invoices).map(p => computeSuggestedOwner(p, classes, 'TAB')));
  check('MINYOTECH: same answer for every input order (was order-dependent)', answers.size === 1);
  check('MINYOTECH: the earlier-created invoice of the same-day batch decides -> Hoo Seng Xin', [...answers][0] === 'Hoo Seng Xin');
}

// HAN KUN LLP (TAO): the 2026-06-30 batch is qb ids 9683..9689. Only 9689 is
// Clarence Saw alone; 9683..9688 carry Lee Jing Fei on line 1. Human-confirmed
// PIC for this customer is Lee Jing Fei.
{
  const ids = ['9689', '9688', '9687', '9686', '9685', '9684', '9683'];
  const invoices = ids.map(id => sig(id, '2026-06-30', 'Lee Jing Fei'));
  const classes = new Map<string, string[]>(ids.map(id => [id, id === '9689' ? ['Clarence Saw'] : ['Lee Jing Fei', 'Clarence Saw']]));
  const reversed = [...invoices].reverse();
  check('HAN KUN: input order does not matter', computeSuggestedOwner(invoices, classes, 'TAO') === computeSuggestedOwner(reversed, classes, 'TAO'));
  check('HAN KUN: agrees with the human-confirmed PIC -> Lee Jing Fei', computeSuggestedOwner(invoices, classes, 'TAO') === 'Lee Jing Fei');
}

// The tie-break compares Ids NUMERICALLY (a plain string compare puts "18268" before "9689").
{
  const invoices = [sig('18268', '2026-06-30'), sig('9689', '2026-06-30')];
  const classes = new Map<string, string[]>([['18268', ['Tey Shemin']], ['9689', ['Hoo Seng Xin']]]);
  check('numeric Id compare: 9689 is earlier than 18268', computeSuggestedOwner(invoices, classes, 'TAB') === 'Hoo Seng Xin');
}

// The date stays the PRIMARY key: a later day always beats an earlier day, whatever the Ids say.
{
  const invoices = [sig('100', '2026-06-01'), sig('999', '2026-07-01')];
  const classes = new Map<string, string[]>([['100', ['Hoo Seng Xin']], ['999', ['Tey Shemin']]]);
  check('a more recent date still wins over a lower Id', computeSuggestedOwner(invoices, classes, 'TAB') === 'Tey Shemin');
}

// Non-numeric Ids (not expected from QuickBooks) still sort deterministically.
{
  const invoices = [sig('b', '2026-06-30'), sig('a', '2026-06-30'), sig('7', '2026-06-30')];
  const classes = new Map<string, string[]>([['a', ['Tey Shemin']], ['b', ['Hoo Seng Xin']], ['7', ['Chin Kah Ye']]]);
  const answers = new Set(permutations(invoices).map(p => computeSuggestedOwner(p, classes, 'TAB')));
  check('mixed / non-numeric Ids: deterministic for every input order', answers.size === 1);
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
