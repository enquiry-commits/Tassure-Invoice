// Run: npx tsx test-soa-person-book.ts
// The per-person sheets of the SOA full workbook (lib/soa-person-book.ts) follow the page's "My book" rule.
import { ownsSoaRow, peopleWithBooks, personLabel, rowsInPersonBook, sheetNameForPerson } from './lib/soa-person-book';
import type { SoaCompanyRowWithSource } from './lib/soa-data';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

type Over = Partial<SoaCompanyRowWithSource> & { companyName: string; qbCompany: 'TAB' | 'TAC' | 'TAO' };
// soaPic 'person' pick = Main PIC; picOptions = people QuickBooks/TeamWork name
const row = (o: Over): SoaCompanyRowWithSource => ({
  companyId: null, pic: null, picOptions: [], soaPic: null, soaPicSource: null, classOwner: null, suggestedOwner: null,
  picShown: [], ndFollowsTab: false, tabMainPic: null, invoiceCount: 1, totalOutstanding: 100,
  aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_plus: 0 }, lineItems: [], reminderProgress: undefined, remarks: null,
  ...o,
} as unknown as SoaCompanyRowWithSource);

const rows = [
  row({ companyName: 'ALPHA PTE. LTD.', qbCompany: 'TAB', soaPic: 'Jay Tay', soaPicSource: 'person' }),
  row({ companyName: 'ALPHA PTE. LTD.', qbCompany: 'TAO', soaPic: 'Tey Shemin', soaPicSource: 'person' }),
  row({ companyName: 'BETA PTE. LTD.', qbCompany: 'TAB', soaPic: 'Tey Shemin', soaPicSource: 'person' }),
  row({ companyName: 'Gamma Pte Ltd', qbCompany: 'TAC', picOptions: ['Jay Tay'] }),          // no Main PIC -> falls back to the options
  row({ companyName: 'GAMMA PTE LTD', qbCompany: 'TAB', soaPic: 'BD', soaPicSource: 'person' }), // status code
  row({ companyName: 'DELTA PTE. LTD.', qbCompany: 'TAB', totalOutstanding: -50, soaPic: 'Jay Tay', soaPicSource: 'person' }), // overpaid
];

check('a row belongs to its Main PIC', ownsSoaRow(rows[0], 'Jay Tay') && !ownsSoaRow(rows[0], 'Tey Shemin'));
check('with no Main PIC, a person named in the options owns it', ownsSoaRow(rows[3], 'Jay Tay'));
check('the options do NOT make someone an owner when a Main PIC exists', !ownsSoaRow(rows[0], 'Tey Shemin'));

const jay = rowsInPersonBook(rows, 'Jay Tay');
check('Jay Tay keeps the OTHER source of a client he owns one source of (ALPHA TAB + TAO)', jay.filter(r => r.companyName === 'ALPHA PTE. LTD.').length === 2);
check('...and not a client he has nothing to do with (BETA)', !jay.some(r => r.companyName === 'BETA PTE. LTD.'));
check('company names that differ only in case / punctuation are one client (GAMMA)', jay.filter(r => /gamma/i.test(r.companyName)).length === 2);
check('an overpaid (negative) row is kept in the book', jay.some(r => r.companyName === 'DELTA PTE. LTD.' && r.totalOutstanding < 0));
check('rows keep their original order', jay.map(r => r.companyName + r.qbCompany).join() === rows.filter(r => jay.includes(r)).map(r => r.companyName + r.qbCompany).join());

const people = peopleWithBooks(rows);
check('everyone who owns something gets a sheet; BD ("Bad Debt") is last', people.join() === 'Jay Tay,Tey Shemin,BD', people);
check('BD reads as Bad Debt', personLabel('BD') === 'Bad Debt' && personLabel('Jay Tay') === 'Jay Tay');

const taken = new Set(['all', 'tab']);
const a = sheetNameForPerson('Jay: Tay/Lee?*[1]', taken), b = sheetNameForPerson('Jay: Tay/Lee?*[1]', taken);
check('sheet names are Excel-safe and unique', !/[\\/?*[\]:]/.test(a) && a !== b && a.length <= 31 && b.length <= 31, [a, b]);
check('a very long name is cut to 31 characters', sheetNameForPerson('X'.repeat(60), new Set()).length <= 31);

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL OK');
