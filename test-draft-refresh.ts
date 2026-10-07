// The send-time refresh of a draft's invoice references (docs/INVARIANTS.md INV-MAIL-007). An SOA email quotes what is STILL OWED on
// each invoice (QuickBooks' `Balance`); AR and letter emails quote the whole invoice (`TotalAmt`). Reading TotalAmt for an SOA wrote
// a partly paid invoice at its full total into the body — Easybook Pay TAB #02510178: S$1,660 invoice, S$200 still owed — while the
// attached statement said 200 (26 open invoices on 2026-10-07). Vincent, 2026-10-07: "改成读未付余额".
//
// Run: npx tsx test-draft-refresh.ts
import fs from 'fs';
import path from 'path';
import { refreshInvoiceRef, amountsAreRefreshable } from './lib/draft-refresh';
import type { InvoiceRef } from './lib/email-merge';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (!cond && detail ? `\n       ${detail}` : ''));
  if (!cond) fail++;
};
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const ref = (amount: number, invoiceNo = '02510178'): InvoiceRef => ({ qbCompany: 'TAB', invoiceNo, amount, qbInvoiceId: '9001', dueDate: '2025-03-04' });

console.log('--- 1. an SOA email quotes what is still owed ---');
{
  const partlyPaid = refreshInvoiceRef(ref(200), { DocNumber: '02510178', TotalAmt: 1660, Balance: 200 }, 'soa');
  check('a partly paid invoice stays at what is still owed (Easybook Pay: 1,660 invoice, 200 owed → 200, never 1,660)', partlyPaid.amount === 200, `got ${partlyPaid.amount}`);
  check('an invoice nobody has paid on stays as it was', refreshInvoiceRef(ref(860), { DocNumber: '02510178', TotalAmt: 860, Balance: 860 }, 'soa').amount === 860);
  check('a further payment since the draft was made is picked up (460 → 300)', refreshInvoiceRef(ref(460), { DocNumber: '02510178', TotalAmt: 860, Balance: 300 }, 'soa').amount === 300);
  check('an invoice re-priced in QuickBooks after a part payment follows what is owed now (460 → 500)', refreshInvoiceRef(ref(460), { DocNumber: '02510178', TotalAmt: 900, Balance: 500 }, 'soa').amount === 500);
  const paid = refreshInvoiceRef(ref(200), { DocNumber: '02510178', TotalAmt: 1660, Balance: 0 }, 'soa');
  check('an invoice paid in full since the draft was made reads 0 (the reference stays: the caller pairs attachments by position)', paid.amount === 0 && paid.qbInvoiceId === '9001');
  // every live row is a PARTLY PAID invoice (TotalAmt well above Balance), so quoting TotalAmt would give 3,640 — not 690
  check('the total of a refreshed SOA body is the sum of what is owed', [ref(200), ref(460, '02511276'), ref(30, '02511182')]
    .map((r, i) => refreshInvoiceRef(r, [{ TotalAmt: 1660, Balance: 200 }, { TotalAmt: 860, Balance: 460 }, { TotalAmt: 1120, Balance: 30 }][i], 'soa')).reduce((s, r) => s + r.amount, 0) === 690);
  check('every invoice paid in full since: every line reads 0 and the total is 0 (the send screen then says "Amount corrected from S$690 to S$0")',
    [ref(200), ref(460, '02511276')].map(r => refreshInvoiceRef(r, { TotalAmt: 1660, Balance: 0 }, 'soa')).every(r => r.amount === 0));
}

