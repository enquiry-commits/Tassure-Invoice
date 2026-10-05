import 'server-only';

import { createAdminClient } from '../supabase';
import { claudeMessages } from '../ai/anthropic';
import type { AiUsageTag } from '../ai/usage';
import { judgeRequestBody, parseJudgeResponse, type QualityIssue, type QualityVerdict } from './judge';

// Automated quality spot-check (2026-09-22) — item 6 of Vincent's own "AI
// Agent/My Tasks 少一些东西" review. Every real AI-assistant bug documented
// in docs/INVARIANTS.md's INV-AI/INV-DATA-022/023 family was found by
// Vincent personally screenshotting a wrong reply; this is the first thing
// that samples and reviews real replies on its own, without waiting for
// that to happen again.
//
// Honest scope, stated once here rather than re-explained at every call
// site: `ai_messages` never persists the raw tool RESULTS a reply was built
// from (only `ai_agent_runs.tool_names`, which tools ran, not what they
// returned) — see lib/ai-conversations.ts's own schema. So this judge
// cannot independently re-verify whether a specific dollar figure, date or
// name in a reply is factually correct; it catches BEHAVIORAL defects
// visible from the reply's own text and which tools ran (a capability
// denial with no tool call, a confident specific claim from a turn with
// ZERO tools called, wrong-language/non-sequitur replies, a confusing
// action card). Re-verifying against live data would need the judge to
// itself re-run the same tools — a real, bigger follow-up, deliberately not
// attempted here (see docs/INVARIANTS.md INV-AI-006's own note).

export type { QualityIssue, QualityVerdict };

type ReviewCandidate = {
  messageId: number;
  conversationId: number;
  accountEmail: string;
  userQuestion: string;
  assistantReply: string;
  toolsUsed: string[];
};

const JUDGE_MODEL = process.env.AI_QUALITY_JUDGE_MODEL || 'claude-sonnet-5';

const RUBRIC = `You are a strict quality auditor for an internal Tassure corporate-services staff assistant. You will be shown ONE real exchange: the staff member's question, the assistant's actual reply, and the list of internal data tools the assistant called (if any) while producing that reply.

You do NOT have access to the tools' real results, so you cannot verify whether a specific number, date or name is factually correct — never guess at that; being unable to verify something is NOT itself a defect. Flag ONLY a defect you can see directly from the reply's own text and behavior:
1. capability_denial — the reply claims it has no way/tool/permission to do something.
2. unfounded_specificity — the reply states a specific fact (a name, amount, date, status) with real authority, but the tool list is EMPTY for this turn, so nothing could actually have supplied that fact.
3. language_or_relevance — the reply ignores the actual question, answers in the wrong language, or is a non-sequitur.
4. incomplete_or_confusing — a proposed action/card is mentioned but the reply leaves the reader with no clear idea what to do next.
5. other — any other clear, concrete defect visible directly in the text (explain briefly).

If you cannot point to a concrete problem in the reply itself, the verdict is "pass". Do not flag on a hunch, on a complex topic, or because you personally cannot confirm a number is right.

Respond with ONLY this JSON, no other text before or after it:
{"verdict": "pass" | "flag", "issues": [{"category": "...", "description": "..."}]}`;

