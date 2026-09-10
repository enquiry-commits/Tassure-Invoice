// The deterministic reply guards (INV-DATA-022/023). Added 2026-09-10 after
// the outstanding guard fired on "（开单、年报、欠款等）" — a page
// description with no claim in it — and prepended a scary warning to a
// correct answer. A guard that cries wolf gets ignored, so this pins BOTH
// directions: the real fabrications it must still catch, and the ordinary
// prose it must leave alone.
//
// Run: npx tsx test-reply-guards.ts
import { mentionsOutstandingBalance, claimsPermissionDenied } from './app/api/assistant/route';

let fail = 0;
const expect = (name: string, text: string, want: boolean, fn: (t: string) => boolean) => {
  const got = fn(text);
  const ok = got === want;
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok ? '' : ` -- wanted ${want}, got ${got}`));
  if (!ok) fail++;
};

console.log('--- must STILL be caught (real fabrications) ---');
// The exact shape of the original incident.
expect('fabricated "no arrears" with fake figures', '✅ 确认：1V Capital 目前没有欠款（$0，0张未付发票）', true, mentionsOutstandingBalance);
expect('a stated amount', 'TASSURE PAC 欠款 S$34,596.57，共15张未付发票。', true, mentionsOutstandingBalance);
expect('a bare claim, no number', '这家公司目前没有欠款。', true, mentionsOutstandingBalance);
expect('claims there IS one', '他们还有欠款没结清。', true, mentionsOutstandingBalance);
expect('English, no figure', 'This company has no outstanding balance.', true, mentionsOutstandingBalance);
expect('English, owes', 'They owe us an outstanding amount.', true, mentionsOutstandingBalance);
expect('unpaid invoices claim', '目前有 3 张未付发票。', true, mentionsOutstandingBalance);

console.log('\n--- must NOT be flagged (ordinary prose) ---');
// The real false positive from Vincent's screenshot.
expect('page description in an enumeration', 'Billing → — 9 次访问（开单、年报、欠款等）', false, mentionsOutstandingBalance);
expect('describing what a page covers', 'Billing 页面可以处理开单、年报、欠款等事务。', false, mentionsOutstandingBalance);
expect('offering to check', '要我帮你查一下欠款情况吗？', false, mentionsOutstandingBalance);
expect('a reply with no money topic at all', '今天大家主要在忙开单和年报相关的工作。', false, mentionsOutstandingBalance);
expect('an invoice total that is not arrears', '这张发票金额是 S$660.00。', false, mentionsOutstandingBalance);

console.log('\n--- permission guard, unchanged ---');
expect('fabricated refusal', '我没有权限查看其他员工的任务。', true, claimsPermissionDenied);
expect('ordinary answer', 'Chelsea 今天有 3 项任务。', false, claimsPermissionDenied);

console.log(fail === 0 ? '\n=== ALL PASSED ===' : `\n=== ${fail} FAILED ===`);
process.exit(fail === 0 ? 0 : 1);
