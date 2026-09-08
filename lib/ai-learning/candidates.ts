import 'server-only';

import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import {
  detectActivityPatterns,
  type CandidateStatus,
  type LearnableActivityEvent,
  type LearningPatternKind,
  type PatternEvidence,
} from './patterns';

export type LearningCandidate = {
  id: number;
  account_email: string;
  pattern_kind: LearningPatternKind;
  pattern_key: string;
  proposed_memory_type: 'behaviour' | 'pattern';
  proposed_content: string;
  status: CandidateStatus;
  confidence: number;
  source_count: number;
  distinct_days: number;
  evidence: PatternEvidence;
  first_seen: string;
  last_seen: string;
  approved_content: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  promoted_memory_id: number | null;
  created_at: string;
  updated_at: string;
};

const FINAL_STATUSES = new Set<CandidateStatus>(['approved', 'rejected', 'dismissed']);

// Auto-approval thresholds — see analyzeUserActivity's own comment on why
// both are required and why they're set this high.
const AUTO_APPROVE_MIN_CONFIDENCE = 0.9;
const AUTO_APPROVE_MIN_DISTINCT_DAYS = 5;
// Matches this codebase's existing convention for automated actors
// (system:teamwork, system:late-filing, system:draft-send, ...) — never a
// real person's email, so review_ai_learning_candidate's audit trail
// (ai_learning_feedback.actor_email) always shows plainly that this
// specific approval was automatic, not Vincent's.
const AUTO_APPROVE_ACTOR = 'system:ai-learning-auto';

export async function analyzeUserActivity(accountEmail: string, windowDays = 30): Promise<LearningCandidate[]> {
  const email = accountEmail.trim().toLowerCase();
  const days = Math.min(Math.max(windowDays, 7), 180);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const supabase = createAdminClient();
  const events = await pageAll<LearnableActivityEvent>(() => supabase
    .from('user_activity_events')
    .select('id, account_email, pathname, event_type, detail, created_at')
    .eq('account_email', email)
    .gte('created_at', since));

  const proposals = detectActivityPatterns(events, { accountEmail: email, windowDays: days });
  if (!proposals.length) return [];

  const { data: existingRows, error: existingError } = await supabase
    .from('ai_learning_candidates')
    .select('pattern_kind, pattern_key, status')
    .eq('account_email', email);
  if (existingError) throw new Error(existingError.message);
  const existing = new Map(
    ((existingRows ?? []) as Pick<LearningCandidate, 'pattern_kind' | 'pattern_key' | 'status'>[])
      .map(row => [`${row.pattern_kind}\u0000${row.pattern_key}`, row.status]),
  );
  const updatedAt = new Date().toISOString();
  const rows = proposals.map(proposal => {
    const currentStatus = existing.get(`${proposal.pattern_kind}\u0000${proposal.pattern_key}`);
    const status = currentStatus && FINAL_STATUSES.has(currentStatus)
      ? currentStatus
      : proposal.recommended_status;
    return {
      account_email: proposal.account_email,
      pattern_kind: proposal.pattern_kind,
      pattern_key: proposal.pattern_key,
      proposed_memory_type: proposal.proposed_memory_type,
      proposed_content: proposal.proposed_content,
      status,
      confidence: proposal.confidence,
      source_count: proposal.source_count,
      distinct_days: proposal.distinct_days,
      evidence: proposal.evidence,
      first_seen: proposal.first_seen,
      last_seen: proposal.last_seen,
      updated_at: updatedAt,
    };
  });

  const { data, error } = await supabase
    .from('ai_learning_candidates')
    .upsert(rows, { onConflict: 'account_email,pattern_kind,pattern_key' })
    .select('*');
  if (error) throw new Error(error.message);
  const upserted = (data ?? []) as LearningCandidate[];

  // Auto-approve only the highest-confidence, best-evidenced candidates —
  // Vincent, 2026-09-08: "我希望AI可以自主学习...最好是在我没有在线的时
  // 候，它也能不断的在跑" (reviewing every candidate himself was too slow).
  // This does NOT remove human review — it only raises the bar past which
  // review is skipped, and stays well short of "AI silently defines a
  // person from one conversation" (the exact risk this whole
  // controlled-learning design exists to prevent, see this file's own SQL
  // migration comment, and docs/INVARIANTS.md INV-DATA-017). Both signals
  // are required, not either: confidence >= 0.9 (not just "reasonably
  // confident") AND distinct_days >= 5 (a real, sustained pattern, not a
  // couple of lucky days) — short of both, a candidate stays in the human
  // queue exactly as before, now with a one-click bulk-approve option
  // (app/ai-learning/page.tsx) so review itself is faster, not skipped.
  // Never touches a candidate a human already finalized — the upsert
  // above already preserves an existing approved/rejected/dismissed
  // status, so only observing/ready_for_review rows ever reach here.
  const results: LearningCandidate[] = [];
  for (const candidate of upserted) {
    const autoApproveEligible = !FINAL_STATUSES.has(candidate.status)
      && candidate.confidence >= AUTO_APPROVE_MIN_CONFIDENCE
      && candidate.distinct_days >= AUTO_APPROVE_MIN_DISTINCT_DAYS;
    if (!autoApproveEligible) { results.push(candidate); continue; }
    try {
      const approved = await reviewLearningCandidate({
        candidate, actorEmail: AUTO_APPROVE_ACTOR, decision: 'approve',
        note: `Auto-approved: confidence ${Math.round(candidate.confidence * 100)}% >= 90%, ${candidate.distinct_days} distinct days >= 5.`,
      });
      results.push(approved);
    } catch {
      // Auto-approval failing must never break the analysis pass itself —
      // the candidate just stays exactly as upserted, in the human queue.
      results.push(candidate);
    }
  }
  return results;
}

export async function listLearningCandidates(
  accountEmail: string,
  status?: CandidateStatus,
): Promise<LearningCandidate[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from('ai_learning_candidates')
    .select('*')
    .eq('account_email', accountEmail.trim().toLowerCase())
    .order('updated_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as LearningCandidate[];
}

export async function getLearningCandidate(id: number): Promise<LearningCandidate | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('ai_learning_candidates').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as LearningCandidate | null;
}

export type ReviewDecision = 'approve' | 'reject' | 'dismiss' | 'reopen';

export async function reviewLearningCandidate(params: {
  candidate: LearningCandidate;
  actorEmail: string;
  decision: ReviewDecision;
  content?: string;
  note?: string;
}): Promise<LearningCandidate> {
  const { candidate, actorEmail, decision } = params;
  const finalContent = (params.content?.trim() || candidate.proposed_content).slice(0, 1000);
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .rpc('review_ai_learning_candidate', {
      p_candidate_id: candidate.id,
      p_actor_email: actorEmail,
      p_decision: decision,
      p_final_content: finalContent,
      p_note: params.note?.trim().slice(0, 1000) || null,
    })
    .single();
  if (error) throw new Error(error.message);
  return data as LearningCandidate;
}
