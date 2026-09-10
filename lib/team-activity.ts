import 'server-only';
import { createAdminClient } from '@/lib/supabase';
import { todaySGT, formatSgtDateTime } from '@/lib/date';
import { getApprovedAccount } from '@/lib/approved-accounts';

/**
 * What the TEAM actually did, over a window.
 *
 * v1 (2026-09-10) answered "今天大家做了什么" with the real work rather than
 * page-view counts, but only at the level of "updated AR Reminder". Vincent:
 * "这些可以优化到更细的层面吗？整个 Master List 和 AR / BILLING / SOA" —
 * he wants the field-level "changed WHICH field from WHAT to WHAT".
 *
 * That detail already exists, in two places nothing here was reading:
 *  - `ar_reminder_audit` — DB triggers write every AR field edit here
 *    (field_name / old_value / new_value / changed_by_*), NOT to audit_log,
 *    which is why recent_changes never saw a human AR edit.
 *  - `audit_log` — the Master List and Trademark PATCH endpoints call
 *    logFieldChange(), so their field-level diffs land here.
 * Invoices, sent emails, campaigns and Post Incorporate docs are creations,
 * not field edits — their own tables already carry the useful detail
 * (invoice number, amount, campaign name), so those stay as they were.
 *
 * Unchanged from v1: `excludeEmail` drops the asker (a manager asking what
 * the team did does not mean themselves), and page views are never mixed in.
 */

export type TeamActivityKind =
  | 'invoice' | 'ar_edit' | 'campaign' | 'email_sent'
  | 'master_list_edit' | 'post_incorporate' | 'trademark_edit' | 'soa_owner';

const KIND_LABEL: Record<TeamActivityKind, string> = {
  invoice: 'Generated invoice',
  ar_edit: 'AR Reminder',
  campaign: 'Created email campaign',
  email_sent: 'Sent client email',
  master_list_edit: 'Master List',
  post_incorporate: 'Generated Post Incorporate docs',
  trademark_edit: 'Trademark record',
  soa_owner: 'Set SOA owner',
};

// Field name -> what a person calls it. Anything unmapped falls back to the
// raw column name so a newly added field still shows, just less prettily.
const AR_FIELD_LABEL: Record<string, string> = {
  prepared_date: 'Report Ready', sent_date: 'Sent to client', received_date: 'Received back',
  agm_held_date: 'AGM held', date_of_agm: 'AGM date', filling_date: 'AR Filed',
  pic: 'SEC PIC', acc_pic: 'ACC PIC', tax_pic: 'TAX PIC',
  xbrl: 'XBRL', software_update: 'TW update', ond_ron: 'ROND / RONS', dpo: 'DPO',
  remarks: 'Remarks', billing_remarks: 'Billing remarks', accounts_status: 'Billing remarks',
  reminder_note: 'Reminder', ar_status: 'AR status', annual_return: 'Annual Return',
};
const ML_FIELD_LABEL: Record<string, string> = {
  last_agm_date: 'Last AGM', last_ar_date: 'Last AR', last_accounts_date: 'Last Accounts',
  next_agm_due_date: 'Next AGM Due', remark: 'Remark', grade: 'Grade', risk_level: 'Risk',
  status: 'Status', secretary: 'Secretary', nominee_director: 'Nominee Director',
  fye: 'FYE', invoice_address: 'Invoice address', email: 'Email', internal_code: 'Code',
  join_date: 'Join date', annual_return: 'Annual Return', referral: 'Referral',
  acc_pic_override: 'ACC PIC', tax_pic_override: 'TAX PIC', mas: 'MAS', kyc_year: 'KYC year',
};
const TM_FIELD_LABEL: Record<string, string> = {
  mark_expired_date: 'Expiry date', status_text: 'Status', updates_note: 'Progress note', remarks: 'Remarks',
};

export type TeamActivityChange = { field: string; from: string | null; to: string | null };

export type TeamActivityItem = {
  at: string;          // SGT-formatted
  email: string;
  person: string;
  kind: TeamActivityKind;
  label: string;
  target: string;      // the company / customer / invoice this is about
  // Field-level detail when we have it (AR / Master List / Trademark edits).
  // Empty for creations, where `target` already says everything useful.
  changes: TeamActivityChange[];
  detail: string;      // one-line human summary, target + changes folded in
};

