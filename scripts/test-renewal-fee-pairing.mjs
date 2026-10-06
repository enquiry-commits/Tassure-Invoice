import assert from 'node:assert/strict';
import {
  buildAnnualRenewalFeeMap,
  classifyRenewalFeeProduct,
  compareRenewalPeriodProductLines,
} from '../lib/invoice-period.ts';

const key = 'sample company';
const annualLines = [
  ['Deferred Revenue - Corp Sec', 150],
  ['Deferred Revenue - Reg Addr', 50],
  ['Secretary:Corporate Secretarial Services', 450],
  ['Secretary:Registered Address Services', 150],
].map(([product_service, amount]) => ({
  customer_key: key,
  invoice_no: '02510976',
  txn_date: '2025-08-13',
  product_service,
  description: 'Sec,addrs [Apr 2025 - Mar 2026],AR 31.05.2025',
  amount,
}));

const screenshotResult = buildAnnualRenewalFeeMap(annualLines).get(key);
assert.deepEqual(screenshotResult?.get('Secretary'), {
  invoice_no: '02510976',
  txn_date: '2025-08-13',
  fee: 600,
  product_service: 'Secretary:Corporate Secretarial Services',
});
assert.deepEqual(screenshotResult?.get('Address'), {
  invoice_no: '02510976',
  txn_date: '2025-08-13',
  fee: 200,
  product_service: 'Secretary:Registered Address Services',
});

// A later one-off job reused the Secretary item but has no annual period and
// no matching Deferred line. It must not replace the annual S$600 fee.
const withOneOff = buildAnnualRenewalFeeMap([
  ...annualLines,
  {
    customer_key: key,
    qb_company: 'TAB',
    invoice_no: '02511081',
    txn_date: '2025-09-08',
    product_service: 'Secretary:Corporate Secretarial Services',
    description: 'Share Allotment, bizfile',
    amount: 200,
  },
  {
    customer_key: key,
    qb_company: 'TAB',
    invoice_no: '02511081',
    txn_date: '2025-09-08',
    product_service: 'Secretary:ACRA Fees',
    description: 'Share Allotment, bizfile',
    amount: 5.5,
  },
]).get(key);
assert.equal(withOneOff?.get('Secretary')?.invoice_no, '02510976');
assert.equal(withOneOff?.get('Secretary')?.fee, 600);

// System-generated invoices intentionally collapse each pair to the visible
// primary item. A readable one-year period makes that primary-only line valid.
const withGeneratedRenewal = buildAnnualRenewalFeeMap([
  ...annualLines,
  {
    customer_key: key,
    invoice_no: '02610859',
    txn_date: '2026-07-17',
    product_service: 'Secretary:Corporate Secretarial Services',
    description: 'Perform secretarial services [from Apr 2026 - Mar 2027]',
    amount: 600,
  },
  {
    customer_key: key,
    invoice_no: '02610859',
    txn_date: '2026-07-17',
    product_service: 'Secretary:Registered Address Services',
    description: 'Registered address services (Apr 2026 - Mar 2027)',
    amount: 200,
  },
]).get(key);
assert.equal(withGeneratedRenewal?.get('Secretary')?.fee, 600);
assert.equal(withGeneratedRenewal?.get('Secretary')?.invoice_no, '02610859');
assert.equal(withGeneratedRenewal?.get('Address')?.fee, 200);
assert.equal(withGeneratedRenewal?.get('Address')?.invoice_no, '02610859');

