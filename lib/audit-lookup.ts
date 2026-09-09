import 'server-only';

import { createAdminClient } from './supabase';
import { formatSgtDateTime, todaySGT } from './date';
import { normalize } from './company-name';

// Added 2026-09-09 — audit_log (4,364 real rows at the time) records
// field-level history across the system ("who changed what, from what, to
// what") and had ZERO chat coverage: "最近谁改了什么" was unanswerable.
// Distinct from recent_activity_summary, which reads each feature's own
// created_by/updated_by columns to describe what a PERSON has been doing;
// this is the field-level diff trail, and it also captures AUTOMATED
// changes (changed_by like "system:teamwork") that no other tool surfaces.
//
// audit_log stores table_name + row_id, not company names — row ids are
// resolved back to real names here so the result is readable, rather than
// handing an LLM bare numeric ids it would be tempted to describe vaguely.
export type AuditChange = {
  changedAt: string; // already Singapore-formatted
  changedBy: string;
  isAutomated: boolean;
  tableName: string;
  companyName: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

export type RecentChangesResult = {
  rangeDays: number;
  totalInRange: number;
  humanChanges: number;
  automatedChanges: number;
  byPerson: { changedBy: string; count: number }[];
  changes: AuditChange[];
};

export async function getRecentChanges(opts: { days?: number; humanOnly?: boolean; company?: string; limit?: number } = {}): Promise<RecentChangesResult> {
  const sb = createAdminClient();
  const rangeDays = opts.days && opts.days > 0 ? Math.min(opts.days, 365) : 7;
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const since = new Date(new Date(`${todaySGT()}T00:00:00+08:00`).getTime() - (rangeDays - 1) * 86_400_000).toISOString();

  // Real totals come from COUNT queries, never from the length of the
  // detail fetch below — that fetch is capped, and a first version reported
  // its cap (exactly 1000) as if it were the true number of changes.
  const [{ count: totalCount }, { count: automatedCount }, { data }] = await Promise.all([
    sb.from('audit_log').select('*', { count: 'exact', head: true }).gte('changed_at', since),
    sb.from('audit_log').select('*', { count: 'exact', head: true }).gte('changed_at', since).like('changed_by', 'system:%'),
    sb.from('audit_log')
      .select('table_name, row_id, field, old_value, new_value, changed_by, changed_at')
      .gte('changed_at', since)
      .order('changed_at', { ascending: false })
      .limit(1000),
  ]);
  let rows = data ?? [];
  const totalInRange = totalCount ?? rows.length;
  const automatedInRange = automatedCount ?? 0;

  // Resolve row ids -> company names, per table (master_list is the only
  // table wired into logFieldChange so far; others degrade to a null name
  // rather than guessing).
  const masterIds = [...new Set(rows.filter(r => r.table_name === 'master_list').map(r => r.row_id as number))];
  const nameById = new Map<number, string>();
  if (masterIds.length) {
    for (let i = 0; i < masterIds.length; i += 300) {
      const { data: ml } = await sb.from('master_list').select('id, company_name').in('id', masterIds.slice(i, i + 300));
      for (const m of ml ?? []) nameById.set(m.id as number, m.company_name as string);
    }
  }

  if (opts.company && opts.company.trim()) {
    const q = normalize(opts.company);
    rows = rows.filter(r => {
      const name = r.table_name === 'master_list' ? nameById.get(r.row_id as number) : null;
      return !!name && normalize(name).includes(q);
    });
  }

  const isAutomated = (by: unknown) => typeof by === 'string' && by.startsWith('system:');
  const humanRows = rows.filter(r => !isAutomated(r.changed_by));
  const filtered = opts.humanOnly ? humanRows : rows;

  const personCounts = new Map<string, number>();
  for (const r of filtered) {
    const by = (r.changed_by as string | null) ?? '(unknown)';
    personCounts.set(by, (personCounts.get(by) ?? 0) + 1);
  }

  return {
    rangeDays,
    totalInRange,
    humanChanges: totalInRange - automatedInRange,
    automatedChanges: automatedInRange,
    byPerson: [...personCounts.entries()].map(([changedBy, count]) => ({ changedBy, count })).sort((a, b) => b.count - a.count),
    changes: filtered.slice(0, limit).map(r => ({
      changedAt: formatSgtDateTime(r.changed_at as string),
      changedBy: (r.changed_by as string | null) ?? '(unknown)',
      isAutomated: isAutomated(r.changed_by),
      tableName: r.table_name as string,
      companyName: r.table_name === 'master_list' ? (nameById.get(r.row_id as number) ?? null) : null,
      field: r.field as string,
      oldValue: (r.old_value as string | null) ?? null,
      newValue: (r.new_value as string | null) ?? null,
    })),
  };
}
