// lib/statement-memo.ts — the Statement memo (QuickBooks PrivateNote) for a
// TAB/TAC renewal invoice, written the way staff type it by hand. Every
// expected value below is a real memo staff typed on a real invoice
// (2026-10-04), cosmetics aside.
//
// Run: npx tsx test-statement-memo.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { composeStatementMemo } from './lib/statement-memo';
import { secretaryDescription, addressDescription, arGovtFeeDescription, xbrlDescription } from './lib/invoice-templates';

const ROOT = process.env.MEMO_GUARD_ROOT ?? process.cwd();
let fail = 0;
const check = (name: string, got: string | boolean, want?: string) => {
  const ok = want === undefined ? got === true : got === want;
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : `\n       got ${JSON.stringify(got)}${want !== undefined ? `, want ${JSON.stringify(want)}` : ''}`));
  if (!ok) fail++;
};
const L = (service: string, description: string, productService?: string) => ({ service, description, productService });

console.log('--- the popup\'s own lines (lib/invoice-templates.ts) ---');
check('Sec + AR  →  "Sec (Nov 2026 - Oct 2027),AR 31.07.2026"',
  composeStatementMemo([L('Secretary', secretaryDescription('Nov 2026 - Oct 2027')), L('AR', arGovtFeeDescription('31.07.2026'))]), 'Sec (Nov 2026 - Oct 2027),AR 31.07.2026');
check('Sec + address + AR  →  "Sec,addrs (Apr 2026 - Mar 2027),AR 31.08.2026"',
  composeStatementMemo([L('Secretary', secretaryDescription('Apr 2026 - Mar 2027')), L('Address', addressDescription('Apr 2026 - Mar 2027')), L('AR', arGovtFeeDescription('31.08.2026'))]), 'Sec,addrs (Apr 2026 - Mar 2027),AR 31.08.2026');
check('Sec + AR + XBRL  →  "Sec (Oct 2026 - Sep 2027),AR,XBRL 31.12.2026"',
  composeStatementMemo([L('Secretary', secretaryDescription('Oct 2026 - Sep 2027')), L('AR', arGovtFeeDescription('31.12.2026')), L('XBRL', xbrlDescription('31.12.2026'))]), 'Sec (Oct 2026 - Sep 2027),AR,XBRL 31.12.2026');
check('XBRL only  →  "XBRL"', composeStatementMemo([L('XBRL', xbrlDescription('31.12.2025'))]), 'XBRL');
check('TAC Nominee Director  →  "ND (Aug 2026 - Jul 2027)"',
  composeStatementMemo([L('ND', 'Nominee Director for one year (Aug 2026 - Jul 2027)', 'Secretary:Nominee Director Fees - WYD')]), 'ND (Aug 2026 - Jul 2027)');
check('an edited description changes the memo with it', composeStatementMemo([L('Secretary', secretaryDescription('Dec 2026 - Nov 2027')), L('AR', arGovtFeeDescription('30.11.2026'))]), 'Sec (Dec 2026 - Nov 2027),AR 30.11.2026');

console.log('\n--- real QuickBooks line shapes ---');
check('#02611068: the secretarial service on the "Deferred Revenue - Corp Sec" item still counts as Sec',
  composeStatementMemo([L('Deferred', 'Perform secretarial services for one-year [from Jan 2027 - Dec 2027]\n- Safe custody…', 'Deferred Revenue - Corp Sec'), L('AR', '- Government fee for ACRA filing of Annual Return [FYE 31.03.2026]', 'Disbursement:Government fee for filing Annual Return')]),
  'Sec (Jan 2027 - Dec 2027),AR 31.03.2026');
check('#02610955: the empty deferred twin and the discount are never mentioned',
  composeStatementMemo([L('Secretary', 'Perform secretarial services for one-year (Jul 2026 - Jun 2027)\n- Safe custody…', 'Secretary:Corporate Secretarial Services'), L('Deferred', '', 'Deferred Revenue - Corp Sec'), L('AR', '- Government fee for ACRA filing of Annual Return [FYE 30.06.2026]'), L('Other', 'Discount for dormant company', 'Discount Given')]),
  'Sec (Jul 2026 - Jun 2027),AR 30.06.2026');
check('#02610960: the address service on "Deferred Revenue - Reg Addr" counts as addrs',
  composeStatementMemo([L('Secretary', 'Perform secretarial services for one-year (Jul 2026 -Jun 2027）'), L('Deferred', '', 'Deferred Revenue - Corp Sec'), L('Deferred', 'Registered and mailing address services for one year （Mar 2027 - Jun 2027)', 'Deferred Revenue - Reg Addr'), L('AR', '- Government fee for ACRA filing of Annual Return [FYE 30.06.2026]')]),
  'Sec,addrs (Jul 2026 - Jun 2027),AR 30.06.2026');
check('carried Accounts / Tax lines follow by item name, like staff\'s "bizfile"',
  composeStatementMemo([L('Secretary', secretaryDescription('Nov 2025 - Oct 2026')), L('AR', arGovtFeeDescription('30.06.2026')), L('Accounts', 'Yearly accounts', 'Accounts:Yearly Accounts Services'), L('Tax', 'Tax YA 2026', 'Tax:Corporate Tax Services')]),
  'Sec (Nov 2025 - Oct 2026),AR 30.06.2026,Yearly Accounts Services,Corporate Tax Services');
check('nothing to describe → empty memo (nothing is sent)', composeStatementMemo([L('Discount', 'Discount', 'Discount Given')]), '');

console.log('\n--- source guards ---');
{
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
  const popup = read('components/billing/ExpandedBillingRow.tsx');
  check('the popup sends the memo per book being generated', /statementMemos: \{/.test(popup) && /sendTab && memoFor\('TAB'\)\.trim\(\)/.test(popup) && /sendTac && memoFor\('TAC'\)\.trim\(\)/.test(popup));
  check('the memo is composed with the shared rule, editable, and only shown when generating', /composeStatementMemo\(company === 'TAB' \? includedTab : includedTac\)/.test(popup)
    && /\{!tabInvoice && renderMemoField\('TAB'\)\}/.test(popup) && /\{!tacInvoice && renderMemoField\('TAC'\)\}/.test(popup));
  check('editing an existing invoice never touches its memo (update-invoice sends no PrivateNote)', !/PrivateNote/.test(read('app/api/quickbooks/update-invoice/route.ts')));
  check('create-invoice writes it as PrivateNote', /\{ PrivateNote: statementMemo\.trim\(\) \}/.test(read('app/api/quickbooks/create-invoice/route.ts')));
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
