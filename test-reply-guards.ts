// The deterministic reply guards (INV-DATA-022/023). Added 2026-09-10 after
// the outstanding guard fired on "（开单、年报、欠款等）" — a page
// description with no claim in it — and prepended a scary warning to a
// correct answer. A guard that cries wolf gets ignored, so this pins BOTH
// directions: the real fabrications it must still catch, and the ordinary
// prose it must leave alone.
//
// Extended 2026-09-22 with the generic capability-denial backstop
// (INV-AI-004) — see claimsGenericCapabilityDenial's own comment in
// route.ts for why this exists instead of a 4th hand-written per-feature
// regex, and applyCapabilityGuards for why the guard chain moved to run
// exactly once in POST() rather than inside claudeAnswer() itself.
//
// Run: npx tsx test-reply-guards.ts
import { mentionsOutstandingBalance, claimsPermissionDenied, claimsGenericCapabilityDenial, applyCapabilityGuards } from './app/api/assistant/route';

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

console.log('\n--- generic capability-denial backstop (INV-AI-004) ---');
// Re-run the three real documented incidents through the GENERIC detector
// too, to confirm the backstop would have caught every one of them on its
// own structural signal (zero tools called) even without knowing their
// specific wording in advance.
expect('SOA: real 2026-09-18 incident wording', '抱歉，我这边没有任何工具能直接下载或生成 PDF', true, claimsGenericCapabilityDenial);
expect('generic "no tool" claim for an unnamed feature', '很抱歉，我没有工具可以帮你导出这份报表。', true, claimsGenericCapabilityDenial);
expect('generic "no way" claim, English', "I'm not able to directly access that report.", true, claimsGenericCapabilityDenial);
expect('flat impossibility claim', '这个操作我这边做不到。', true, claimsGenericCapabilityDenial);
expect('a genuine hedge, offering to check first', '我需要先查一下才能确定，请给我公司名。', false, claimsGenericCapabilityDenial);
expect('a clarifying question, not a denial', '你是想下载哪一份文件？', false, claimsGenericCapabilityDenial);
expect('an ordinary capability description', '我可以帮你查公司资料、开票草稿和年报进度。', false, claimsGenericCapabilityDenial);

console.log('\n--- applyCapabilityGuards: single entry point, no double-flagging ---');
const outstandingCase = applyCapabilityGuards('这家公司目前没有欠款。', { toolNames: [], toolEvidence: [] });
expect('outstanding-balance claim still flagged via the combined function', outstandingCase, true, t => t.startsWith('⚠️'));
expect('outstanding-balance claim gets exactly ONE warning, not stacked', outstandingCase, false, t => t.split('⚠️ 系统提示').length - 1 > 1);
const soaCase = applyCapabilityGuards('抱歉，我这边没有任何工具能直接下载或生成 PDF', { toolNames: [], toolEvidence: [] });
expect('SOA denial: specific guard fires, generic backstop does not ALSO fire', soaCase, false, t => t.split('⚠️ 系统提示').length - 1 > 1);
const newFeatureDenial = applyCapabilityGuards('很抱歉，我没有工具可以帮你导出这份报表。', { toolNames: [], toolEvidence: [] });
expect('a denial for a feature none of the 3 specific guards name still gets caught', newFeatureDenial, true, t => t.startsWith('⚠️'));
const realToolCallNoDenial = applyCapabilityGuards('这次导出已经准备好了，点击下方按钮下载。', { toolNames: ['list_companies'], toolEvidence: [] });
expect('an ordinary reply after a real tool call is never flagged', realToolCallNoDenial, false, t => t.includes('⚠️'));
const toolCalledSoDenialIgnored = applyCapabilityGuards('很抱歉，我没有工具可以帮你导出这份报表。', { toolNames: ['list_companies'], toolEvidence: [] });
expect('generic backstop does NOT fire once a tool was actually called this turn', toolCalledSoDenialIgnored, false, t => t.includes('⚠️'));

console.log(fail === 0 ? '\n=== ALL PASSED ===' : `\n=== ${fail} FAILED ===`);
process.exit(fail === 0 ? 0 : 1);
