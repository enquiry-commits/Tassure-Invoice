// lib/quotation-trace.ts — the pure Estimate → invoice join behind Billing
// System › Quotation. Every fixture below is a shape found in Tassure's real
// data on 2026-09-24 (see docs/INVARIANTS.md INV-QB-024), so a future change
// to the join cannot quietly break the scenarios that motivated it.
//
// Run: npx tsx test-quotation-trace.ts
import { traceQuotations, TRACE_GRACE_DAYS, type TraceInvoiceInput } from './lib/quotation-trace';
import type { EstimateRecord } from './lib/quickbooks-estimates';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name);
  if (!cond) fail++;
};

const est = (over: Partial<EstimateRecord>): EstimateRecord => ({
  book: 'TAB', qbEstimateId: 'E1', docNumber: 'PI260001', txnDate: '2026-06-22', expirationDate: null,
  customerName: 'Bestar International Holding Pte. Ltd.', totalAmt: 1450, currency: 'SGD', txnStatus: 'Closed',
  linkedInvoiceIds: [], locationName: null, privateNote: null, lines: [],
  // 2026-07-30 02:10 US-Pacific = 2026-07-30 17:10 SGT
  qbUpdatedAt: '2026-07-30T02:10:37-07:00',
  ...over,
});
const inv = (over: Partial<TraceInvoiceInput>): TraceInvoiceInput => ({
  book: 'TAB', qbInvoiceId: 'I1', invoiceNo: '02610001', txnDate: '2026-07-24',
  customerName: 'BESTAR INTERNATIONAL HOLDING PTE. LTD.', totalAmt: 1450, balance: 0, status: 'Paid',
  ...over,
});
const run = (estimates: EstimateRecord[], invoices: TraceInvoiceInput[]) =>
  traceQuotations(estimates, invoices, { today: '2026-09-24' });

console.log('--- PI260067 (real): Closed in TAO, QuickBooks LinkedTxn -> TAO invoice 02660590, same $1,450 ---');
{
  const [row] = run(
    [est({ book: 'TAO', qbEstimateId: '9112', docNumber: 'PI260067', linkedInvoiceIds: ['10134'] })],
    [
      inv({ book: 'TAO', qbInvoiceId: '10134', invoiceNo: '02660590', customerName: 'Bestar International Holding Pte. Ltd.' }),
      // The 4 real, later, UNRELATED Bestar invoices that follow in Aug 2026.
      inv({ book: 'TAO', qbInvoiceId: '10515', invoiceNo: '02660637', txnDate: '2026-08-14', totalAmt: 750 }),
      inv({ book: 'TAO', qbInvoiceId: '10516', invoiceNo: '02660638', txnDate: '2026-08-17', totalAmt: 200 }),
      inv({ book: 'TAB', qbInvoiceId: '24409', invoiceNo: '02610944', txnDate: '2026-08-18', totalAmt: 1920 }),
      inv({ book: 'TAC', qbInvoiceId: '4152', invoiceNo: '02680264', txnDate: '2026-08-18', totalAmt: 3000 }),
    ],
  );
  check('status is linked', row.trace.status === 'linked');
  check('exactly one invoice traced — the confirmed TAO one', row.trace.invoices.length === 1 && row.trace.invoices[0].invoiceNo === '02660590');
  check('it is a quickbooks_link, not a name match', row.trace.invoices[0].via === 'quickbooks_link');
  check('amount matches the quotation total', row.trace.invoices[0].amountMatches === true);
  check('sources = [TAO]', row.trace.sources.join(',') === 'TAO');
  check('the upper bound keeps the 4 later, unrelated August invoices OUT', !row.trace.invoices.some(i => i.via === 'name_match'));
  check('closedOn is the SGT date of the QuickBooks timestamp', row.closedOn === '2026-07-30');
  check('name-match window = quotation date .. closedOn + grace', row.trace.nameMatchWindow?.from === '2026-06-22' && row.trace.nameMatchWindow?.to === '2026-08-06' && TRACE_GRACE_DAYS === 7);
}

