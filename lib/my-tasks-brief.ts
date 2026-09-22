import 'server-only';

import type { MyTasksData } from './my-tasks-data';

// Vincent, 2026-09-08: "更智能的分析和判断用户要做什么...每天打开My Tasks
// 的时候 AI助手会提醒今天可能会需要完成的任务" — a short, prioritized,
// natural-language "here's what to focus on today" line generated from
// the exact same computeMyTasks() data the on-screen tables already show
// (never a second, independently-guessed view of what's overdue).
//
// Two engines, matching app/api/assistant/route.ts's own established
// pattern: Claude phrases it naturally when ANTHROPIC_API_KEY is set;
// otherwise (or on any failure) a rule-based sentence built directly from
// the counts — the feature keeps working with zero API dependency, it's
// just plainer prose. Never throws — a briefing failure must never break
// the rest of My Tasks loading.
export async function generateMyTasksBrief(tasks: MyTasksData, staffName: string): Promise<string> {
  if (tasks.counts.total === 0) {
    // 2026-09-08 — Vincent, on his OWN account's empty Tasks tab: "还是很
    // 像摆设，不知道是不是没有数据支撑" — confirmed against real data
    // (lib/my-tasks-data.ts's own comment on `everAssigned`): his account
    // has never once been PIC on anything, ever. "全部处理完了" implies
    // work existed and got finished — false and misleading for an account
    // that was never assigned anything in the first place.
    //
    // Rewritten to Chinese 2026-09-22 — this was the one hardcoded-English
    // surface left in an otherwise all-Chinese staff-facing page, found
    // during Vincent's own "这个提醒的任务...没有做好" review.
    return tasks.everAssigned
      ? '今天 AR Reminder、Late Filing、SOA 欠款和商标续期都没有需要你处理的项目——已经清空。'
      : '你的账号目前没有被指派为任何 AR Reminder/Late Filing PIC，也不是任何客户 SOA/商标的负责人——如果是管理层/非案件经办账号，这是正常情况，不代表系统出错。';
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await claudeBrief(tasks, staffName);
    } catch {
      // fall through to the rule-based sentence below
    }
  }
  return ruleBasedBrief(tasks);
}

function mostUrgent(tasks: MyTasksData): { name: string; daysUntilDue: number } | null {
  const worst = [...tasks.arReminder.staleOverdue, ...tasks.arReminder.overdue]
    .sort((a, b) => (a.daysUntilDue as number) - (b.daysUntilDue as number))[0];
  if (worst) return { name: worst.entityName as string, daysUntilDue: worst.daysUntilDue as number };
  const dueSoon = tasks.arReminder.dueSoon[0];
  if (dueSoon) return { name: dueSoon.entityName as string, daysUntilDue: dueSoon.daysUntilDue as number };
  return null;
}

// Rewritten to Chinese 2026-09-22, same reason as the empty-state copy
// above — this was hardcoded English in an otherwise all-Chinese page.
// Extended the same day to name SOA/trademark counts too, alongside
// lib/my-tasks-data.ts's own scope widening — a rule-based fallback that
// silently dropped the two new sections would defeat the point of adding
// them (Vincent would never see them if the API key were ever unset).
function ruleBasedBrief(tasks: MyTasksData): string {
  const { arOverdue, arStaleOverdue, arDueSoon, lateFiling, soaCollections, trademarkRenewals } = tasks.counts;
  const overdueTotal = arOverdue + arStaleOverdue;
  const parts: string[] = [];
  const worst = mostUrgent(tasks);
  if (overdueTotal > 0) parts.push(`${overdueTotal} 项 AR 已逾期`);
  if (arDueSoon > 0) parts.push(`${arDueSoon} 项将在 14 天内到期`);
  if (lateFiling > 0) parts.push(`${lateFiling} 项在 Late Filing 上被标记`);
  if (soaCollections > 0) parts.push(`${soaCollections} 家客户有 SOA 欠款待催收`);
  if (trademarkRenewals > 0) parts.push(`${trademarkRenewals} 项商标即将到期`);
  let sentence = `今天：${parts.join('，')}。`;
  if (worst) {
    sentence += worst.daysUntilDue < 0
      ? ` 最紧急的是 ${worst.name}，已逾期 ${Math.abs(worst.daysUntilDue)} 天。`
      : ` 最紧急的是 ${worst.name}，还有 ${worst.daysUntilDue} 天到期。`;
  }
  return sentence;
}

