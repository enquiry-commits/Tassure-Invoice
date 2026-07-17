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

console.log('Renewal fee pairing checks passed (24 assertions).');
