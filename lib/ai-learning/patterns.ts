export type LearnableActivityEvent = {
  id: number;
  account_email: string;
  pathname: string;
  event_type: string;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type LearningPatternKind = 'frequent_page' | 'frequent_action';
export type CandidateStatus = 'observing' | 'ready_for_review' | 'approved' | 'rejected' | 'dismissed';

export type PatternEvidence = {
  generation_version: 'deterministic-v1';
  claim_scope: 'observed-only';
  window_days: number;
  raw_count: number;
  effective_count: number;
  distinct_days: number;
  sample_event_ids: number[];
  sample_details?: (Record<string, unknown> | null)[];
};

export type PatternProposal = {
  account_email: string;
  pattern_kind: LearningPatternKind;
  pattern_key: string;
  proposed_memory_type: 'behaviour' | 'pattern';
  proposed_content: string;
  recommended_status: Extract<CandidateStatus, 'observing' | 'ready_for_review'>;
  confidence: number;
  source_count: number;
  distinct_days: number;
  evidence: PatternEvidence;
  first_seen: string;
  last_seen: string;
};

const PAGE_REPEAT_WINDOW_MS = 30 * 60 * 1000;

function singaporeDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function roundConfidence(value: number): number {
  return Math.round(Math.min(0.95, Math.max(0, value)) * 100) / 100;
}

function pageConfidence(count: number, days: number): number {
  return roundConfidence(0.45 + Math.min(0.25, count * 0.025) + Math.min(0.2, days * 0.025));
}

function actionConfidence(count: number, days: number): number {
  return roundConfidence(0.45 + Math.min(0.25, count * 0.04) + Math.min(0.2, days * 0.035));
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.trim().split(/[?#]/, 1)[0];
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function collapseRepeatedPageViews(events: LearnableActivityEvent[]): LearnableActivityEvent[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const kept: LearnableActivityEvent[] = [];
  let previousAt = Number.NEGATIVE_INFINITY;
  for (const event of sorted) {
    const at = Date.parse(event.created_at);
    if (!Number.isFinite(at)) continue;
    if (at - previousAt >= PAGE_REPEAT_WINDOW_MS) {
      kept.push(event);
      previousAt = at;
    }
  }
  return kept;
}

function proposalStatus(confidence: number, distinctDays: number): 'observing' | 'ready_for_review' {
  return confidence >= 0.75 && distinctDays >= 3 ? 'ready_for_review' : 'observing';
}

export function detectActivityPatterns(
  events: LearnableActivityEvent[],
  options: { accountEmail: string; windowDays?: number; now?: Date },
): PatternProposal[] {
  const accountEmail = options.accountEmail.trim().toLowerCase();
  const windowDays = Math.min(Math.max(options.windowDays ?? 30, 7), 180);
  const now = options.now ?? new Date();
  const since = now.getTime() - windowDays * 86_400_000;
  const relevant = events.filter(event => (
    event.account_email.trim().toLowerCase() === accountEmail
    && Number.isFinite(Date.parse(event.created_at))
    && Date.parse(event.created_at) >= since
    && Date.parse(event.created_at) <= now.getTime()
  ));

  const pageGroups = new Map<string, LearnableActivityEvent[]>();
  const actionGroups = new Map<string, LearnableActivityEvent[]>();

  for (const event of relevant) {
    if (event.event_type === 'page_view') {
      const key = normalizePath(event.pathname);
      pageGroups.set(key, [...(pageGroups.get(key) ?? []), event]);
    } else {
      const key = event.event_type.trim().slice(0, 100);
      if (key) actionGroups.set(key, [...(actionGroups.get(key) ?? []), event]);
    }
  }

  const proposals: PatternProposal[] = [];

  for (const [pathname, rawEvents] of pageGroups) {
    const effectiveEvents = collapseRepeatedPageViews(rawEvents);
    const distinctDays = new Set(effectiveEvents.map(event => singaporeDate(event.created_at))).size;
    if (effectiveEvents.length < 5 || distinctDays < 3) continue;
    const sorted = [...effectiveEvents].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const confidence = pageConfidence(effectiveEvents.length, distinctDays);
    proposals.push({
      account_email: accountEmail,
      pattern_kind: 'frequent_page',
      pattern_key: pathname,
      proposed_memory_type: 'behaviour',
      proposed_content: `Repeatedly visits ${pathname} (${effectiveEvents.length} separate sessions across ${distinctDays} days in the last ${windowDays} days).`,
      recommended_status: proposalStatus(confidence, distinctDays),
      confidence,
      source_count: effectiveEvents.length,
      distinct_days: distinctDays,
      evidence: {
        generation_version: 'deterministic-v1', claim_scope: 'observed-only', window_days: windowDays,
        raw_count: rawEvents.length, effective_count: effectiveEvents.length, distinct_days: distinctDays,
        sample_event_ids: sorted.slice(-20).map(event => event.id),
      },
      first_seen: sorted[0].created_at,
      last_seen: sorted.at(-1)!.created_at,
    });
  }

  for (const [eventType, groupedEvents] of actionGroups) {
    const distinctDays = new Set(groupedEvents.map(event => singaporeDate(event.created_at))).size;
    if (groupedEvents.length < 3 || distinctDays < 2) continue;
    const sorted = [...groupedEvents].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const confidence = actionConfidence(groupedEvents.length, distinctDays);
    proposals.push({
      account_email: accountEmail,
      pattern_kind: 'frequent_action',
      pattern_key: eventType,
      proposed_memory_type: 'pattern',
      proposed_content: `Repeatedly performs ${eventType} (${groupedEvents.length} recorded actions across ${distinctDays} days in the last ${windowDays} days).`,
      recommended_status: proposalStatus(confidence, distinctDays),
      confidence,
      source_count: groupedEvents.length,
      distinct_days: distinctDays,
      evidence: {
        generation_version: 'deterministic-v1', claim_scope: 'observed-only', window_days: windowDays,
        raw_count: groupedEvents.length, effective_count: groupedEvents.length, distinct_days: distinctDays,
        sample_event_ids: sorted.slice(-20).map(event => event.id),
        sample_details: sorted.slice(-5).map(event => event.detail),
      },
      first_seen: sorted[0].created_at,
      last_seen: sorted.at(-1)!.created_at,
    });
  }

  return proposals.sort((a, b) => b.confidence - a.confidence || b.source_count - a.source_count);
}