console.log('\n--- Real PI260088: TAB quotation $8,050 = linked TAB $2,000 + name-matched TAC $6,050 (a split across books) ---');
{
  const [row] = run(
    [est({ qbEstimateId: 'E88', docNumber: 'PI260088', customerName: 'Pearl Works Pte. Ltd.', txnDate: '2026-09-17', totalAmt: 8050, linkedInvoiceIds: ['5001'], qbUpdatedAt: '2026-09-21T00:00:00-07:00' })],
    [
      inv({ book: 'TAB', qbInvoiceId: '5001', invoiceNo: '02611060', customerName: 'PEARL WORKS PTE. LTD.', txnDate: '2026-09-18', totalAmt: 2000 }),
      inv({ book: 'TAC', qbInvoiceId: '6001', invoiceNo: '02680304', customerName: 'PEARL WORKS PTE. LTD.', txnDate: '2026-09-18', totalAmt: 6050 }),
    ],
  );
  check('status linked (has a QuickBooks link)', row.trace.status === 'linked');
  check('two invoices traced, confirmed one first', row.trace.invoices.length === 2 && row.trace.invoices[0].via === 'quickbooks_link' && row.trace.invoices[1].via === 'name_match');
  check('cross-book name match found the TAC invoice despite different name casing', row.trace.invoices[1].source === 'TAC');
  check('sources = [TAB, TAC] in book order', row.trace.sources.join(',') === 'TAB,TAC');
  check('traced total is 8050 and the split sums to the quotation exactly', row.trace.tracedTotal === 8050 && row.trace.sumMatchesTotal === true);
  check('neither invoice individually equals the total', row.trace.invoices.every(i => i.amountMatches === false));
}

console.log('\n--- No QuickBooks link at all (quotation in TAB, invoices only in other books) — the owner\'s cross-book case ---');
{
  const [row] = run(
    [est({ qbEstimateId: 'E2', customerName: 'Baolaipo Electronics Pte. Ltd.', txnDate: '2026-06-02', totalAmt: 4120, qbUpdatedAt: '2026-06-11T09:00:00-07:00' })],
    [
      inv({ book: 'TAB', qbInvoiceId: 'a', invoiceNo: '02610673', customerName: 'Baolaipo Electronics Pte. Ltd.', txnDate: '2026-06-11', totalAmt: 1120 }),
      inv({ book: 'TAC', qbInvoiceId: 'b', invoiceNo: '02680185', customerName: 'Baolaipo Electronics Pte. Ltd.', txnDate: '2026-06-11', totalAmt: 3000 }),
    ],
  );
  check('status name_match', row.trace.status === 'name_match');
  check('both books found, sum matches', row.trace.sources.join(',') === 'TAB,TAC' && row.trace.sumMatchesTotal === true);
}

console.log('\n--- Names that do NOT normalize equal never match (owner chose exact only) ---');
{
  const [row] = run(
    [est({ customerName: 'Baolaipo Electrics Pte. Ltd.', txnDate: '2026-06-02', qbUpdatedAt: '2026-06-11T09:00:00-07:00' })],
    [inv({ customerName: 'Baolaipo Electronics Pte. Ltd.', txnDate: '2026-06-11' })],
  );
  check('a typo\'d quotation name traces to nothing -> none (not an error)', row.trace.status === 'none' && row.trace.invoices.length === 0);
}

console.log('\n--- Window boundaries and exclusions ---');
{
  const base = { customerName: 'Acme Pte. Ltd.', txnDate: '2026-06-10', qbUpdatedAt: '2026-06-20T12:00:00-07:00' } as const; // closed 2026-06-21 SGT -> window ends 2026-06-28
  const invs = [
    inv({ qbInvoiceId: 'before', customerName: 'ACME PTE LTD', txnDate: '2026-06-09' }),
    inv({ qbInvoiceId: 'first', customerName: 'ACME PTE LTD', txnDate: '2026-06-10' }),
    inv({ qbInvoiceId: 'last', customerName: 'ACME PTE LTD', txnDate: '2026-06-28' }),
    inv({ qbInvoiceId: 'after', customerName: 'ACME PTE LTD', txnDate: '2026-06-29' }),
    inv({ qbInvoiceId: 'void', customerName: 'ACME PTE LTD', txnDate: '2026-06-15', status: 'Voided' }),
    inv({ qbInvoiceId: 'other', customerName: 'Somebody Else Pte. Ltd.', txnDate: '2026-06-15' }),
  ];
  const [row] = run([est(base)], invs);
  const ids = row.trace.invoices.map(i => i.qbInvoiceId).sort().join(',');
  check('window is inclusive at both ends; before/after/voided/other-customer excluded', ids === 'first,last');
}