// Older annual invoices sometimes use a generic "Sale" description. The
// normal S$60 ACRA annual-return line proves that the invoice is an annual
// renewal, while the S$5.50 one-off ACRA line above does not.
const genericAnnual = buildAnnualRenewalFeeMap([
  ...annualLines,
  {
    customer_key: key, qb_company: 'TAB', invoice_no: '02610032', txn_date: '2026-01-06',
    product_service: 'Secretary:Corporate Secretarial Services',
    description: 'Sale; Sample Company', amount: 800,
  },
  {
    customer_key: key, qb_company: 'TAB', invoice_no: '02610032', txn_date: '2026-01-06',
    product_service: 'Secretary:Registered Address Services',
    description: 'Sale; Sample Company', amount: 300,
  },
  {
    customer_key: key, qb_company: 'TAB', invoice_no: '02610032', txn_date: '2026-01-06',
    product_service: 'Secretary:ACRA Fees',
    description: 'Sale; Sample Company', amount: 60,
  },
]).get(key);
assert.equal(genericAnnual?.get('Secretary')?.invoice_no, '02610032');
assert.equal(genericAnnual?.get('Secretary')?.fee, 800);
assert.equal(genericAnnual?.get('Address')?.invoice_no, '02610032');
assert.equal(genericAnnual?.get('Address')?.fee, 300);

const generatedWithoutPeriod = buildAnnualRenewalFeeMap([
  ...annualLines,
  {
    customer_key: key, qb_company: 'TAB', invoice_no: '02610999', txn_date: '2026-07-18',
    product_service: 'Secretary:Corporate Secretarial Services',
    description: 'Approved annual secretarial services', amount: 650,
    generated_invoice: true,
  },
]).get(key)?.get('Secretary');
assert.equal(generatedWithoutPeriod?.invoice_no, '02610999');
assert.equal(generatedWithoutPeriod?.fee, 650);

const recurringGenericAnnual = buildAnnualRenewalFeeMap([
  ...annualLines,
  {
    customer_key: key, qb_company: 'TAB', invoice_no: '02610888', txn_date: '2026-08-13',
    product_service: 'Secretary:Corporate Secretarial Services',
    description: 'Sale; Sample Company', amount: 600,
  },
  {
    customer_key: key, qb_company: 'TAB', invoice_no: '02610888', txn_date: '2026-08-13',
    product_service: 'Secretary:Registered Address Services',
    description: 'Sale; Sample Company', amount: 200,
  },
]).get(key);
assert.equal(recurringGenericAnnual?.get('Secretary')?.invoice_no, '02610888');
assert.equal(recurringGenericAnnual?.get('Secretary')?.fee, 600);
assert.equal(recurringGenericAnnual?.get('Address')?.invoice_no, '02610888');
assert.equal(recurringGenericAnnual?.get('Address')?.fee, 200);

const nd = buildAnnualRenewalFeeMap([
  {
    customer_key: key, invoice_no: 'TAC1', txn_date: '2026-01-01',
    product_service: 'Secretary:Nominee Director Fees - WYD',
    description: 'Nominee Director for one year [Jul 2026 - Jun 2027]', amount: 1500,
  },
  {
    customer_key: key, invoice_no: 'TAC1', txn_date: '2026-01-01',
    product_service: 'Deferred - ND Fees - WYD',
    description: 'Nominee Director for one year [Jul 2026 - Jun 2027]', amount: 1500,
  },
]).get(key)?.get('ND');
assert.equal(nd?.fee, 3000);
assert.equal(nd?.product_service, 'Secretary:Nominee Director Fees - WYD');

assert.deepEqual(classifyRenewalFeeProduct('Secretary:Coporate Secretarial Services'), {
  service: 'Secretary', role: 'primary',
});
assert.deepEqual(classifyRenewalFeeProduct('Deferred Revenue - Reg Addr'), {
  service: 'Address', role: 'deferred',
});

const secretaryDisplay = [
  { period_end: '2026-03-31', product_service: 'Deferred Revenue - Corp Sec' },
  { period_end: '2026-03-31', product_service: 'Secretary:Corporate Secretarial Services' },
].sort((a, b) => compareRenewalPeriodProductLines('Secretary', a, b));
assert.equal(secretaryDisplay[0].product_service, 'Secretary:Corporate Secretarial Services');

const addressDisplay = [
  { period_end: '2026-03-31', product_service: 'Deferred Revenue - Reg Addr' },
  { period_end: '2026-03-31', product_service: 'Secretary:Registered Address Services' },
].sort((a, b) => compareRenewalPeriodProductLines('Address', a, b));
assert.equal(addressDisplay[0].product_service, 'Secretary:Registered Address Services');

