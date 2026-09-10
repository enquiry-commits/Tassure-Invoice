'use client';

import type { DraftLike } from '@/lib/draft-helper-client';
import type { QbCompany } from '@/lib/quickbooks';
import { todaySGT } from '@/lib/date';
import { buildCampaignDraft, loadCampaignActor } from '@/lib/campaign-draft-client';

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
  return loadCampaignActor();
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
  // SOA's one difference from the other campaign types: the merged
  // statement PDF replaces the automatic per-invoice attachments, so it is
  // passed as `attachment` (which also clears invoice_refs — see
  // buildCampaignDraft). Everything else is the shared flow.
  const pdfRes = await fetch(`/api/billing/soa/pdf?companyName=${encodeURIComponent(companyName)}&company=${qbCompany}`);
  if (!pdfRes.ok) {
    const j = await pdfRes.json().catch(() => ({}));
    throw new Error(j.error ?? 'Unable to generate the combined PDF.');
  }
  const pdfBlob = await pdfRes.blob();
  const pdfFile = new File([pdfBlob], `SOA (${qbCompany}) - ${companyName}.pdf`, { type: 'application/pdf' });

  return buildCampaignDraft({
    companyName, type: 'soa', me, sender,
    campaignName: `SOA (${qbCompany}) - ${companyName} - ${todaySGT()}`,
    attachment: pdfFile,
  });
}
