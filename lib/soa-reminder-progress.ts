import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalize } from './company-name';
import type { QbCompany } from './quickbooks';

export const SOA_REMINDER_TEMPLATES = [
  { stage: 1 as const, name: '1st Reminder' },
  { stage: 2 as const, name: '2nd Reminder' },
  { stage: 3 as const, name: '3rd Reminder' },
];

export type SoaReminderStage = 1 | 2 | 3;
export type SoaReminderScope = QbCompany | 'ALL' | null;

export interface SoaReminderHistoryItem {
  companyId: number | null;
  companyName: string;
  stage: SoaReminderStage;
  scope: SoaReminderScope;
  verifiedAt: string;
}

export interface SoaReminderProgress {
  completedStage: SoaReminderStage | null;
  completedLabel: string | null;
  completedAt: string | null;
  nextStage: SoaReminderStage;
  nextTemplateName: string;
}

export function soaReminderStageFromTemplate(name: string | null | undefined): SoaReminderStage | null {
  const exact = SOA_REMINDER_TEMPLATES.find(t => t.name.toLowerCase() === String(name ?? '').trim().toLowerCase());
  return exact?.stage ?? null;
}

export function soaReminderTemplateName(stage: SoaReminderStage): string {
  return SOA_REMINDER_TEMPLATES.find(t => t.stage === stage)?.name ?? '1st Reminder';
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function scopeFromCampaignName(name: string | null | undefined): SoaReminderScope {
  const match = String(name ?? '').match(/^SOA \((TAB|TAC|TAO|ALL)\)\s*-/i);
  return match ? match[1].toUpperCase() as Exclude<SoaReminderScope, null> : null;
}

/**
 * One authoritative read for the Reminder column. Only rows with a real
 * Outlook Helper send acknowledgement count: a manual History-page
 * "Mark as Sent" intentionally has no outlook_send_verified_at and can
 * never advance the collection sequence.
 */
export async function loadSoaReminderHistory(supabase: SupabaseClient): Promise<SoaReminderHistoryItem[]> {
  const { data, error } = await supabase.from('email_drafts')
    .select('company_id, company_name, soa_reminder_stage, soa_qb_company, outlook_send_verified_at, email_campaigns!inner(type, name, email_templates(name))')
    .eq('status', 'sent')
    .eq('email_campaigns.type', 'soa')
    .not('outlook_send_verified_at', 'is', null)
    .order('outlook_send_verified_at', { ascending: false });

  // Safe deployment order: before the migration is run, Outstanding keeps
  // working and simply shows no completed reminder rather than breaking the
  // entire money list. Once the migration exists, every verified send is
  // read from the persisted fields above.
  if (error) {
    if (/soa_reminder_stage|soa_qb_company|outlook_send_verified_at/i.test(error.message)) return [];
    throw error;
  }

  return (data ?? []).flatMap(raw => {
    const campaign = relationOne(raw.email_campaigns as unknown as {
      type: string; name: string | null; email_templates: { name: string } | { name: string }[] | null;
    } | null);
    const template = relationOne(campaign?.email_templates);
    const persistedStage = Number(raw.soa_reminder_stage);
    const stage = ([1, 2, 3].includes(persistedStage) ? persistedStage : soaReminderStageFromTemplate(template?.name)) as SoaReminderStage | null;
    const verifiedAt = raw.outlook_send_verified_at as string | null;
    if (!stage || !verifiedAt) return [];
    const storedScope = String(raw.soa_qb_company ?? '').toUpperCase();
    const scope = (['TAB', 'TAC', 'TAO', 'ALL'].includes(storedScope)
      ? storedScope as Exclude<SoaReminderScope, null>
      : scopeFromCampaignName(campaign?.name));
    return [{
      companyId: raw.company_id as number | null,
      companyName: String(raw.company_name ?? ''),
      stage,
      scope,
      verifiedAt,
    }];
  });
}

export function resolveSoaReminderProgress(
  history: SoaReminderHistoryItem[],
  company: { companyId: number | null; companyName: string },
  qbCompany: QbCompany,
): SoaReminderProgress {
  const companyKey = normalize(company.companyName);
  const relevant = history.filter(item => {
    const sameCompany = company.companyId != null && item.companyId != null
      ? company.companyId === item.companyId
      : normalize(item.companyName) === companyKey;
    const sameScope = item.scope === null || item.scope === 'ALL' || item.scope === qbCompany;
    return sameCompany && sameScope;
  }).sort((a, b) => b.stage - a.stage || b.verifiedAt.localeCompare(a.verifiedAt));

  const latest = relevant[0] ?? null;
  const completedStage = latest?.stage ?? null;
  const nextStage = (completedStage == null ? 1 : Math.min(3, completedStage + 1)) as SoaReminderStage;
  return {
    completedStage,
    completedLabel: completedStage ? `${soaReminderTemplateName(completedStage)} (Done)` : null,
    completedAt: latest?.verifiedAt ?? null,
    nextStage,
    nextTemplateName: soaReminderTemplateName(nextStage),
  };
}
