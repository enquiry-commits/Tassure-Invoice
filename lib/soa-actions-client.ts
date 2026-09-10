'use client';

import type { DraftLike } from '@/lib/draft-helper-client';
import type { QbCompany } from '@/lib/quickbooks';
import { todaySGT } from '@/lib/date';

/**
 * The two real SOA actions — download the merged statement PDF, and build
 * the client email draft — extracted 2026-09-10 from the SOA page's own
 * SoaDetail component (app/billing/soa/_components.tsx) so the chat
 * assistant's SOA card runs THE SAME code rather than a second copy.
 *
 * Why extraction rather than a copy: this is the client-facing money
 * conversation. Recipient/CC policy, the SOA template, the campaign record
 * and the merged-PDF attachment are all decided in one place
 * (Client Communications), and a parallel chat implementation would be
 * exactly the kind of drift that has already caused real bugs in this
 * codebase (see lib/company-name.ts's header on four divergent copies of
 * one matcher). Every line below is a mechanical move from SoaDetail —
 * verify with `git diff` that the page's own behavior is unchanged.
 *
 * Chat context matters for one thing only: the assistant must never be
 * able to SEND. buildSoaDraft() stops at a prepared draft; putting that
 * draft in front of a human in OutlookStyleSendModal, and the send click
 * inside it, stay the caller's job — the same preview → click → execute
 * rule as every other chat action (INV-DATA-033).
 */

export type SoaActor = { email: string; name: string } | null;
export type SoaSender = { email: string; display_name: string | null } | null;

/** Fetch the current user + default sender the draft flow needs. */
export async function loadSoaActor(): Promise<{ me: SoaActor; sender: SoaSender }> {
  const [me, sender] = await Promise.all([
    fetch('/api/auth/me').then(r => r.json()).then(j => j.user ?? null).catch(() => null),
    fetch('/api/client-communications/senders').then(r => r.json()).then(j => {
      const list = j.data ?? [];
      return list.find((s: { is_default: boolean }) => s.is_default) ?? list[0] ?? null;
    }).catch(() => null),
  ]);
  return { me, sender };
}

/** Download the merged SOA PDF for one company in one QuickBooks book. */
export async function downloadSoaPdf(companyName: string, qbCompany: QbCompany): Promise<void> {
  const res = await fetch(`/api/billing/soa/pdf?companyName=${encodeURIComponent(companyName)}&company=${qbCompany}`);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? 'Unable to generate the combined PDF.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `SOA (${qbCompany}) - ${companyName} - ${todaySGT()}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Build the SOA client email draft, with the merged statement PDF already
 * attached. Returns the draft for OutlookStyleSendModal — it does NOT send.
 */
export async function buildSoaDraft(
  companyName: string,
  qbCompany: QbCompany,
  me: SoaActor,
  sender: SoaSender,
): Promise<DraftLike> {
  const previewRes = await fetch(`/api/client-communications/campaigns/preview?lookup=${encodeURIComponent(companyName)}&type=soa`);
  const previewJson = await previewRes.json();
  if (!previewRes.ok || !previewJson.row) throw new Error(previewJson.error ?? 'Could not resolve a recipient for this company.');
  const row = previewJson.row;
  if (!row.toEmail) throw new Error('No valid recipient email on file for this company — resolve it in Campaign Centre first.');

  const templatesRes = await fetch('/api/client-communications/templates?type=soa');
  const templatesJson = await templatesRes.json();
  const templates = templatesJson.data ?? [];
  const template = templates.find((t: { is_default: boolean }) => t.is_default) ?? templates[0];
  if (!template) throw new Error('No Statement of Account template found — add one in Client Communications › Templates.');

  const createRes = await fetch('/api/client-communications/campaigns', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'soa', name: `SOA (${qbCompany}) - ${companyName} - ${todaySGT()}`,
      templateId: template.id, companies: [row], createdByEmail: me?.email, createdByName: me?.name,
    }),
  });
  const createJson = await createRes.json();
  if (!createRes.ok || !createJson.ok) throw new Error(createJson.error ?? 'Unable to create this draft.');
  const createdDraft = createJson.drafts?.[0];
  if (!createdDraft) throw new Error('Draft was not created.');

  const pdfRes = await fetch(`/api/billing/soa/pdf?companyName=${encodeURIComponent(companyName)}&company=${qbCompany}`);
  if (!pdfRes.ok) {
    const j = await pdfRes.json().catch(() => ({}));
    throw new Error(j.error ?? 'Unable to generate the combined PDF.');
  }
  const pdfBlob = await pdfRes.blob();
  const pdfFile = new File([pdfBlob], `SOA (${qbCompany}) - ${companyName}.pdf`, { type: 'application/pdf' });

  return {
    id: createdDraft.id, version: createdDraft.version,
    company_name: createdDraft.company_name, to_email: createdDraft.to_email, cc_email: createdDraft.cc_email,
    subject: createdDraft.subject, body: createdDraft.body,
    // Empty on purpose — the merged PDF below replaces the automatic
    // per-invoice attachment fetch (fetchSystemAttachments in
    // lib/draft-helper-client.ts only acts on invoice_refs).
    invoice_refs: [],
    additional_attachments: [pdfFile],
    sender_email: sender?.email ?? 'finance@tassure.com',
    skip_amount_refresh: true,
  };
}
