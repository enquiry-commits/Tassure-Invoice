'use client';

import type { DraftLike } from '@/lib/draft-helper-client';
import { todaySGT } from '@/lib/date';

/**
 * Build a real Client Communications draft, ready for the Outlook review
 * window — generalised 2026-09-10 from lib/soa-actions-client.ts's
 * SOA-only version so chat can draft the OTHER two campaign types too
 * ('ar' renewal reminders and 'letter'), which were the daily work still
 * locked inside Campaign Centre and the Billing page's Email Drafts
 * popover.
 *
 * The three steps are the ones both existing pages already perform, in the
 * same order and against the same endpoints: resolve the recipient row,
 * pick the type's default template, POST the campaign so the draft gets a
 * REAL persisted id/version (the review window's later mark-sent/save
 * PATCHes require one — never hand it a client-merged copy).
 *
 * It stops at a draft. Sending is the user's click inside
 * OutlookStyleSendModal, which re-verifies amounts and resolves
 * attachments itself. Chat never sends (INV-DATA-033).
 */

export type CampaignType = 'letter' | 'ar' | 'soa';
export type CampaignActor = { email: string; name: string } | null;
export type CampaignSender = { email: string; display_name: string | null } | null;

export async function loadCampaignActor(): Promise<{ me: CampaignActor; sender: CampaignSender }> {
  const [me, sender] = await Promise.all([
    fetch('/api/auth/me').then(r => r.json()).then(j => j.user ?? null).catch(() => null),
    fetch('/api/client-communications/senders').then(r => r.json()).then(j => {
      const list = j.data ?? [];
      return list.find((s: { is_default: boolean }) => s.is_default) ?? list[0] ?? null;
    }).catch(() => null),
  ]);
  return { me, sender };
}

export async function resolveCampaignRow(companyName: string, type: CampaignType, fyeMonth?: string, fyeYear?: number) {
  const qs = new URLSearchParams({ lookup: companyName, type });
  if (fyeMonth) qs.set('fyeMonth', fyeMonth);
  if (fyeYear) qs.set('fyeYear', String(fyeYear));
  const res = await fetch(`/api/client-communications/campaigns/preview?${qs.toString()}`);
  const json = await res.json();
  if (!res.ok || !json.row) throw new Error(json.error ?? 'Could not resolve a recipient for this company.');
  if (!json.row.toEmail) throw new Error('No valid recipient email on file for this company — resolve it in Campaign Centre first.');
  return json.row as { companyName: string; toEmail: string; ccEmail: string | null };
}

export async function pickCampaignTemplate(type: CampaignType): Promise<{ id: string; name: string }> {
  const res = await fetch(`/api/client-communications/templates?type=${type}`);
  const json = await res.json();
  const templates = json.data ?? [];
  const template = templates.find((t: { is_default: boolean }) => t.is_default) ?? templates[0];
  if (!template) throw new Error(`No ${type.toUpperCase()} template found — add one in Client Communications › Templates.`);
  return template;
}

/**
 * `attachment` is how SOA differs: it replaces the automatic per-invoice
 * attachment fetch with one merged statement PDF, which is why that caller
 * also clears invoice_refs (fetchSystemAttachments in draft-helper-client
 * only acts on invoice_refs).
 */
export async function buildCampaignDraft(opts: {
  companyName: string;
  type: CampaignType;
  fyeMonth?: string;
  fyeYear?: number;
  me: CampaignActor;
  sender: CampaignSender;
  campaignName?: string;
  attachment?: File | null;
}): Promise<DraftLike> {
  const { companyName, type, fyeMonth, fyeYear, me, sender, attachment } = opts;
  const row = await resolveCampaignRow(companyName, type, fyeMonth, fyeYear);
  const template = await pickCampaignTemplate(type);

  const createRes = await fetch('/api/client-communications/campaigns', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      name: opts.campaignName ?? `${type.toUpperCase()} - ${companyName} - ${todaySGT()}`,
      ...(type === 'ar' ? { fyeMonth, fyeYear } : {}),
      templateId: template.id, companies: [row], createdByEmail: me?.email, createdByName: me?.name,
    }),
  });
  const createJson = await createRes.json();
  if (!createRes.ok || !createJson.ok) throw new Error(createJson.error ?? 'Unable to create this draft.');
  const createdDraft = createJson.drafts?.[0];
  if (!createdDraft) throw new Error('Draft was not created.');

  return {
    id: createdDraft.id, version: createdDraft.version,
    company_name: createdDraft.company_name, to_email: createdDraft.to_email, cc_email: createdDraft.cc_email,
    subject: createdDraft.subject, body: createdDraft.body,
    invoice_refs: attachment ? [] : createdDraft.invoice_refs,
    ...(attachment ? { additional_attachments: [attachment] } : {}),
    sender_email: sender?.email ?? 'finance@tassure.com',
    // The amounts came from generated_invoices moments ago (the POST above),
    // so skip prepareDraftForSend's live QuickBooks re-check — that exists
    // for a draft that has sat around since being created.
    skip_amount_refresh: true,
  };
}
