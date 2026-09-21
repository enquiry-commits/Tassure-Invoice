import 'server-only';

import { createHash } from 'node:crypto';
import { createAdminClient } from '../supabase';
import { pageAll } from '../page-all';
import { openAIConfigured, openAIJson, openAIModel } from '../ai/openai';
import { autoApproveLearningCandidates, type LearningCandidate } from './candidates';
import type { CandidateStatus, LearningPatternKind } from './patterns';

type StoredMessage = {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

type ExtractedCandidate = {
  kind: Extract<LearningPatternKind, `conversation_${string}`>;
  memory_type: 'preference' | 'behaviour' | 'decision' | 'rejection' | 'pattern';
  canonical_key: string;
  content: string;
  confidence: number;
  evidence_message_ids: number[];
  rationale: string;
};

const FINAL_STATUSES = new Set<CandidateStatus>(['approved', 'rejected', 'dismissed']);
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /(api[_ -]?key|password|secret|token)\s*[:=]\s*\S+/gi,
  /bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
];

function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED SECRET]'), value).slice(0, 4000);
}

function singaporeDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

function patternKey(kind: string, canonicalKey: string): string {
  const normalized = canonicalKey.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 220);
  return `${kind}:${createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
}

function evidenceAdjustedConfidence(raw: number, sourceCount: number, distinctDays: number): number {
  const bounded = Math.min(0.98, Math.max(0.4, raw));
  if (sourceCount <= 1) return Math.min(0.64, bounded);
  if (distinctDays <= 1) return Math.min(0.72, bounded);
  if (distinctDays === 2) return Math.min(0.79, bounded);
  return Math.round(bounded * 100) / 100;
}

function proposalStatus(confidence: number, distinctDays: number): 'observing' | 'ready_for_review' {
  return confidence >= 0.75 && distinctDays >= 3 ? 'ready_for_review' : 'observing';
}

async function recentConversationMessages(accountEmail: string, windowDays: number): Promise<StoredMessage[]> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const conversations = await pageAll<{ id: number }>(() => supabase
    .from('ai_conversations')
    .select('id')
    .eq('account_email', accountEmail)
    .gte('updated_at', since));
  if (!conversations.length) return [];
  const ids = conversations.map(row => row.id);
  const messages = await pageAll<StoredMessage>(() => supabase
    .from('ai_messages')
    .select('id, conversation_id, role, content, created_at')
    .in('conversation_id', ids)
    .gte('created_at', since)
    .order('created_at', { ascending: true }));
  return messages.slice(-160);
}

export function shouldAnalyzeConversationNow(text: string): boolean {
  if (!openAIConfigured() || SECRET_PATTERNS.some(pattern => new RegExp(pattern.source, pattern.flags).test(text))) return false;
  return /(以后|下次|一直|每次|统一|默认|不要再|不需要|我希望|我喜欢|我偏好|我的习惯|应该这样|纠正|错了|from now on|always|every time|default|i prefer|i like|don't|do not|correction)/i.test(text);
}

export async function analyzeUserConversations(accountEmail: string, windowDays = 30): Promise<LearningCandidate[]> {
  if (!openAIConfigured()) return [];
  const email = accountEmail.trim().toLowerCase();
  const days = Math.min(Math.max(windowDays, 7), 180);
  const messages = await recentConversationMessages(email, days);
  const userMessages = messages.filter(message => message.role === 'user' && message.content.trim());
  if (!userMessages.length) return [];

  const allowedIds = new Set(userMessages.map(message => message.id));
  const messageById = new Map(userMessages.map(message => [message.id, message]));
  const transcript = messages.map(message => ({
    id: message.id,
    conversation_id: message.conversation_id,
    role: message.role,
    date_sgt: singaporeDay(message.created_at),
    content: redactSecrets(message.content),
  }));

  const extracted = await openAIJson<{ candidates: ExtractedCandidate[] }>({
    model: openAIModel('learning'),
    accountEmail: email,
    schemaName: 'conversation_learning_candidates',
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        candidates: {
          type: 'array', maxItems: 12,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['conversation_preference', 'conversation_workflow', 'conversation_correction', 'conversation_decision'] },
              memory_type: { type: 'string', enum: ['preference', 'behaviour', 'decision', 'rejection', 'pattern'] },
              canonical_key: { type: 'string' },
              content: { type: 'string' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              evidence_message_ids: { type: 'array', items: { type: 'integer' }, minItems: 1 },
              rationale: { type: 'string' },
            },
            required: ['kind', 'memory_type', 'canonical_key', 'content', 'confidence', 'evidence_message_ids', 'rationale'],
          },
        },
      },
      required: ['candidates'],
    },
    instructions: `Extract durable, useful user-learning candidates from My Tasks conversations.
