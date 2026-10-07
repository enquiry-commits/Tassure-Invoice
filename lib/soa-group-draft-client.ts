'use client';

import type { DraftLike } from '@/lib/draft-helper-client';
import { todaySGT } from '@/lib/date';
import { pickCampaignTemplate, resolveCampaignRow, type CampaignActor, type CampaignSender } from '@/lib/campaign-draft-client';
import { fetchAllBookSoaPdfs } from '@/lib/soa-actions-client';
import { buildGroupEmailBody, groupTotal, mergeGroupRecipients, type GroupCompany, type GroupInvoiceLine } from '@/lib/soa-group-email';

/**
 * The Group SOA email (Chelsea, 2026-10-07): ONE draft for several companies of the same group — every company's SOA PDFs
 * attached (the same per-book PDFs a single company's "All" Draft Email attaches), the outstanding invoices summarised per
 * company in the body (lib/soa-group-email.ts), the recipients the union of every company's own, the subject typed by the
 * person. It stops at a draft: the person reviews it in OutlookStyleSendModal and the send click is theirs (INV-DATA-033).
 *
 * It is a "letter" campaign, not an "soa" one: an SOA campaign advances ONE company's 1st/2nd/3rd Reminder sequence when
 * its send is verified, and a group email must not tick that off for just the first company.
 */
type ResolvedRow = {
  companyName: string; toEmail: string | null; ccEmail: string | null; companyId?: number | null; totalAmount?: number | null;
  invoiceRefs?: { qbCompany: 'TAB' | 'TAC' | 'TAO'; invoiceNo: string; amount: number }[];
};

export async function buildGroupSoaDraft(opts: {
  companyNames: string[];
  subject: string;
  me: CampaignActor;
  sender: CampaignSender;
  onProgress?: (message: string) => void;
}): Promise<DraftLike> {
  const names = [...new Set(opts.companyNames.map(n => n.trim()).filter(Boolean))];
  const subject = opts.subject.trim();
  if (names.length < 2) throw new Error('Pick at least two companies for a group.');
  if (!subject) throw new Error('Type the email subject first.');

  // 1. who each company would be emailed, and which invoices are open (the same resolution a single Draft Email uses)
  opts.onProgress?.('Looking up recipients and open invoices…');
  const resolved = await Promise.all(names.map(async name => {
    try { return { name, row: (await resolveCampaignRow(name, 'soa', undefined, undefined, undefined, true)) as unknown as ResolvedRow }; }
    catch (error) { return { name, error: error instanceof Error ? error.message : String(error) }; }
  }));
  const failed = resolved.flatMap(r => ('error' in r ? [`${r.name}: ${r.error}`] : []));
  if (failed.length) throw new Error(`No draft was made — ${failed.join(' | ')}`);
  const rows = resolved.map(r => r.row as ResolvedRow); // every entry resolved: the failures threw above

  // 2. each company's SOA PDFs, one company at a time (each is several QuickBooks reads)
  const files: File[] = [];
  for (let i = 0; i < names.length; i++) {
    opts.onProgress?.(`Preparing PDFs (${i + 1} of ${names.length}): ${names[i]}`);
    try { files.push(...await fetchAllBookSoaPdfs(names[i])); }
    catch (error) { throw new Error(`${names[i]}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (!files.length) throw new Error('None of these companies has an SOA to attach.');

  // 3. the body and recipients
  const companies: GroupCompany[] = rows.map((row, i) => ({
    companyName: names[i],
    lines: (row.invoiceRefs ?? []).map((r): GroupInvoiceLine => ({ qbCompany: r.qbCompany, invoiceNo: r.invoiceNo, amount: r.amount })),
    total: typeof row.totalAmount === 'number' ? row.totalAmount : null,
  }));
  const body = buildGroupEmailBody(companies);
  const { to, cc } = mergeGroupRecipients(rows);
  if (!to) throw new Error('None of these companies has a valid recipient email on file.');

  // 4. a REAL persisted draft (the send window's later "mark sent" needs an id and version), then the person's own subject and body
  opts.onProgress?.('Creating the draft…');
  const template = await pickCampaignTemplate('letter');
  const createRes = await fetch('/api/client-communications/campaigns', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'letter',
      name: `SOA Group - ${subject} - ${todaySGT()}`,
      templateId: template.id,
      companies: [{ ...rows[0], toEmail: to, ccEmail: cc, invoiceRefs: [], totalAmount: groupTotal(companies) }],
      createdByEmail: opts.me?.email, createdByName: opts.me?.name,
    }),
  });
  const created = await createRes.json();
  if (!createRes.ok || !created.ok || !created.drafts?.[0]) throw new Error(created.error ?? 'Unable to create the group draft.');
  const draft = created.drafts[0] as { id: number; version: number; company_name: string };

  const patchRes = await fetch('/api/client-communications/drafts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: draft.id, version: draft.version, patch: { subject, body, to_email: to, cc_email: cc } }),
  });
  if (!patchRes.ok) throw new Error((await patchRes.json().catch(() => ({}))).error ?? 'Unable to save the group draft.');

  return {
    id: draft.id, version: draft.version + 1,
    company_name: draft.company_name, to_email: to, cc_email: cc || null,
    subject, body,
    invoice_refs: [],
    additional_attachments: files,
    sender_email: opts.sender?.email ?? 'finance@tassure.com',
  };
}