console.log('\n--- 1b. an SOA with a line that cannot be re-read keeps its amounts ---');
{
  // The draft's refs: a 1,000 invoice and an unapplied credit note of -400 (no QuickBooks Id): the body says S$600. Accounting then applies the
  // credit to the invoice: QuickBooks' invoice Balance is 600 and the credit note is no longer open — the client STILL owes 600.
  const invoice = ref(1000);
  const credit: InvoiceRef = { qbCompany: 'TAB', invoiceNo: 'CN260014', amount: -400, qbInvoiceId: null };
  const journal: InvoiceRef = { qbCompany: 'TAB', invoiceNo: 'OPNG JE', amount: 50, qbInvoiceId: null };
  const live = { DocNumber: '02510178', TotalAmt: 1000, Balance: 600 };
  check('precondition: re-pricing only the invoice of that draft would say S$200 for a debt of S$600 (the credit counted twice)',
    refreshInvoiceRef(invoice, live, 'soa').amount + credit.amount === 200);
  check('an SOA with a credit note, a payment or a journal entry among its lines is not re-priced', !amountsAreRefreshable([invoice, credit], 'soa') && !amountsAreRefreshable([invoice, journal], 'soa'));
  const kept = refreshInvoiceRef(invoice, live, 'soa', amountsAreRefreshable([invoice, credit], 'soa'));
  check('… so its invoice stays at 1,000 and the body stays at S$600', kept.amount === 1000 && kept.amount + credit.amount === 600);
  check('… but a renumbered invoice is still renamed', refreshInvoiceRef(invoice, { ...live, DocNumber: '02611112' }, 'soa', false).invoiceNo === '02611112');
  check('an SOA made only of invoices (each with its QuickBooks Id) is re-priced', amountsAreRefreshable([ref(200), ref(460, '02511276')], 'soa'));
  check('AR and letter drafts are not sums of that kind: a line without a QuickBooks Id never switches the refresh off for them', amountsAreRefreshable([invoice, credit], 'ar') && amountsAreRefreshable([invoice, credit], 'letter'));
  check('an empty list is trivially refreshable (nothing to re-price)', amountsAreRefreshable([], 'soa'));
}

console.log('\n--- 2. AR and letter emails still quote the whole invoice ---');
{
  for (const type of ['ar', 'letter'] as const) {
    check(`${type}: the live TotalAmt is used, Balance is ignored (a partly paid renewal invoice is still the renewal invoice)`, refreshInvoiceRef(ref(1660), { DocNumber: '02510178', TotalAmt: 1700, Balance: 200 }, type).amount === 1700);
    check(`${type}: an unchanged invoice stays as it was`, refreshInvoiceRef(ref(1660), { DocNumber: '02510178', TotalAmt: 1660, Balance: 200 }, type).amount === 1660);
  }
}

console.log('\n--- 2b. an invoice in another currency is quoted in Singapore dollars ---');
{
  // FAITH CAPITAL GLOBAL FUND VCC, TAB #02610911..14: USD 507.55 each at 1.2861 = S$652.76 (the AR aging and the statement hold the S$ figure).
  const usd = (balance: number) => ({ DocNumber: '02610911', TotalAmt: 507.55, Balance: balance, ExchangeRate: 1.2861 });
  check('an unpaid USD invoice stays at its S$ figure (USD 507.55 x 1.2861 = S$652.76, not "S$507.55")', refreshInvoiceRef(ref(652.76, '02610911'), usd(507.55), 'soa').amount === 652.76);
  check('a part payment on it is converted too (USD 300 → S$385.83)', refreshInvoiceRef(ref(652.76, '02610911'), usd(300), 'soa').amount === 385.83);
  check('an AR / letter email converts the whole invoice the same way', refreshInvoiceRef(ref(652.76, '02610911'), usd(300), 'ar').amount === 652.76);
  check('an invoice in Singapore dollars (rate 1), or with no rate at all, is not touched by the conversion',
    refreshInvoiceRef(ref(200), { Balance: 200, ExchangeRate: 1 }, 'soa').amount === 200 && refreshInvoiceRef(ref(200), { Balance: 200 }, 'soa').amount === 200);
  check('a rate that is not a positive number is ignored, never a zero or a NaN amount', refreshInvoiceRef(ref(200), { Balance: 200, ExchangeRate: 0 }, 'soa').amount === 200
    && refreshInvoiceRef(ref(200), { Balance: 200, ExchangeRate: -1.2 }, 'soa').amount === 200 && refreshInvoiceRef(ref(200), { Balance: 200, ExchangeRate: '1.2' }, 'soa').amount === 200);
  check('amounts come out at two decimals (no float noise in a client email)', refreshInvoiceRef(ref(1), { Balance: 507.55, ExchangeRate: 1.2861 }, 'soa').amount.toString().split('.')[1]?.length <= 2);
}

