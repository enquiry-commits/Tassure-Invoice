import 'server-only';

import { createAdminClient } from './supabase';

// Real "what has this person actually done" timeline, built from the
// audit-trail columns that already exist across the system (created_by_
// email / updated_by_email / sent_by_email) — NOT the same thing as
// user_activity_events (lib/activity-data.ts), which only records page
// views and a handful of hand-picked key actions starting 2026-09-08 and
// has no history before that. This instead reaches back through every
// table that already recorded "who did this" as a normal side effect of
// the feature itself (invoicing, AR edits, campaigns, Master List edits,
// sent emails, Post Incorporate, Trademark, SOA owner picks) — real
// history going back as far as that feature's own launch, not just today.
//
// Added 2026-09-08 — Vincent, on the "View as: Chelsea Ang" screen showing
// 0 tasks despite her using the system daily: "Chelsea 已经使用这个系统蛮
// 长时间了的，结果你还是只判断到 AR 和 LATE，而没有真正了解到...我们的员
// 工在做什么". A real check against live data (before this was built)
// found her real footprint completely invisible to My Tasks: 89 generated
// invoices, 41 real AR Reminder edits, 95 email campaigns — none of it
// AR-Reminder-PIC-shaped, so My Tasks' existing "is this row mine" lens
// never saw any of it. Confirmed via the same check that OTHER staff
// (Lim Hoe Chyi / Ang Shi Ming / Chin Kah Ye) have a genuinely different
// shape of footprint (mostly AR Reminder + Master List edits, not
// invoicing) — this module is deliberately generic across ALL of these
// sources rather than hardcoded to any one person's pattern.
//
// Vincent, same conversation, asked whether this needs the Anthropic API
// (ANTHROPIC_API_KEY): it does NOT — this is plain SQL aggregation, no LLM
// involved, same as Activity Insights' own top-pages/top-actions lists.
// Real Claude reasoning (when the key is set) would add VALUE on top of
// this — turning the raw list into an interpreted narrative — but the
// facts themselves are just database queries.
export type ActivityItem = {
  at: string; // ISO timestamp
  kind: 'invoice' | 'ar_edit' | 'campaign' | 'master_list_edit' | 'email_sent' | 'post_incorporate' | 'trademark_edit' | 'soa_owner';
  label: string;
  detail: string;
};

const KIND_LABEL: Record<ActivityItem['kind'], string> = {
  invoice: 'Generated invoice',
  ar_edit: 'Updated AR Reminder',
  campaign: 'Created email campaign',
  master_list_edit: 'Updated Master List',
  email_sent: 'Sent client email',
  post_incorporate: 'Generated Post Incorporate docs',
  trademark_edit: 'Updated Trademark record',
  soa_owner: 'Set SOA owner',
};

export async function getRecentActivity(email: string, limit = 25): Promise<ActivityItem[]> {
  const sb = createAdminClient();
  const perSourceCap = limit; // each source is capped at `limit` before the merge/sort/slice below, so the final cap is never short a source that happens to sort last within its own table
  const [invoices, arEdits, campaigns, masterListEdits, sentEmails, postIncorporate, trademarks, soaOwners] = await Promise.all([
    sb.from('generated_invoices').select('company_name, qb_company, total_amt, created_at')
      .eq('created_by_email', email).order('created_at', { ascending: false }).limit(perSourceCap),
    sb.from('ar_reminder').select('entity_name, updated_at')
      .eq('updated_by_email', email).order('updated_at', { ascending: false }).limit(perSourceCap),
    sb.from('email_campaigns').select('type, name, created_at')
      .eq('created_by_email', email).order('created_at', { ascending: false }).limit(perSourceCap),
    sb.from('master_list').select('company_name, updated_at')
      .eq('updated_by_email', email).order('updated_at', { ascending: false }).limit(perSourceCap),
    sb.from('email_drafts').select('company_name, sent_at')
      .eq('sent_by_email', email).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(perSourceCap),
    sb.from('post_incorporate_operations').select('company_name, created_at')
      .eq('created_by_email', email).order('created_at', { ascending: false }).limit(perSourceCap),
    sb.from('trademark_records').select('company_name, updated_at')
      .eq('updated_by_email', email).order('updated_at', { ascending: false }).limit(perSourceCap),
    sb.from('soa_owners').select('customer_name, updated_at')
      .eq('updated_by_email', email).order('updated_at', { ascending: false }).limit(perSourceCap),
  ]);

  const items: ActivityItem[] = [];
  for (const r of invoices.data ?? []) {
    if (!r.created_at) continue;
    items.push({ at: r.created_at, kind: 'invoice', label: KIND_LABEL.invoice, detail: `${r.company_name} (${r.qb_company}) — $${r.total_amt ?? 0}` });
  }
  for (const r of arEdits.data ?? []) {
    if (!r.updated_at) continue;
    items.push({ at: r.updated_at, kind: 'ar_edit', label: KIND_LABEL.ar_edit, detail: r.entity_name });
  }
  for (const r of campaigns.data ?? []) {
    if (!r.created_at) continue;
    items.push({ at: r.created_at, kind: 'campaign', label: KIND_LABEL.campaign, detail: r.name || r.type });
  }
  for (const r of masterListEdits.data ?? []) {
    if (!r.updated_at) continue;
    items.push({ at: r.updated_at, kind: 'master_list_edit', label: KIND_LABEL.master_list_edit, detail: r.company_name ?? '(unnamed)' });
  }
  for (const r of sentEmails.data ?? []) {
    if (!r.sent_at) continue;
    items.push({ at: r.sent_at, kind: 'email_sent', label: KIND_LABEL.email_sent, detail: r.company_name ?? '(unnamed)' });
  }
  for (const r of postIncorporate.data ?? []) {
    if (!r.created_at) continue;
    items.push({ at: r.created_at, kind: 'post_incorporate', label: KIND_LABEL.post_incorporate, detail: r.company_name ?? '(unnamed)' });
  }
  for (const r of trademarks.data ?? []) {
    if (!r.updated_at) continue;
    items.push({ at: r.updated_at, kind: 'trademark_edit', label: KIND_LABEL.trademark_edit, detail: r.company_name || '(unnamed)' });
  }
  for (const r of soaOwners.data ?? []) {
    if (!r.updated_at) continue;
    items.push({ at: r.updated_at, kind: 'soa_owner', label: KIND_LABEL.soa_owner, detail: r.customer_name });
  }

  items.sort((a, b) => +new Date(b.at) - +new Date(a.at));
  return items.slice(0, limit);
}

// A compact per-source count digest — for the assistant's recent_activity_
// summary tool, which shouldn't dump 25 raw rows into a chat reply; a
// "what has this person mostly been doing" shape is more useful there than
// a full timeline (the full timeline is what My Tasks' own Activity tab
// shows instead).
export function summarizeByKind(items: ActivityItem[]): { kind: ActivityItem['kind']; label: string; count: number }[] {
  const counts = new Map<ActivityItem['kind'], number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, label: KIND_LABEL[kind], count }))
    .sort((a, b) => b.count - a.count);
}
