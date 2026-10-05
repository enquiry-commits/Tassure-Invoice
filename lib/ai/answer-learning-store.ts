import 'server-only';

import { after } from 'next/server';
import { createAdminClient } from '../supabase';
import { compactEvidence, EVIDENCE_RETENTION_DAYS, pickActiveGuidance, type EvidenceItem, type GuidanceRule } from './answer-learning';

// The learning loop's database side (docs/INVARIANTS.md INV-AI-012; tables
// from scripts/add-ai-answer-learning.sql). Every function here degrades to
// "nothing happens" when its table doesn't exist yet, so this code is safe to
// deploy before the SQL is run — the same pattern as the AI usage ledger.

const MISSING_TABLE = new Set(['PGRST205', '42P01']);
const GUIDANCE_CACHE_MS = 60_000;
let guidanceCache: { at: number; rules: GuidanceRule[] } | null = null;

// The rules the assistant should see right now. Fails CLOSED: if the master
// switch can't be read or is off, no guidance is applied. Cached per server
// instance for 60s, so turning the switch off takes effect within a minute.
export async function loadAnswerGuidance(): Promise<GuidanceRule[]> {
  if (guidanceCache && Date.now() - guidanceCache.at < GUIDANCE_CACHE_MS) return guidanceCache.rules;
  let rules: GuidanceRule[] = [];
  try {
    const supabase = createAdminClient();
    const now = new Date();
    const [switchRes, rulesRes] = await Promise.all([
      supabase.from('ai_guidance_switch').select('enabled').eq('id', 1).maybeSingle(),
      supabase.from('ai_answer_guidance')
        .select('id, rule_text, category, status, expires_at, created_at')
        .eq('status', 'active')
        .gt('expires_at', now.toISOString())
        .order('created_at', { ascending: true })
        .limit(20),
    ]);
    if (!switchRes.error && switchRes.data?.enabled === true && !rulesRes.error) {
      rules = pickActiveGuidance((rulesRes.data ?? []) as GuidanceRule[], now);
    }
  } catch {
    rules = [];
  }
  guidanceCache = { at: Date.now(), rules };
  return rules;
}

// What a reply was built from, in its OWN table, written after the reply is
// sent — never as a column on the ai_agent_runs insert: recordAgentRun()
// returns null on ANY insert error, the reply would lose its agent_run_id,
// and the quality judge would silently never see it. Never throws.
export function trackTurnEvidence(row: { agentRunId: number; accountEmail: string; toolEvidence: EvidenceItem[]; guidanceIds: number[] }): void {
  const work = (async () => {
    try {
      const { error } = await createAdminClient().from('ai_turn_evidence').insert({
        agent_run_id: row.agentRunId,
        account_email: row.accountEmail,
        tool_evidence: compactEvidence(row.toolEvidence),
        guidance_ids: row.guidanceIds,
      });
      if (error && !MISSING_TABLE.has(error.code ?? '')) console.error('[ai-evidence] not recorded:', error.message);
    } catch (error) {
      console.error('[ai-evidence] not recorded:', error instanceof Error ? error.message : error);
    }
  })();
  try {
    after(work);
  } catch {
    // not inside a request — the write still runs on its own
  }
}

// Evidence is kept 30 days (Vincent, 2026-10-05: "存 30 天"). Run nightly by
// /api/ai-quality/review. Returns how many rows went, or null if the table
// isn't there yet.
export async function purgeOldTurnEvidence(now = new Date()): Promise<number | null> {
  const cutoff = new Date(now.getTime() - EVIDENCE_RETENTION_DAYS * 86_400_000).toISOString();
  const { data, error } = await createAdminClient().from('ai_turn_evidence').delete().lt('created_at', cutoff).select('agent_run_id');
  if (error) {
    if (MISSING_TABLE.has(error.code ?? '')) return null;
    throw new Error(`Cannot purge ai_turn_evidence: ${error.message}`);
  }
  return (data ?? []).length;
}