// INV-QB-019 (rewritten 2026-10-06): the result must not depend on the order
// the rows arrive in. Each case is sorted from EVERY input order and must
// always produce the same first line.
const permutations = items => items.length <= 1 ? [items]
  : items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [x, ...rest]));
const winners = (service, lines) => new Set(permutations(lines).map(order => {
  const first = [...order].sort((a, b) => compareRenewalPeriodProductLines(service, a, b))[0];
  return `${first.invoice_no}|${first.period_end}|${first.product_service}`;
}));

// Elite Gathering (real lines): #02611051 also carries a director's
// residential-address disbursement tagged Address with a LATER period.
const eliteWinners = winners('Address', [
  { invoice_no: '02611051', txn_date: '2026-09-14', period_end: '2027-06-30', product_service: 'Secretary:Registered Address Services' },
  { invoice_no: '02611051', txn_date: '2026-09-14', period_end: '2027-08-31', product_service: 'Disbursement:Reimbursement - OPE' },
  { invoice_no: '02511129', txn_date: '2025-09-26', period_end: '2026-06-30', product_service: 'Secretary:Registered Address Services' },
  { invoice_no: '2580205', txn_date: '2025-09-26', period_end: '2026-02-28', product_service: 'Secretary:Registered Address Services' },
  { invoice_no: '02410779', txn_date: '2024-07-29', period_end: '2025-06-30', product_service: 'Secretary:Company Incorporate Services' },
]);
assert.deepEqual([...eliteWinners], ['02611051|2027-06-30|Secretary:Registered Address Services']);

// Siehi-shaped ND split (REG-019): one invoice bills Aug-Dec as the primary
// and Jan-Jul as the deferred line; older plain years must not win.
const splitWinners = winners('ND', [
  { invoice_no: 'S2', txn_date: '2025-08-05', period_end: '2025-12-31', product_service: 'Secretary:Nominee Director Fees - WKX' },
  { invoice_no: 'S2', txn_date: '2025-08-05', period_end: '2026-07-31', product_service: 'Deferred - ND Fees - WKX' },
  { invoice_no: 'S1', txn_date: '2024-08-05', period_end: '2025-07-31', product_service: 'Secretary:Nominee Director Fees - WKX' },
  { invoice_no: 'S0', txn_date: '2023-08-05', period_end: '2024-07-31', product_service: 'Secretary:Nominee Director Fees - WKX' },
]);
assert.deepEqual([...splitWinners], ['S2|2026-07-31|Deferred - ND Fees - WKX']);

// An ad-hoc line sharing the service bucket (CPF submission) never decides
// how far the secretary renewal is paid, even with a later period and date.
const cpfWinners = winners('Secretary', [
  { invoice_no: 'C1', txn_date: '2026-01-10', period_end: '2026-12-31', product_service: 'Secretary:Corporate Secretarial Services' },
  { invoice_no: 'C2', txn_date: '2026-03-02', period_end: '2027-03-31', product_service: 'Secretary:CPF Submission Services' },
  { invoice_no: 'C0', txn_date: '2025-01-10', period_end: '2025-12-31', product_service: 'Secretary:Corporate Secretarial Services' },
]);
assert.deepEqual([...cpfWinners], ['C1|2026-12-31|Secretary:Corporate Secretarial Services']);

// Both the Billing Drafts status and create-invoice's overlap check must use
// this one function (with txn_date), or the screen and the server disagree.
import { readFileSync } from 'node:fs';
const routeSrc = readFileSync(new URL('../app/api/billing/renewals/route.ts', import.meta.url), 'utf8');
const createSrc = readFileSync(new URL('../app/api/quickbooks/create-invoice/route.ts', import.meta.url), 'utf8');
assert.match(routeSrc, /compareRenewalPeriodProductLines\(svc, a, b\)/);
assert.match(createSrc, /compareRenewalPeriodProductLines\(/);
assert.match(createSrc, /txn_date: a\.txn_date/);

console.log('Renewal fee pairing checks passed (30 assertions).');
