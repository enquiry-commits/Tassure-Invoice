import assert from 'node:assert/strict';
import {
  nextServicePeriod,
  parseInvoicePeriod,
  rollRecurringDescriptionForward,
  servicePeriodOverlapError,
} from '../lib/invoice-period.ts';

const periodCases = [
  ["Sec serv Aug'25-Jul'26, AR return", 'Secretary', '2025-08-01', '2026-07-31'],
  ['Sec,addrs services [Sep 2024 - Aug2025],AR31.12.2024', 'Secretary', '2024-09-01', '2025-08-31'],
  ['Nominee director for one year (Feb 2026 - Jan 2027）', 'ND', '2026-02-01', '2027-01-31'],
  ['Perform secretarial services [from July - Dec2026]', 'Secretary', '2026-07-01', '2026-12-31'],
  ['Sec serv & addr Apr\'26 - Mar\'27, XBRL & AR return', 'Address', '2026-04-01', '2027-03-31'],
  ['ND Aug 2025 - Jul 2026', 'ND', '2025-08-01', '2026-07-31'],
];

for (const [description, service, expectedStart, expectedEnd] of periodCases) {
  const parsed = parseInvoicePeriod(description, service);
  assert.equal(parsed?.period_start, expectedStart, description);
  assert.equal(parsed?.period_end, expectedEnd, description);
}

const mixed = "Sec serv Jan-Dec 2026, addr. Nov'25-Oct'26";
assert.deepEqual(parseInvoicePeriod(mixed, 'Secretary'), {
  period_start: '2026-01-01', period_end: '2026-12-31',
});
assert.deepEqual(parseInvoicePeriod(mixed, 'Address'), {
  period_start: '2025-11-01', period_end: '2026-10-31',
});

assert.deepEqual(parseInvoicePeriod('Sec [Apr 2026 - Mar 2027], AR [FYE 31.12.2026]', 'Secretary'), {
  period_start: '2026-04-01', period_end: '2027-03-31', fye_date: '2026-12-31',
});
assert.equal(parseInvoicePeriod('AR [FYE 31.11.2024]'), null);
assert.equal(parseInvoicePeriod('AR [FYE 01.09.0025]'), null);
assert.deepEqual(nextServicePeriod('2027-03-31'), {
  period_start: '2027-04-01', period_end: '2028-03-31',
});

assert.equal(
  rollRecurringDescriptionForward('Being professional services rendered for the year ended 31 March 2026 - Tax computation [YA 2027]'),
  'Being professional services rendered for the year ended 31 March 2027 - Tax computation [YA 2028]',
);
assert.equal(
  rollRecurringDescriptionForward("Sec serv Aug'25-Jul'26, AR FYE 31.12.2025"),
  "Sec serv Aug'26-Jul'27, AR FYE 31.12.2026",
);

assert.match(
  servicePeriodOverlapError('Secretary', parseInvoicePeriod('May 2026 - Apr 2027', 'Secretary'), '2027-04-30') ?? '',
  /overlaps/,
);
assert.equal(
  servicePeriodOverlapError('Secretary', parseInvoicePeriod('May 2027 - Apr 2028', 'Secretary'), '2027-04-30'),
  null,
);
assert.match(servicePeriodOverlapError('ND', null, null) ?? '', /complete service period/);

console.log(`Invoice period checks passed (${periodCases.length + 11} assertions).`);
