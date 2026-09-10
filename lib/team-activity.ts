import 'server-only';
import { createAdminClient } from '@/lib/supabase';
import { todaySGT, formatSgtDateTime } from '@/lib/date';
import { getApprovedAccount } from '@/lib/approved-accounts';

/**
 * What the TEAM actually did, over a window — 2026-09-10.
 *
 * Why this exists: asked "今天大家做了什么", the assistant could only reach
 * two company-wide sources — `audit_log` (field-level changes, frequently
 * all-automated) and page-view counts — so it kept answering with a table
 * of clicks. Vincent, correctly: "这个更新过后回答到更加敷衍和不仔细了...
 * 重点的是我要知道其他人真正在干嘛 做了什么". The rich data — invoices
 * generated, AR cycles moved, campaigns created, client emails sent,
 * Master List and Trademark edits, Post Incorporate documents — already
 * existed, but only one person at a time (lib/recent-activity.ts). There
 * was no team view. That was a missing capability, not a wording problem,
 * and no amount of prompt guidance could have fixed it.
 *
 * Two deliberate behaviours:
 *  - `excludeEmail` drops the ASKER. A management account asking what the
 *    team did does not mean itself (Vincent: "我自己根本都不需要出现在这些
 *    记录内，我已经是最大管理员了，目的是观察其他人").
 *  - Page views are not included at all. A visit is not work; that question
 *    has its own tool (active_users_today) and must not be blended in here.
 */

export type TeamActivityKind =
  | 'invoice' | 'ar_edit' | 'campaign' | 'email_sent'
  | 'master_list_edit' | 'post_incorporate' | 'trademark_edit' | 'soa_owner';

const KIND_LABEL: Record<TeamActivityKind, string> = {
  invoice: 'Generated invoice',
  ar_edit: 'Updated AR Reminder',
  campaign: 'Created email campaign',
  email_sent: 'Sent client email',
  master_list_edit: 'Updated Master List',
  post_incorporate: 'Generated Post Incorporate docs',
  trademark_edit: 'Updated Trademark record',
  soa_owner: 'Set SOA owner',
};

export type TeamActivityItem = {
  at: string;          // already SGT-formatted for reading
  email: string;
  person: string;      // resolved staff name, or the email when unknown
  kind: TeamActivityKind;
  label: string;
  detail: string;      // which company / which invoice
};

