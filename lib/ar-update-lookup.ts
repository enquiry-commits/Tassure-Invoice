import 'server-only';

import { createAdminClient } from './supabase';
import { normalize, findUniqueBestMatch } from './company-name';

// Added 2026-09-09 — Vincent: "可以真正执行只是每次执行要提前获得用户点击
// 同意才真正执行操作" (real execution is fine, as long as every execution
// gets an explicit user click first). This is the preview half of a new
// AR Reminder write action, following the exact same shape as the four
// existing preview→confirm→execute flows (lib/billing-lookup.ts,
// lib/late-filing-lookup.ts, lib/invoice-edit-lookup.ts): this file NEVER
// writes anything. It only reads the real current value so the chat card
// can show a before/after and hand the user a Confirm button; the actual
// write happens from that card, against the real PATCH /api/ar-reminder
// endpoint the AR Reminder page itself uses.
//
// The field allowlist here is deliberately NARROWER than that endpoint's own
// EDITABLE_FIELDS. Chat should be able to move a cycle through its normal
// workflow (mark prepared/sent/received/AGM held/filed) and assign a PIC —
// the two things that are genuinely tedious to do by hand — without also
// becoming a general-purpose way to rewrite any column of a compliance
// record by typing a sentence.
export const AR_CHAT_EDITABLE_FIELDS = {
  prepared_date: 'Prepared date',
  sent_date: 'Sent date',
  received_date: 'Received date',
  agm_held_date: 'AGM held date',
  filling_date: 'Filing date (marks the Annual Return as filed)',
  pic: 'Secretary PIC',
  acc_pic: 'Accounts PIC',
  tax_pic: 'Tax PIC',
  remarks: 'Remarks',
} as const;
export type ArEditableField = keyof typeof AR_CHAT_EDITABLE_FIELDS;

export type ArUpdatePreview = {
  rowId: number;
  companyName: string;
  uen: string | null;
  fyeMonth: string | null;
  fyeYear: number | null;
  field: ArEditableField;
  fieldLabel: string;
  currentValue: string | null;
  newValue: string | null;
  alreadyThatValue: boolean;
  cycleAlreadyFiled: boolean;
};

export type ArUpdateResult =
  | { found: true; preview: ArUpdatePreview }
  | { found: false; message: string; suggestions: string[] };

export function isArEditableField(f: string): f is ArEditableField {
  return Object.prototype.hasOwnProperty.call(AR_CHAT_EDITABLE_FIELDS, f);
}

export async function previewArUpdate(companyQuery: string, field: ArEditableField, value: string | null, fyeYear?: number): Promise<ArUpdateResult> {
  const sb = createAdminClient();
  const trimmed = companyQuery.trim();

  const { data } = await sb.from('ar_reminder')
    .select('id, entity_name, uen, fye_month, fye_year, filling_date, prepared_date, sent_date, received_date, agm_held_date, pic, acc_pic, tax_pic, remarks')
    .or('status.is.null,status.neq.Excluded');
  const rows = data ?? [];
  if (!rows.length) return { found: false, message: 'No AR Reminder rows found at all.', suggestions: [] };

  const matches = rows.filter(r => normalize(r.entity_name as string) === normalize(trimmed));
  let candidates = matches;
  if (!candidates.length) {
    // Same shared matcher every other single-company chat lookup uses.
    const uniqueNames = [...new Map(rows.map(r => [normalize(r.entity_name as string), r])).values()];
    const best = findUniqueBestMatch(trimmed, uniqueNames, r => r.entity_name as string, 70).value;
    if (best) candidates = rows.filter(r => normalize(r.entity_name as string) === normalize(best.entity_name as string));
  }
  if (!candidates.length) {
    const q = normalize(trimmed);
    const suggestions = [...new Set(rows.filter(r => normalize(r.entity_name as string).includes(q)).map(r => r.entity_name as string))].slice(0, 5);
    return { found: false, message: `No AR Reminder record matched "${companyQuery}".`, suggestions };
  }

  // Which cycle: the caller's year if given, else the most recent one,
  // preferring a cycle that is not yet filed (that's the one someone
  // updating a workflow field almost always means).
  let row = fyeYear ? candidates.find(r => r.fye_year === fyeYear) : undefined;
  if (!row) {
    const sorted = candidates.slice().sort((a, b) => (b.fye_year as number) - (a.fye_year as number));
    row = sorted.find(r => !r.filling_date) ?? sorted[0];
  }
  if (!row) {
    return { found: false, message: `No AR Reminder cycle found for "${companyQuery}"${fyeYear ? ` in ${fyeYear}` : ''}.`, suggestions: [] };
  }

  const currentRaw = row[field] as string | null | undefined;
  const currentValue = currentRaw == null || currentRaw === '' ? null : String(currentRaw);
  const newValue = value == null || value.trim() === '' ? null : value.trim();

  return {
    found: true,
    preview: {
      rowId: row.id as number,
      companyName: row.entity_name as string,
      uen: (row.uen as string | null) ?? null,
      fyeMonth: (row.fye_month as string | null) ?? null,
      fyeYear: (row.fye_year as number | null) ?? null,
      field,
      fieldLabel: AR_CHAT_EDITABLE_FIELDS[field],
      currentValue,
      newValue,
      alreadyThatValue: currentValue === newValue,
      cycleAlreadyFiled: !!row.filling_date,
    },
  };
}