console.log('\n--- An invoice QuickBooks linked to one estimate is never a name-match candidate for another ---');
{
  const rows = run(
    [
      est({ qbEstimateId: 'A', docNumber: 'PI1', customerName: 'Twin Pte. Ltd.', txnDate: '2026-06-01', linkedInvoiceIds: ['X'], qbUpdatedAt: '2026-06-10T00:00:00-07:00' }),
      est({ qbEstimateId: 'B', docNumber: 'PI2', customerName: 'Twin Pte. Ltd.', txnDate: '2026-06-02', qbUpdatedAt: '2026-06-10T00:00:00-07:00' }),
    ],
    [inv({ qbInvoiceId: 'X', customerName: 'TWIN PTE LTD', txnDate: '2026-06-05' })],
  );
  const b = rows.find(r => r.qbEstimateId === 'B')!;
  check('estimate B does not pick up the invoice QuickBooks linked to A', b.trace.invoices.length === 0 && b.trace.status === 'none');
  check('estimate A keeps it as confirmed', rows.find(r => r.qbEstimateId === 'A')!.trace.invoices[0].via === 'quickbooks_link');
}

console.log('\n--- Not Closed: no name matching, but a QuickBooks link is still shown ---');
{
  const pending = est({ txnStatus: 'Pending', customerName: 'Wait Pte. Ltd.', txnDate: '2026-06-01' });
  const [r1] = run([pending], [inv({ customerName: 'WAIT PTE LTD', txnDate: '2026-06-05' })]);
  check('Pending with no link: not_applicable, nothing traced', r1.trace.status === 'not_applicable' && r1.trace.invoices.length === 0 && r1.trace.nameMatchWindow === null);
  check('Pending row has daysOpen; Closed row does not', r1.daysOpen === 115 && run([est({})], [])[0].daysOpen === null);
  const [r2] = run([{ ...pending, linkedInvoiceIds: ['I1'] }], [inv({ qbInvoiceId: 'I1', customerName: 'Wait Pte. Ltd.' })]);
  check('Pending but QuickBooks-linked (partly converted): shown as linked', r2.trace.status === 'linked' && r2.trace.invoices.length === 1);
}

console.log('\n--- Closed, nothing found ---');
{
  const [row] = run([est({ customerName: 'Ghost Pte. Ltd.' })], []);
  check('closed with no invoice anywhere -> none', row.trace.status === 'none' && row.trace.sources.length === 0);
}

console.log('\n--- QuickBooks link to an invoice that is not in our synced data ---');
{
  const [row] = run([est({ book: 'TAO', linkedInvoiceIds: ['999'] })], []);
  check('still linked (QuickBooks itself says so), id kept as unresolved, never dropped', row.trace.status === 'linked' && row.trace.unresolvedLinkedInvoiceIds.join(',') === '999');
  check('its book is known without the row: the link is same-book, so sources = [TAO]', row.trace.sources.join(',') === 'TAO');
}

console.log('\n--- Voided invoices ---');
{
  const [row] = run(
    [est({ linkedInvoiceIds: ['V'] })],
    [inv({ qbInvoiceId: 'V', status: 'Voided' })],
  );
  check('a QuickBooks-linked but Voided invoice is still shown (flagged), not silently dropped', row.trace.invoices.length === 1 && row.trace.invoices[0].status === 'Voided');
  check('but it does not count towards sources or the traced total', row.trace.sources.length === 0 && row.trace.tracedTotal === 0);
}

console.log('\n--- Currency: the invoices table has no currency column ---');
{
  const [row] = run([est({ currency: 'USD', totalAmt: 2615, linkedInvoiceIds: ['U'] })], [inv({ qbInvoiceId: 'U', totalAmt: 2615 })]);
  check('non-SGD quotation: amountMatches is null (not comparable), never true', row.trace.invoices[0].amountMatches === null);
  check('and no split-sum claim is made either', row.trace.sumMatchesTotal === false);
}

console.log('\n--- Degenerate inputs ---');
{
  const [noDates] = run([est({ qbUpdatedAt: null })], [inv({})]);
  check('closed estimate with no closing timestamp: name matching skipped (no principled window), not guessed', noDates.trace.status === 'none' && noDates.trace.nameMatchWindow === null);
  const [blank] = run([est({ customerName: '' })], [inv({ customerName: '' })]);
  check('blank customer name never matches blank invoice names', blank.trace.invoices.length === 0);
  const sorted = run(
    [est({ qbEstimateId: 'old', docNumber: 'PI1', txnDate: '2026-01-01' }), est({ qbEstimateId: 'new', docNumber: 'PI2', txnDate: '2026-09-01' })],
    [],
  );
  check('rows come back newest first', sorted[0].qbEstimateId === 'new');
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