console.log('\n--- 3. everything else is as before ---');
{
  for (const type of ['soa', 'ar', 'letter'] as const) {
    const renumbered = refreshInvoiceRef(ref(100, '02511111'), { DocNumber: ' 02611112 ', TotalAmt: 100, Balance: 100 }, type);
    check(`${type}: a renumbered invoice is quoted under its number in QuickBooks now (INV-QB-030)`, renumbered.invoiceNo === '02611112');
    check(`${type}: a blank DocNumber never wipes the number`, refreshInvoiceRef(ref(100, '02511111'), { DocNumber: '  ', TotalAmt: 100, Balance: 100 }, type).invoiceNo === '02511111');
    check(`${type}: nothing returned by QuickBooks → the reference is left exactly as it was (fails open)`, JSON.stringify(refreshInvoiceRef(ref(100), undefined, type)) === JSON.stringify(ref(100))
      && JSON.stringify(refreshInvoiceRef(ref(100), null, type)) === JSON.stringify(ref(100)) && JSON.stringify(refreshInvoiceRef(ref(100), {}, type)) === JSON.stringify(ref(100)));
    check(`${type}: the book, the QuickBooks Id and the due date survive (attachments are paired with references by position)`, (() => {
      const r = refreshInvoiceRef(ref(100), { DocNumber: 'X1', TotalAmt: 5, Balance: 5 }, type);
      return r.qbCompany === 'TAB' && r.qbInvoiceId === '9001' && r.dueDate === '2025-03-04';
    })());
  }
  check('a value that is not a number is not an amount ("1,660.00" or null never becomes the quoted amount)', refreshInvoiceRef(ref(200), { Balance: '1660' }, 'soa').amount === 200
    && refreshInvoiceRef(ref(200), { Balance: null }, 'soa').amount === 200 && refreshInvoiceRef(ref(200), { TotalAmt: '1660' }, 'ar').amount === 200);
  const input = ref(200); const copy = JSON.stringify(input);
  refreshInvoiceRef(input, { DocNumber: 'Z', TotalAmt: 1, Balance: 1 }, 'soa');
  check('the reference it is given is never modified', JSON.stringify(input) === copy);
}

console.log('\n--- 4. wiring ---');
{
  const route = read('app/api/client-communications/drafts/refresh-amounts/route.ts');
  const pure = read('lib/draft-refresh.ts');
  check('the route asks QuickBooks for the Balance and the exchange rate as well', /SELECT Id, DocNumber, TotalAmt, Balance, ExchangeRate FROM Invoice WHERE Id = /.test(route));
  check('the route decides through refreshInvoiceRef, with the campaign\'s own type and whether the draft may be re-priced — no private amount rule left in it',
    /refreshInvoiceRef\(ref, row, campaign\.type as RefreshCampaignType, reprice\)/.test(route) && !/liveAmount|\.TotalAmt|row\?\.TotalAmt/.test(stripComments(route)));
  check('"may it be re-priced" is decided over ALL of the draft\'s references, before any of them is read', /const reprice = amountsAreRefreshable\(refs, campaign\.type as RefreshCampaignType\);/.test(route)
    && route.indexOf('const reprice = amountsAreRefreshable(') < route.indexOf('const refreshedRefs = await Promise.all('));
  check('references without a QuickBooks Id (credit notes, journal entries) are still left alone', /if \(!ref\.qbInvoiceId\) return ref;/.test(route));
  check('a failed QuickBooks read still keeps the last-known values', /return ref; \/\/ Keep the last-known values rather than failing the whole request\./.test(route));
  check('the pure module reaches neither the database nor QuickBooks', !/supabase|quickbooks'|server-only|process\.env|fetch\(/.test(stripComments(pure)));
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