export type TeamActivityResult = {
  rangeDays: number;
  today: string;
  excluded: string | null;
  totalItems: number;
  byPerson: { person: string; email: string; total: number; kinds: { label: string; count: number }[]; latest: string }[];
  items: TeamActivityItem[];
  quiet: boolean; // no PERSON produced anything in the window
  automatedItems: number; // filtered-out sync/backfill writes, for honesty about a quiet day
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// Automated writers, not people. These appear in the very same
// updated_by_email columns staff do — confirmed live: 'system:teamwork',
// 'system:late-filing' and 'backfill@internal' otherwise showed up in the
// team list as if they were colleagues, and 'backfill@internal' alone
// accounted for 199 of 263 items over a week. Attributing a nightly sync to
// a person is worse than showing nothing.
const isAutomated = (email: string) => email.startsWith('system:') || email.endsWith('@internal');

export async function getTeamActivity(rangeDays = 1, excludeEmail?: string | null, limit = 60): Promise<TeamActivityResult> {
  const sb = createAdminClient();
  const days = Math.min(Math.max(rangeDays, 1), 90);
  // SGT calendar window: days=1 means today in Singapore, not a rolling 24h.
  const since = new Date(new Date(`${todaySGT()}T00:00:00+08:00`).getTime() - (days - 1) * 86_400_000).toISOString();
  const cap = 200;

  const [invoices, arEdits, campaigns, sentEmails, masterList, postInc, trademarks, soaOwners] = await Promise.all([
    sb.from('generated_invoices').select('company_name, qb_company, invoice_no, total_amt, created_at, created_by_email').gte('created_at', since).limit(cap),
    sb.from('ar_reminder').select('entity_name, fye_month, fye_year, updated_at, updated_by_email').gte('updated_at', since).limit(cap),
    sb.from('email_campaigns').select('type, name, created_at, created_by_email').gte('created_at', since).limit(cap),
    sb.from('email_drafts').select('company_name, sent_at, sent_by_email').gte('sent_at', since).not('sent_at', 'is', null).limit(cap),
    sb.from('master_list').select('company_name, updated_at, updated_by_email').gte('updated_at', since).limit(cap),
    sb.from('post_incorporate_operations').select('company_name, created_at, created_by_email').gte('created_at', since).limit(cap),
    sb.from('trademark_records').select('company_name, updated_at, updated_by_email').gte('updated_at', since).limit(cap),
    sb.from('soa_owners').select('customer_name, updated_at, updated_by_email').gte('updated_at', since).limit(cap),
  ]);

  const items: TeamActivityItem[] = [];
  let automatedItems = 0;
  const push = (rows: Row[] | null, atKey: string, byKey: string, kind: TeamActivityKind, detail: (r: Row) => string) => {
    for (const r of rows ?? []) {
      const at = str(r[atKey]);
      const email = str(r[byKey]).toLowerCase();
      // No recorded author means an automated sync wrote it — that is not a
      // person's work and must never be attributed to one.
      if (!at || !email) continue;
      if (isAutomated(email)) { automatedItems += 1; continue; }
      if (excludeEmail && email === excludeEmail.toLowerCase()) continue;
      items.push({
        at, email,
        person: getApprovedAccount(email)?.name ?? email,
        kind, label: KIND_LABEL[kind], detail: detail(r),
      });
    }
  };

  push(invoices.data as Row[], 'created_at', 'created_by_email', 'invoice',
    r => `${str(r.company_name)} · ${str(r.qb_company)} #${str(r.invoice_no)}${r.total_amt ? ` · S$${Number(r.total_amt).toLocaleString()}` : ''}`);
  push(arEdits.data as Row[], 'updated_at', 'updated_by_email', 'ar_edit',
    r => `${str(r.entity_name)}${r.fye_month ? ` · FYE ${str(r.fye_month)} ${str(r.fye_year)}` : ''}`);
  push(campaigns.data as Row[], 'created_at', 'created_by_email', 'campaign',
    r => `${str(r.name)} (${str(r.type)})`);
  push(sentEmails.data as Row[], 'sent_at', 'sent_by_email', 'email_sent', r => str(r.company_name));
  push(masterList.data as Row[], 'updated_at', 'updated_by_email', 'master_list_edit', r => str(r.company_name));
  push(postInc.data as Row[], 'created_at', 'created_by_email', 'post_incorporate', r => str(r.company_name));
  push(trademarks.data as Row[], 'updated_at', 'updated_by_email', 'trademark_edit', r => str(r.company_name));
  push(soaOwners.data as Row[], 'updated_at', 'updated_by_email', 'soa_owner', r => str(r.customer_name));

  items.sort((a, b) => b.at.localeCompare(a.at));

  const byEmail = new Map<string, { person: string; email: string; total: number; kinds: Map<string, number>; latest: string }>();
  for (const it of items) {
    const e = byEmail.get(it.email) ?? { person: it.person, email: it.email, total: 0, kinds: new Map<string, number>(), latest: it.at };
    e.total += 1;
    e.kinds.set(it.label, (e.kinds.get(it.label) ?? 0) + 1);
    if (it.at > e.latest) e.latest = it.at;
    byEmail.set(it.email, e);
  }

  return {
    rangeDays: days,
    today: todaySGT(),
    excluded: excludeEmail ?? null,
    totalItems: items.length,
    byPerson: [...byEmail.values()]
      .sort((a, b) => b.total - a.total)
      .map(e => ({
        person: e.person, email: e.email, total: e.total,
        kinds: [...e.kinds.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
        latest: formatSgtDateTime(e.latest),
      })),
    items: items.slice(0, limit).map(i => ({ ...i, at: formatSgtDateTime(i.at) })),
    quiet: items.length === 0,
    automatedItems,
  };
}
