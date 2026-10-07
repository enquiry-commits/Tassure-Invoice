// Run: npx tsx test-soa-group-email.ts
// The Group SOA email (lib/soa-group-email.ts) — layout of Chelsea's real Aquila email (Aug 2025).
import { buildGroupEmailBody, companySubtotal, formatInvoiceLine, formatShortMoney, groupTotal, joinNames, mergeGroupRecipients, type GroupCompany } from './lib/soa-group-email';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

// the real email's numbers
const aquila: GroupCompany[] = [
  { companyName: 'Aquila Education (Employee) Pte. Ltd.', lines: [
    { qbCompany: 'TAB', invoiceNo: '02410930', amount: 100 }, { qbCompany: 'TAB', invoiceNo: '02510927', amount: 1060 },
    { qbCompany: 'TAO', invoiceNo: '02460777', amount: 300 }, { qbCompany: 'TAO', invoiceNo: '02560531', amount: 400 } ] },
  { companyName: 'Aquila Education Pte. Ltd.', lines: [
    { qbCompany: 'TAB', invoiceNo: '02510131', amount: 1060 }, { qbCompany: 'TAB', invoiceNo: '02510953', amount: 800 }, { qbCompany: 'TAO', invoiceNo: '02560530', amount: 500 } ] },
  { companyName: 'Aquila Foundation Ltd.', lines: [
    { qbCompany: 'TAB', invoiceNo: '02410931', amount: 100 }, { qbCompany: 'TAB', invoiceNo: '02510132', amount: 1220 }, { qbCompany: 'TAB', invoiceNo: '02510877', amount: 300 } ] },
];

check('company subtotals match the real email (1,860 / 2,360 / 1,620)', companySubtotal(aquila[0]) === 1860 && companySubtotal(aquila[1]) === 2360 && companySubtotal(aquila[2]) === 1620);
check('the group total matches the real email (S$5,840)', groupTotal(aquila) === 5840 && formatShortMoney(groupTotal(aquila)) === 'S$5,840');
check('an invoice line reads like the real one: book + number, then the amount', formatInvoiceLine(aquila[0].lines[1]) === 'TAB02510927 - S$1,060');
check('names are joined like the real email (A, B, and C)', joinNames(aquila.map(c => c.companyName)) === 'Aquila Education (Employee) Pte. Ltd., Aquila Education Pte. Ltd., and Aquila Foundation Ltd.');
check('one or two names', joinNames(['A']) === 'A' && joinNames(['A', 'B']) === 'A and B' && joinNames([]) === '');

const body = buildGroupEmailBody(aquila);
check('opens "Dear All," then "Good day to you."', body.startsWith('Dear All,\n\nGood day to you.\n\n'));
check('states the total across the group', body.includes('the total overdue amount from Aquila Education (Employee) Pte. Ltd., Aquila Education Pte. Ltd., and Aquila Foundation Ltd. stands at S$5,840.'));
check('says the SOA and invoices are attached', body.includes('The Statement of Accounts (SOA) and Invoices are also attached for your reference.'));
check('numbered company sections with their subtotal', body.includes('1. Aquila Education (Employee) Pte. Ltd. (S$1,860)\nTAB02410930 - S$100\nTAB02510927 - S$1,060\nTAO02460777 - S$300\nTAO02560531 - S$400\n\n2. Aquila Education Pte. Ltd. (S$2,360)'));
check('closes with thanks and the contact line', body.endsWith('Thank you.\n\nPlease do not hesitate to contact me if you have any further questions.'));
check('the body never leaves an unfilled {{merge field}}', !/\{\{/.test(body));

check('cents only when there are some; a credit is negative', formatShortMoney(1060.5) === 'S$1,060.50' && formatShortMoney(100) === 'S$100' && formatShortMoney(-100) === '-S$100');
const withZero = buildGroupEmailBody([{ companyName: 'X', lines: [{ qbCompany: 'TAB', invoiceNo: '1', amount: 0 }, { qbCompany: 'TAC', invoiceNo: '2', amount: 50 }] }]);
check('a zero line is left out', !withZero.includes('TAB1 -') && withZero.includes('TAC2 - S$50'));
check('a company with no listed invoices still appears, pointing at the attached statement', buildGroupEmailBody([{ companyName: 'Y', total: 700, lines: [] }]).includes('1. Y (S$700)\n(statement attached)'));
check('an explicit company total wins over the sum of its lines', companySubtotal({ companyName: 'Z', total: 999, lines: [{ qbCompany: 'TAB', invoiceNo: '1', amount: 1 }] }) === 999);

const rec = mergeGroupRecipients([
  { toEmail: 'a@x.com\nb@x.com', ccEmail: 'cc@tassure.com\nfinance@tassure.com' },
  { toEmail: 'B@X.com; c@y.com', ccEmail: 'a@x.com\nfinance@tassure.com' },
  { toEmail: null, ccEmail: null },
]);
check('recipients are the union, de-duplicated (case-insensitive), one per line', rec.to === 'a@x.com\nb@x.com\nc@y.com', rec.to);
check('CC is the union and never repeats someone already in To', rec.cc === 'cc@tassure.com\nfinance@tassure.com', rec.cc);
check('no usable emails gives empty strings', mergeGroupRecipients([{ toEmail: 'nonsense', ccEmail: null }]).to === '');

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL OK');
