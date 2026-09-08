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
    return "You're all caught up — nothing on AR Reminder or Late Filing needs attention today.";
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

function ruleBasedBrief(tasks: MyTasksData): string {
  const { arOverdue, arStaleOverdue, arDueSoon, lateFiling } = tasks.counts;
  const overdueTotal = arOverdue + arStaleOverdue;
  const parts: string[] = [];
  const worst = mostUrgent(tasks);
  if (overdueTotal > 0) {
    parts.push(`${overdueTotal} AR item${overdueTotal === 1 ? ' is' : 's are'} overdue`);
  }
  if (arDueSoon > 0) parts.push(`${arDueSoon} due within 14 days`);
  if (lateFiling > 0) parts.push(`${lateFiling} flagged on Late Filing`);
  let sentence = `Today: ${parts.join(', ')}.`;
  if (worst) {
    sentence += worst.daysUntilDue < 0
      ? ` The most urgent is ${worst.name}, ${Math.abs(worst.daysUntilDue)} days overdue.`
      : ` The most urgent is ${worst.name}, due in ${worst.daysUntilDue} day${worst.daysUntilDue === 1 ? '' : 's'}.`;
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
    worstOverdue: [...tasks.arReminder.staleOverdue, ...tasks.arReminder.overdue]
      .sort((a, b) => (a.daysUntilDue as number) - (b.daysUntilDue as number))
      .slice(0, 5)
      .map(r => ({ company: r.entityName, daysOverdue: Math.abs(r.daysUntilDue as number) })),
    dueSoonest: tasks.arReminder.dueSoon.slice(0, 5).map(r => ({ company: r.entityName, daysUntilDue: r.daysUntilDue })),
    lateFiling: (tasks.lateFiling?.needsAttention ?? []).slice(0, 5).map(r => r.companyName),
  };
}

async function claudeBrief(tasks: MyTasksData, staffName: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const digest = buildTaskDigest(tasks);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: 'You write a single short daily briefing (2-3 sentences, plain text, no markdown, no bullet points) for a corporate-secretarial staff member opening their My Tasks page. Given their overdue/due-soon AR Reminder items and Late Filing flags, tell them what to prioritize today. Name the single most urgent company if one exists. Be direct and specific, not generic encouragement. Reply in English.',
      messages: [{ role: 'user', content: `Staff member: ${staffName}\nTask digest: ${JSON.stringify(digest)}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const text = (data.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
  if (!text) throw new Error('empty Claude response');
  return text;
}