// A compact digest, not the full row objects — enough to prioritize and
// name the worst offenders without shipping every column. Exported so
// app/api/assistant/route.ts's my_tasks_summary tool can hand Claude the
// SAME shape this file's own claudeBrief() uses, rather than a second,
// independently-built digest of the same underlying data.
export function buildTaskDigest(tasks: MyTasksData) {
  return {
    counts: tasks.counts,
    everAssigned: tasks.everAssigned,
    worstOverdue: [...tasks.arReminder.staleOverdue, ...tasks.arReminder.overdue]
      .sort((a, b) => (a.daysUntilDue as number) - (b.daysUntilDue as number))
      .slice(0, 5)
      .map(r => ({ company: r.entityName, daysOverdue: Math.abs(r.daysUntilDue as number) })),
    dueSoonest: tasks.arReminder.dueSoon.slice(0, 5).map(r => ({ company: r.entityName, daysUntilDue: r.daysUntilDue })),
    lateFiling: (tasks.lateFiling?.needsAttention ?? []).slice(0, 5).map(r => r.companyName),
    // Added 2026-09-22 alongside lib/my-tasks-data.ts's own scope widening
    // — the biggest SOA balances and soonest trademark expiries this
    // account owns, top 5 each, same shape/limit as the AR lists above.
    biggestSoaBalances: (tasks.soaCollections ?? []).slice(0, 5).map(r => ({ company: r.companyName, qbCompany: r.qbCompany, outstanding: r.totalOutstanding })),
    soonestTrademarkRenewals: (tasks.trademarkRenewals ?? []).slice(0, 5).map(r => ({ company: r.companyName, daysUntilDue: r.daysUntilDue })),
  };
}

// Was hardcoded to claude-haiku-4-5-20251001 and "Reply in English" until
// 2026-09-22 — found during Vincent's own "这个提醒的任务...没有做好"
// review. Both were real, live bugs, not stylistic choices: (1) this is the
// exact model INV-DATA-047 already diagnosed elsewhere in this codebase as
// producing "mechanical, table-padded" replies on a 30+ tool surface —
// app/api/assistant/route.ts's own ASSISTANT_MODEL was upgraded to Sonnet
// for exactly that reason on 2026-09-10, but this separate call site was
// never touched in that same pass, so the daily banner kept degrading
// silently while the chat assistant got better; (2) every other
// staff-facing surface in this app (the chat assistant, the FAQ, every
// page label) is Chinese — an English banner sitting inside an otherwise
// all-Chinese page was a real inconsistency, not a deliberate choice. Now
// shares the exact same ASSISTANT_MODEL env var as the chat assistant, on
// purpose — if that variable ever changes again, this banner must move
// with it rather than silently drift back out of sync the way it just did.
const BRIEF_MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-5';

async function claudeBrief(tasks: MyTasksData, staffName: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const digest = buildTaskDigest(tasks);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: BRIEF_MODEL,
      max_tokens: 260,
      system: '你为一位公司秘书部/会计部员工打开 My Tasks 页面时撰写一句简短的每日优先级提醒（2-3句话，纯文本，不用 Markdown，不用列表符号）。根据他们的 AR Reminder 逾期/即将到期项目、Late Filing 标记、SOA 欠款催收（biggestSoaBalances）和商标续期（soonestTrademarkRenewals），综合判断今天应该优先处理什么——不要只看 AR，一笔金额很大的 SOA 欠款或即将到期的商标也可能比一项普通的 AR 更值得优先处理，用你自己的判断排序，不要机械地按数据出现顺序念。如果有明显最紧急的一项，点名说出来（公司名+具体原因）。直接、具体，不要泛泛的鼓励话。用中文回答。',
      messages: [{ role: 'user', content: `员工：${staffName}\n任务摘要：${JSON.stringify(digest)}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const text = (data.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
  if (!text) throw new Error('empty Claude response');
  return text;
}
