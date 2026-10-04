// lib/statement-memo.ts — the Statement memo (QuickBooks PrivateNote) every
// invoice this app generates gets (TAB/TAC renewals and TAO), written the
// way staff type it by hand — automatic, never shown. Every expected value
// below is a real memo staff typed on a real invoice (2026-10-04),
// cosmetics aside.
//
// Run: npx tsx test-statement-memo.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { composeStatementMemo, composeTaoStatementMemo } from './lib/statement-memo';
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

console.log('\n--- TAO: real invoices whose staff memo it reproduces ---');
const T = (productService: string, description: string) => ({ productService, description });
const yearly = T('Accounts:Yearly Accounts Services', 'Being professional services rendered for the year ended 30 June 2026\n- Yearly accounting services');
const report = T('Accounts:Compilation Report Services', '- Compilation report');
const tax = T('Tax:Corporate Tax Services', '- Tax computation and Form C-S (YA2027)');
check('#02660760 accounts + report + tax  →  "Yearly accounting services,Compilation report,Tax YA 2027"',
  composeTaoStatementMemo([yearly, report, tax]), 'Yearly accounting services,Compilation report,Tax YA 2027');
check('staff\'s order whatever order the lines are in (the TAO page lists them by last billed)',
  composeTaoStatementMemo([tax, report, yearly]), 'Yearly accounting services,Compilation report,Tax YA 2027');
check('#02660704 the OPE reimbursement is never named  →  "Compilation report,Tax YA 2027"',
  composeTaoStatementMemo([T('Accounts:Compilation Report Services', 'Being professional services rendered for the year ended 31 May 2026\n- Compilation report'), T('Tax:Corporate Tax Services', '- Tax computation and Form C-S [YA 2027]'), T('Disbursement:Reimbursement - OPE', 'Disbursement incurred:\n- Stationery/Photocopying/IT support charges')]),
  'Compilation report,Tax YA 2027');
check('#02660692 tax only  →  "Tax YA 2026"', composeTaoStatementMemo([T('Tax:Corporate Tax Services', 'Being professional fee for preparation of Tax computation and Form C-S (YA2026)')]), 'Tax YA 2026');
check('#02660757 monthly  →  "Monthly accounting services"', composeTaoStatementMemo([T('Accounts:Monthly Accounts Services', 'Being professional services rendered for the monthly of Aug 2026\n- Monthly accounting services ($800 /month)')]), 'Monthly accounting services');
check('#02660721 quarterly  →  "Quarterly accounting services"', composeTaoStatementMemo([T('Accounts:Quarterly Accounts Services', 'Being professional services rendered for the quarter ended 31 August 2026\n- Quarterly accounting services')]), 'Quarterly accounting services');
check('#02660127 AIS with an extra-headcount line  →  named once, with its YA',
  composeTaoStatementMemo([T('Tax:AIS submission', 'Being professional service for e-submission of Employment Income Tax YA2026\nFirst 5 employees'), T('Tax:AIS submission', 'Additional 18 employees ($15 per headcount)')]),
  'e-submission of Employment Income Tax YA2026');
check('#02660664 personal tax  →  "Personal tax submission YA 2026"', composeTaoStatementMemo([T('Tax:Personal Tax Services', 'Income statement and personal tax submission YA 2026\n- Mai Yanguang')]), 'Personal tax submission YA 2026');
check('#02660602 GST  →  "GST submission"', composeTaoStatementMemo([T('Tax:GST Submission Services', 'To fees of services rendered for GST submission for the period of Apr to Jun 26')]), 'GST submission');
check('#02660747 any other item by its QuickBooks name  →  "Certificate of Residence"', composeTaoStatementMemo([T('Tax:Certificate of Residence', 'To fee for application for Certificate of Residence\n- Poland (CY2026)')]), 'Certificate of Residence');
check('two YAs on two tax lines are both named', composeTaoStatementMemo([T('Tax:Corporate Tax Services', 'Tax computation and Form P1 (YA2025)'), T('Tax:Corporate Tax Services', 'Tax computation and Form P1 (YA2026)')]), 'Tax YA 2025,Tax YA 2026');
check('a custom line with no item  →  its first line', composeTaoStatementMemo([T('', 'Registration of MNE Group\n- under the Multinational Enterprise (Minimum Tax) Act 2024')]), 'Registration of MNE Group');
check('only a reimbursement on the invoice  →  named, never blank', composeTaoStatementMemo([T('Disbursement:Reimbursement - OPE', 'Disbursement incurred')]), 'Reimbursement - OPE');

console.log('\n--- source guards ---');
{
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
  const popup = read('components/billing/ExpandedBillingRow.tsx');
  const tao = read('components/billing/TaoInvoiceBuilder.tsx');
  check('the popup writes the memo for each book being sent, from the lines being sent', /const tabMemo = sendTab \? composeStatementMemo\(includedTab\) : ''/.test(popup)
    && /const tacMemo = sendTac \? composeStatementMemo\(includedTac\) : ''/.test(popup) && /statementMemos: \{\s*\.\.\.\(tabMemo \? \{ TAB: tabMemo \} : \{\}\),\s*\.\.\.\(tacMemo \? \{ TAC: tacMemo \} : \{\}\),\s*\}/.test(popup));
  check('the TAO builder writes it from the lines being sent', /statementMemos: \{ TAO: composeTaoStatementMemo\(included\) \}/.test(tao));
  check('no memo field anywhere — automatic, never shown (Vincent: "不需要特地多一个东西显示这个Memo")', !/Statement memo<\/span>|memoOverride|renderMemoField|setMemo\b|lastStatementMemo/.test(popup + tao));
  check('the TAO history no longer reads the last memo live from QuickBooks', !/qbQuery|PrivateNote|lastStatementMemo/.test(read('app/api/billing/tao/service-history/route.ts')));
  check('editing an existing invoice never touches its memo (update-invoice sends no PrivateNote)', !/PrivateNote/.test(read('app/api/quickbooks/update-invoice/route.ts')));
  check('create-invoice writes it as PrivateNote', /\{ PrivateNote: statementMemo\.trim\(\) \}/.test(read('app/api/quickbooks/create-invoice/route.ts')));
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
