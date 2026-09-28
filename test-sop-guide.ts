// The assistant's get_sop_guide knowledge (lib/client-comms-sop.ts, added
// 2026-09-28). Pins the three things that would fail silently in production:
//   1. a figure Vincent asked to hold back until confirmed ("先上流程和文件
//      解释，日期/金额等确认后补") leaking into the shipped content;
//   2. a topic's payload growing past the tool loop's 6000-char tool_result
//      cut in app/api/assistant/route.ts — the model would get truncated,
//      invalid JSON and no error anywhere;
//   3. SOP-shaped questions with no company/client word falling through to
//      the OpenAI-only general answer, where get_sop_guide doesn't exist.
//
// Run: npx tsx test-sop-guide.ts
import { SOP_TOPICS, SOP_SECTIONS, PENDING_REVIEW, SOP_TOOL_NOTE, SOP_ROUTING_TERMS, getSopGuide } from './lib/client-comms-sop';

let fail = 0;
const check = (label: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};

console.log('--- every topic has real content ---');
for (const topic of SOP_TOPICS) {
  const section = SOP_SECTIONS[topic];
  check(`${topic}: has a section with at least one block`, !!section && section.blocks.length > 0);
  check(`${topic}: every block has non-empty lines`, section.blocks.every(b => b.heading.trim() !== '' && b.lines.length > 0 && b.lines.every(l => l.trim() !== '')));
  const result = getSopGuide(topic);
  check(`${topic}: getSopGuide returns it`, !('error' in result) && result.topic === topic && result.note === SOP_TOOL_NOTE);
}
const unknown = getSopGuide('tax_rates');
check('unknown topic → error naming the valid topics', unknown.error === true && unknown.message.includes('incorporation'));
const padded = getSopGuide('  Annual_Return ');
check('topic matching trims and ignores case', !('error' in padded) && padded.topic === 'annual_return');
check('every pendingReview entry belongs to a real topic', PENDING_REVIEW.every(p => p.topics.length > 0 && p.topics.every(t => (SOP_TOPICS as readonly string[]).includes(t))));

console.log('\n--- nothing held back for confirmation leaks into the shipped content ---');
// Fragments of the source's date/fee/penalty/tax/threshold passages (DPO,
// alternate address, share-capital amounts, first-FYE advice, tax
// exemption, ECI, filing deadlines, audit thresholds, AR penalty scripts,
// dormant relevant company, ND fee), plus the "Sharing" section's named
// client cases. Checked across the whole payload of every topic — blocks,
// pendingReview titles, the note — not just the section text.
const HELD_BACK = [
  '30/9/2024', 'SGD100', 'SGD200', 'S$100', 'S$200',
  '2024年12月', 'SGD$40', 'S$40',
  '5k', '10k', '20万', '30万', '50万', '1万新币', '300,000', '10,000', 'SBF', '6个月内需要实缴', '半年内',
  '第11个月', '11th month', '2025年1月31日',
  '75%', '50%', '17%', '10万', '19万', '五百万', 'EPC',
  '3 月 01', '3 月 31', '4 月 15', '6 月 30', '7 月 31', '11 月 30', '2023',
  '1000万', '10 million', '50名', 'more than 50',
  'S$300', 'S$600',
  '500,000', '$500',
  '3000', '6%',
  '6月底之前', '7月底之前',
  'Tian Tian', 'Easybook', 'One smart', 'channelnewsasia',
];
const everything = SOP_TOPICS.map(t => JSON.stringify(getSopGuide(t))).join('\n');
for (const fragment of HELD_BACK) {
  check(`does not contain "${fragment}"`, !everything.includes(fragment));
}

console.log('\n--- known source typos stay fixed ---');
for (const typo of ['新加披', '负债贵司', '1-3三', 'pre-empty', 'hanover', 'INDENNITY', 'UNDERTANKING', '这集团', 'tag the PIC)']) {
  check(`no "${typo}"`, !everything.includes(typo));
}

console.log('\n--- internal-only notes never sit in a client-facing block ---');
for (const topic of SOP_TOPICS) {
  const clientText = SOP_SECTIONS[topic].blocks.filter(b => b.audience === 'client').flatMap(b => b.lines).join('\n');
  check(`${topic}: client blocks mention no Cindy / PIC tagging / pendingReview`, !/Cindy|\btag\b|\bPIC\b|pendingReview/.test(clientText));
}

console.log('\n--- each payload fits the 6000-char tool_result cut (with margin) ---');
for (const topic of SOP_TOPICS) {
  const size = JSON.stringify(getSopGuide(topic)).length;
  check(`${topic}: ${size} chars <= 5600`, size <= 5600);
}

console.log('\n--- SOP-shaped questions stay on Claude (orchestrator isInternal) ---');
const SHOULD_ROUTE = [
  '股份转让要准备什么', '增资扩股要注意什么', '年检第一次提醒怎么写', '转秘书要问客户什么',
  'S156是什么意思', '怎么跟客户解释 engagement letter', 'letter of indemnity 是干嘛的',
  'dormant AGM 需要什么', '催款话术', 'share transfer documents needed', 'incorporation timeline',
  '挂名董事协议怎么解释', 'KYC 要准备什么', 'Section 386 notice 是什么', 'RORC 是什么', 'share allotment checklist',
];
for (const q of SHOULD_ROUTE) check(`routes to Claude: ${q}`, SOP_ROUTING_TERMS.test(q));
const GENERAL = ['今天天气怎么样', 'What is the capital of Japan?', '帮我翻译 good morning', 'How do I cook rice?'];
for (const q of GENERAL) check(`does not claim a general question: ${q}`, !SOP_ROUTING_TERMS.test(q));

console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
process.exit(fail === 0 ? 0 : 1);