// One batch of 3 parallel queries instead of one sequential lookup per
// candidate (INV-PERF-002) — the "preceding user message" for each sampled
// reply is found in-memory from a single fetch of every message in the
// involved conversations, not a per-candidate round trip.
async function findCandidates(limit: number): Promise<ReviewCandidate[]> {
  const supabase = createAdminClient();
  const { data: reviewed, error: reviewedError } = await supabase.from('ai_quality_reviews').select('message_id');
  // Without this list every candidate is judged — a paid call — and then
  // fails to save, on every run (the state from 2026-09-22 to 10-05, when
  // the table had never been created). Stop before spending anything.
  if (reviewedError) throw new Error(`Cannot read ai_quality_reviews: ${reviewedError.message}`);
  const reviewedIds = new Set((reviewed ?? []).map(r => Number(r.message_id)));

  // Over-fetch (6x) to leave enough headroom after excluding already-
  // reviewed/trivial messages, then randomly sample down to `limit` — a spot
  // check should cover real usage over time, not just whichever handful of
  // messages happened to be sent right before this cron fires.
  const { data: recentAssistant } = await supabase
    .from('ai_messages')
    .select('id, conversation_id, content, agent_run_id, created_at')
    .eq('role', 'assistant')
    .not('agent_run_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit * 6);
  const pool = (recentAssistant ?? []).filter(m => !reviewedIds.has(Number(m.id)) && (m.content ?? '').trim().length > 20);
  if (!pool.length) return [];
  const sample = [...pool].sort(() => Math.random() - 0.5).slice(0, limit);

  const convoIds = [...new Set(sample.map(m => Number(m.conversation_id)))];
  const runIds = [...new Set(sample.map(m => Number(m.agent_run_id)))];

  const [convosRes, runsRes, convoMessagesRes] = await Promise.all([
    supabase.from('ai_conversations').select('id, account_email').in('id', convoIds),
    supabase.from('ai_agent_runs').select('id, tool_names').in('id', runIds),
    supabase.from('ai_messages').select('id, conversation_id, role, content, created_at').in('conversation_id', convoIds).order('created_at', { ascending: true }),
  ]);

  const emailByConvo = new Map((convosRes.data ?? []).map(c => [Number(c.id), c.account_email as string]));
  const toolsByRun = new Map((runsRes.data ?? []).map(r => [Number(r.id), ((r.tool_names as string[]) ?? [])]));
  const messagesByConvo = new Map<number, { role: string; content: string; created_at: string }[]>();
  for (const m of convoMessagesRes.data ?? []) {
    const list = messagesByConvo.get(Number(m.conversation_id)) ?? [];
    list.push(m);
    messagesByConvo.set(Number(m.conversation_id), list);
  }

  return sample.map(m => {
    const siblings = messagesByConvo.get(Number(m.conversation_id)) ?? [];
    const precedingUser = siblings
      .filter(s => s.role === 'user' && new Date(s.created_at).getTime() < new Date(m.created_at).getTime())
      .pop();
    return {
      messageId: Number(m.id),
      conversationId: Number(m.conversation_id),
      accountEmail: emailByConvo.get(Number(m.conversation_id)) ?? 'unknown',
      userQuestion: precedingUser?.content ?? '(no preceding user message found)',
      assistantReply: m.content,
      toolsUsed: toolsByRun.get(Number(m.agent_run_id)) ?? [],
    };
  });
}

function judge(candidate: ReviewCandidate, usage: AiUsageTag): Promise<QualityVerdict> {
  const input = `STAFF QUESTION:\n${candidate.userQuestion.slice(0, 2000)}\n\nTOOLS CALLED THIS TURN: ${candidate.toolsUsed.length ? candidate.toolsUsed.join(', ') : '(none)'}\n\nASSISTANT REPLY:\n${candidate.assistantReply.slice(0, 4000)}`;
  return claudeMessages(usage, judgeRequestBody(JUDGE_MODEL, RUBRIC, input)).then(async res => {
    if (!res.ok) throw new Error(`Judge API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return parseJudgeResponse(await res.json());
  });
}

// The route's maxDuration is 120s, and a hard platform kill never reaches
// withAutomationRun's cleanup (INV-CRON-008), so stop starting new judge
// calls with ~30s to spare. Whatever is left stays unreviewed and is picked
// up by the next run.
const TIME_BUDGET_MS = 90_000;

export type QualityBatchResult = {
  reviewed: number;
  flagged: number;
  errors: number;
  errorSamples: string[];
  skippedForTime: number;
  skippedNoKey: boolean;
};

// Called from the daily cron (app/api/ai-quality/review/route.ts). One
// candidate's failure (a malformed judge response, a transient API error)
// must never stop the rest of the batch — same "one account's failure
// never starves the others" discipline as ai-learning/analyze-all's own
// per-account try/catch.
// `usage`: the nightly cron (system) or a person's own "立即抽查" click, for
// the AI usage ledger (INV-AI-010).
export async function runQualityReviewBatch(limit: number, usage: AiUsageTag): Promise<QualityBatchResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { reviewed: 0, flagged: 0, errors: 0, errorSamples: [], skippedForTime: 0, skippedNoKey: true };
  const startedAt = Date.now();
  const supabase = createAdminClient();
  const candidates = await findCandidates(limit);
  let reviewed = 0;
  let flagged = 0;
  let skippedForTime = 0;
  // The first few failures' own messages, so a failed run on Automation
  // Health says why instead of only "ai_quality_review failed."
  const errorSamples: string[] = [];
  let errors = 0;
  const noteError = (message: string) => {
    errors++;
    if (errorSamples.length < 3) errorSamples.push(message.slice(0, 300));
  };
  for (const [index, candidate] of candidates.entries()) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      skippedForTime = candidates.length - index;
      break;
    }
    try {
      const result = await judge(candidate, usage);
      const { error } = await supabase.from('ai_quality_reviews').insert({
        message_id: candidate.messageId,
        conversation_id: candidate.conversationId,
        account_email: candidate.accountEmail,
        user_question: candidate.userQuestion.slice(0, 4000),
        assistant_reply: candidate.assistantReply.slice(0, 8000),
        tools_used: candidate.toolsUsed,
        verdict: result.verdict,
        issues: result.issues,
        judge_model: JUDGE_MODEL,
      });
      // A save error counts against THIS candidate only — never aborts the
      // rest of the batch. (A missing table is caught before any judge call,
      // in findCandidates.)
      if (error) { noteError(`save: ${error.message}`); continue; }
      reviewed++;
      if (result.verdict === 'flag') flagged++;
    } catch (error) {
      noteError(error instanceof Error ? error.message : String(error));
    }
  }
  return { reviewed, flagged, errors, errorSamples, skippedForTime, skippedNoKey: false };
}

export type QualityReviewRow = {
  id: number;
  created_at: string;
  message_id: number;
  conversation_id: number;
  account_email: string;
  user_question: string;
  assistant_reply: string;
  tools_used: string[];
  verdict: 'pass' | 'flag';
  issues: QualityIssue[];
  judge_model: string;
  human_verdict: 'confirmed_issue' | 'false_positive' | null;
  human_note: string | null;
  human_reviewed_by: string | null;
  human_reviewed_at: string | null;
};

// Powers the /ai-quality review page (app/api/ai-quality/reviews/route.ts).
// `onlyOpen` defaults to true — a management reviewer wants the WORK QUEUE
// (flagged, no human verdict yet) by default, not the full history; the
// page itself offers a toggle for the rest.
export async function listQualityReviews(opts: { onlyOpen?: boolean; limit?: number } = {}): Promise<QualityReviewRow[]> {
  const supabase = createAdminClient();
  let query = supabase.from('ai_quality_reviews').select('*').order('created_at', { ascending: false }).limit(opts.limit ?? 100);
  if (opts.onlyOpen !== false) query = query.eq('verdict', 'flag').is('human_verdict', null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as QualityReviewRow[];
}

// A human's verdict is recorded on the SAME row the machine's own verdict
// lives on (never a second row) — see the migration's own header comment
// for why: "does a human agree with the machine" must stay attached to the
// exact machine verdict it is agreeing or disagreeing with, not floating
// free.
export async function recordHumanVerdict(params: {
  id: number;
  actorEmail: string;
  verdict: 'confirmed_issue' | 'false_positive';
  note?: string;
}): Promise<QualityReviewRow> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('ai_quality_reviews')
    .update({
      human_verdict: params.verdict,
      human_note: params.note?.slice(0, 2000) ?? null,
      human_reviewed_by: params.actorEmail,
      human_reviewed_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as QualityReviewRow;
}