export type TeamActivityResult = {
  rangeDays: number;
  today: string;
  excluded: string | null;
  totalItems: number;
  byPerson: {
    person: string; email: string; total: number;
    kinds: { label: string; count: number }[];
    latest: string;
  }[];
  items: TeamActivityItem[];
  quiet: boolean;
  automatedItems: number;
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const isAutomated = (email: string) => email.startsWith('system:') || email.endsWith('@internal');

// "X → Y", "set to Y", or "cleared" — the shape a person reads a diff in.
function changeText(c: TeamActivityChange): string {
  const from = c.from?.trim() || null;
  const to = c.to?.trim() || null;
  if (from && to) return `${c.field} ${from} → ${to}`;
  if (to) return `${c.field} → ${to}`;
  return `${c.field} cleared`;
}

export async function getTeamActivity(rangeDays = 1, excludeEmail?: string | null, limit = 80): Promise<TeamActivityResult> {
  const sb = createAdminClient();
  const days = Math.min(Math.max(rangeDays, 1), 90);
  const since = new Date(new Date(`${todaySGT()}T00:00:00+08:00`).getTime() - (days - 1) * 86_400_000).toISOString();
  const cap = 400;
  const exclude = excludeEmail?.toLowerCase() ?? null;

  const [invoices, arAudit, auditLog, campaigns, sentEmails, postInc, soaOwners] = await Promise.all([
    sb.from('generated_invoices').select('company_name, qb_company, invoice_no, total_amt, created_at, created_by_email').gte('created_at', since).limit(cap),
    sb.from('ar_reminder_audit').select('entity_name, field_name, old_value, new_value, changed_by_email, changed_by_name, changed_at').gte('changed_at', since).order('changed_at', { ascending: false }).limit(cap),
    sb.from('audit_log').select('table_name, row_id, field, old_value, new_value, changed_by, changed_at').in('table_name', ['master_list', 'trademark_records']).gte('changed_at', since).order('changed_at', { ascending: false }).limit(cap),
    sb.from('email_campaigns').select('type, name, created_at, created_by_email').gte('created_at', since).limit(cap),
    sb.from('email_drafts').select('company_name, sent_at, sent_by_email').gte('sent_at', since).not('sent_at', 'is', null).limit(cap),
    sb.from('post_incorporate_operations').select('company_name, created_at, created_by_email').gte('created_at', since).limit(cap),
    sb.from('soa_owners').select('customer_name, soa_pic, qb_company, updated_at, updated_by_email').gte('updated_at', since).limit(cap),
  ]);

  // audit_log stores only row_id — resolve the ones we actually saw to names.
  const mlIds = new Set<number>();
  const tmIds = new Set<number>();
  for (const r of auditLog.data ?? []) {
    const id = Number((r as Row).row_id);
    if (!Number.isFinite(id)) continue;
    if ((r as Row).table_name === 'master_list') mlIds.add(id);
    else tmIds.add(id);
  }
  const [mlNames, tmNames] = await Promise.all([
    mlIds.size ? sb.from('master_list').select('id, company_name').in('id', [...mlIds]).then(r => r.data ?? []) : Promise.resolve([]),
    tmIds.size ? sb.from('trademark_records').select('id, company_name, application_number').in('id', [...tmIds]).then(r => r.data ?? []) : Promise.resolve([]),
  ]);
  const mlNameById = new Map<number, string>((mlNames as Row[]).map(r => [Number(r.id), str(r.company_name)]));
  const tmNameById = new Map<number, string>((tmNames as Row[]).map(r => [Number(r.id), `${str(r.company_name)}${r.application_number ? ` (${str(r.application_number)})` : ''}`]));

  let automatedItems = 0;
  const items: TeamActivityItem[] = [];

  const add = (at: string, email: string, kind: TeamActivityKind, target: string, changes: TeamActivityChange[], detail: string) => {
    if (!at || !email) { automatedItems += 1; return; }
    const e = email.toLowerCase();
    if (isAutomated(e)) { automatedItems += 1; return; }
    if (exclude && e === exclude) return;
    items.push({ at, email: e, person: getApprovedAccount(e)?.name ?? e, kind, label: KIND_LABEL[kind], target, changes, detail });
  };

  // ── AR Reminder: one audit row per field. Collapse a burst of edits to
  //    the SAME company by the SAME person within a short window into one
  //    item, so "filled in 6 fields on SILVER RIVER" reads as one action.
  const arRows = (arAudit.data ?? []) as Row[];
  const arGroups = new Map<string, { at: string; email: string; name: string; entity: string; changes: TeamActivityChange[] }>();
  for (const r of arRows) {
    const at = str(r.changed_at);
    const email = str(r.changed_by_email).toLowerCase();
    if (!at || !email || isAutomated(email)) { if (!email || isAutomated(email)) automatedItems += 1; continue; }
    const bucket = `${email}|${str(r.entity_name)}|${at.slice(0, 16)}`; // minute precision
    const g = arGroups.get(bucket) ?? { at, email, name: str(r.changed_by_name), entity: str(r.entity_name), changes: [] };
    g.changes.push({
      field: AR_FIELD_LABEL[str(r.field_name)] ?? str(r.field_name),
      from: r.old_value == null ? null : str(r.old_value),
      to: r.new_value == null ? null : str(r.new_value),
    });
    if (at > g.at) g.at = at;
    arGroups.set(bucket, g);
  }
  for (const g of arGroups.values()) {
    add(g.at, g.email, 'ar_edit', g.entity, g.changes,
      `${g.entity} — ${g.changes.map(changeText).join(', ')}`);
  }

  // ── Master List + Trademark from audit_log (already field-level).
  for (const r of (auditLog.data ?? []) as Row[]) {
    const at = str(r.changed_at);
    const by = str(r.changed_by).toLowerCase();
    if (!at || !by || isAutomated(by)) { automatedItems += 1; continue; }
    const isMl = r.table_name === 'master_list';
    const id = Number(r.row_id);
    const target = isMl ? (mlNameById.get(id) ?? `master_list #${id}`) : (tmNameById.get(id) ?? `trademark #${id}`);
    const labelMap = isMl ? ML_FIELD_LABEL : TM_FIELD_LABEL;
    const change: TeamActivityChange = {
      field: labelMap[str(r.field)] ?? str(r.field),
      from: r.old_value == null ? null : str(r.old_value),
      to: r.new_value == null ? null : str(r.new_value),
    };
    add(at, by, isMl ? 'master_list_edit' : 'trademark_edit', target, [change],
      `${target} — ${changeText(change)}`);
  }

  // ── Creations: own tables, already detailed.
  for (const r of (invoices.data ?? []) as Row[]) {
    add(str(r.created_at), str(r.created_by_email), 'invoice', str(r.company_name), [],
      `${str(r.company_name)} · ${str(r.qb_company)} #${str(r.invoice_no)}${r.total_amt ? ` · S$${Number(r.total_amt).toLocaleString()}` : ''}`);
  }
  for (const r of (campaigns.data ?? []) as Row[]) {
    add(str(r.created_at), str(r.created_by_email), 'campaign', str(r.name), [], `${str(r.name)} (${str(r.type)})`);
  }
  for (const r of (sentEmails.data ?? []) as Row[]) {
    add(str(r.sent_at), str(r.sent_by_email), 'email_sent', str(r.company_name), [], str(r.company_name));
  }
  for (const r of (postInc.data ?? []) as Row[]) {
    add(str(r.created_at), str(r.created_by_email), 'post_incorporate', str(r.company_name), [], str(r.company_name));
  }
  for (const r of (soaOwners.data ?? []) as Row[]) {
    const who = str(r.soa_pic);
    add(str(r.updated_at), str(r.updated_by_email), 'soa_owner', str(r.customer_name), [],
      `${str(r.customer_name)}${r.qb_company ? ` (${str(r.qb_company)})` : ''}${who ? ` → owner ${who}` : ''}`);
  }

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
