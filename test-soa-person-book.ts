// Run: npx tsx test-soa-person-book.ts
// The per-person sheets of the SOA full workbook (lib/soa-person-book.ts) follow the page's "My book" rule:
// everyone the PIC column lists is responsible (INV-PIC-011, no Main PIC), and the person's whole client card is kept.
import { ownsSoaRow, peopleWithBooks, personLabel, rowsInPersonBook, sheetNameForPerson } from './lib/soa-person-book';
import type { SoaCompanyRowWithSource } from './lib/soa-data';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

type Over = Partial<SoaCompanyRowWithSource> & { companyName: string; qbCompany: 'TAB' | 'TAC' | 'TAO' };
const row = (o: Over): SoaCompanyRowWithSource => ({
  companyId: null, pic: null, picOptions: [], soaPic: null, soaPicSource: null, classOwner: null, suggestedOwner: null,
  picShown: [], ndFollowsTab: false, tabPeople: [], invoiceCount: 1, totalOutstanding: 100,
  aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_plus: 0 }, lineItems: [], reminderProgress: undefined, remarks: null,
  ...o,
} as unknown as SoaCompanyRowWithSource);

const rows = [
  row({ companyName: 'CO-OPERATE ASSOCIATES PTE LTD', qbCompany: 'TAB', picShown: ['Ang Shi Ming'] }),
  row({ companyName: 'CO-OPERATE ASSOCIATES PTE LTD', qbCompany: 'TAO', picShown: ['Jay Tay', 'Clarence Saw'] }),
  row({ companyName: 'BETA PTE. LTD.', qbCompany: 'TAB', picShown: ['Tey Shemin'] }),
  row({ companyName: 'Gamma Pte Ltd', qbCompany: 'TAC', picShown: ['Jay Tay'] }),
  row({ companyName: 'GAMMA PTE LTD', qbCompany: 'TAB', soaPic: 'BD', soaPicSource: 'person', picShown: ['Tey Shemin'] }), // Bad Debt
  row({ companyName: 'DELTA PTE. LTD.', qbCompany: 'TAB', totalOutstanding: -50, picShown: ['Jay Tay'] }),                    // overpaid
  row({ companyName: 'EPSILON PTE. LTD.', qbCompany: 'TAC', ndFollowsTab: true, tabPeople: ['Tey Shemin'] }),                 // ND follows TAB
];

check('every person the PIC column lists owns the row — three people, three owners',
  ownsSoaRow(rows[1], 'Jay Tay') && ownsSoaRow(rows[1], 'Clarence Saw') && !ownsSoaRow(rows[1], 'Tey Shemin'));
check('a Bad Debt row belongs to BD only, not to the PIC column\'s people', ownsSoaRow(rows[4], 'BD') && !ownsSoaRow(rows[4], 'Tey Shemin'));
check('an ND-only TAC row belongs to the same company\'s TAB people', ownsSoaRow(rows[6], 'Tey Shemin'));

const clarence = rowsInPersonBook(rows, 'Clarence Saw');
check('Clarence (one of three) gets the company, with the OTHER source too (Co-operate TAB + TAO)', clarence.filter(r => r.companyName.startsWith('CO-OPERATE')).length === 2);
const ang = rowsInPersonBook(rows, 'Ang Shi Ming');
check('Ang Shi Ming (the other end) gets the same company', ang.filter(r => r.companyName.startsWith('CO-OPERATE')).length === 2);
check('...and neither gets a client they have nothing to do with (BETA)', !clarence.some(r => r.companyName === 'BETA PTE. LTD.') && !ang.some(r => r.companyName === 'BETA PTE. LTD.'));

const jay = rowsInPersonBook(rows, 'Jay Tay');
check('company names that differ only in case / punctuation are one client (GAMMA, both sources)', jay.filter(r => /gamma/i.test(r.companyName)).length === 2);
check('an overpaid (negative) row is kept in the book', jay.some(r => r.companyName === 'DELTA PTE. LTD.' && r.totalOutstanding < 0));
check('rows keep their original order', jay.map(r => r.companyName + r.qbCompany).join() === rows.filter(r => jay.includes(r)).map(r => r.companyName + r.qbCompany).join());

const people = peopleWithBooks(rows);
check('everyone responsible for something gets a sheet; BD ("Bad Debt") is last', people.join() === 'Ang Shi Ming,Clarence Saw,Jay Tay,Tey Shemin,BD', people);
check('BD reads as Bad Debt', personLabel('BD') === 'Bad Debt' && personLabel('Jay Tay') === 'Jay Tay');

const taken = new Set(['all', 'tab']);
const a = sheetNameForPerson('Jay: Tay/Lee?*[1]', taken), b = sheetNameForPerson('Jay: Tay/Lee?*[1]', taken);
check('sheet names are Excel-safe and unique', !/[\\/?*[\]:]/.test(a) && a !== b && a.length <= 31 && b.length <= 31, [a, b]);
check('a very long name is cut to 31 characters', sheetNameForPerson('X'.repeat(60), new Set()).length <= 31);

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL OK');