Eligible: stable response-format preferences; repeated workflow habits; explicit corrections/rejections that should prevent a repeated mistake; durable operating decisions.
Never extract: passwords, API keys or secrets; personal sensitive data; emotion/personality judgments; temporary one-off requests; client/company facts; invoice amounts/status; facts already retrievable from business tools; assistant claims not stated by the user.
Evidence IDs MUST be user-role message IDs from the supplied transcript. Use multiple evidence messages when the signal repeats. A single message may be proposed but must have conservative confidence. Content must be a concise instruction/context statement in the user's language, without quoting secrets. canonical_key should describe the stable semantic topic so repeated evidence maps to the same candidate. Return no candidate when evidence is weak or temporary.`,
    input: JSON.stringify({ account_email: email, window_days: days, messages: transcript }),
    maxOutputTokens: 2600,
    timeoutMs: 55_000,
  });

  const valid = extracted.candidates.flatMap(candidate => {
    const evidenceIds = [...new Set(candidate.evidence_message_ids.filter(id => allowedIds.has(id)))];
    if (!evidenceIds.length || !candidate.content.trim() || !candidate.canonical_key.trim()) return [];
    const evidenceMessages = evidenceIds.map(id => messageById.get(id)).filter((row): row is StoredMessage => Boolean(row));
    const distinctDays = new Set(evidenceMessages.map(message => singaporeDay(message.created_at))).size;
    const confidence = evidenceAdjustedConfidence(candidate.confidence, evidenceIds.length, distinctDays);
    const dates = evidenceMessages.map(message => message.created_at).sort();
    return [{
      candidate,
      evidenceIds,
      evidenceMessages,
      distinctDays,
      confidence,
      firstSeen: dates[0],
      lastSeen: dates[dates.length - 1],
    }];
  });
  if (!valid.length) return [];

  const supabase = createAdminClient();
  const { data: existingRows, error: existingError } = await supabase
    .from('ai_learning_candidates')
    .select('pattern_kind, pattern_key, status')
    .eq('account_email', email);
  if (existingError) throw new Error(existingError.message);
  const existing = new Map(((existingRows ?? []) as Pick<LearningCandidate, 'pattern_kind' | 'pattern_key' | 'status'>[])
    .map(row => [`${row.pattern_kind}\u0000${row.pattern_key}`, row.status]));
  const updatedAt = new Date().toISOString();
  const rows = valid.map(item => {
    const key = patternKey(item.candidate.kind, item.candidate.canonical_key);
    const currentStatus = existing.get(`${item.candidate.kind}\u0000${key}`);
    return {
      account_email: email,
      pattern_kind: item.candidate.kind,
      pattern_key: key,
      proposed_memory_type: item.candidate.memory_type,
      proposed_content: item.candidate.content.trim().slice(0, 1000),
      status: currentStatus && FINAL_STATUSES.has(currentStatus) ? currentStatus : proposalStatus(item.confidence, item.distinctDays),
      confidence: item.confidence,
      source_count: item.evidenceIds.length,
      distinct_days: item.distinctDays,
      evidence: {
        generation_version: 'conversation-openai-v1',
        claim_scope: 'observed-only',
        window_days: days,
        message_ids: item.evidenceIds,
        conversation_ids: [...new Set(item.evidenceMessages.map(message => message.conversation_id))],
        sample_excerpts: item.evidenceMessages.slice(0, 5).map(message => redactSecrets(message.content).slice(0, 300)),
        rationale: item.candidate.rationale.slice(0, 500),
      },
      first_seen: item.firstSeen,
      last_seen: item.lastSeen,
      updated_at: updatedAt,
    };
  });

  const { data, error } = await supabase
    .from('ai_learning_candidates')
    .upsert(rows, { onConflict: 'account_email,pattern_kind,pattern_key' })
    .select('*');
  if (error) throw new Error(error.message);
  return autoApproveLearningCandidates((data ?? []) as LearningCandidate[]);
}

