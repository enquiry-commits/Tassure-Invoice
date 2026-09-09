import 'server-only';

import { createAdminClient } from './supabase';

// Added 2026-09-09 — Vincent asked the chat "Bao Fortune 的Email 发送出去
//了吗？" (has Bao Fortune's email been sent?) and got told to go check the
// 邮件记录 (Email Activity) page manually instead of an actual answer —
// "这个也是还判断不出来" (this one also can't figure it out). The real data
// (email_drafts, joined with email_campaigns) was always there; there was
// just no chat tool reading it. Mirrors app/api/client-communications/
// drafts/route.ts's own GET query (search=<company>) exactly — same table,
// same join, same ilike company_name match the real Email Activity/
// Delivery History page's own search box uses — so a chat answer can never
// diverge from what that real page would show for the same search term.
export type EmailDraftStatusRow = {
  status: string;
  campaignType: string | null;
  campaignName: string | null;
  fyeMonth: string | null;
  fyeYear: number | null;
  subject: string | null;
  toEmail: string | null;
  sentAt: string | null;
  sentByName: string | null;
  updatedAt: string;
};

export type EmailStatusResult =
  | { found: true; companyQuery: string; drafts: EmailDraftStatusRow[] }
  | { found: false; message: string };

type CampaignRef = { type: string | null; name: string | null; fye_month: string | null; fye_year: number | null };

export async function lookupEmailStatus(companyQuery: string, limit = 10): Promise<EmailStatusResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('email_drafts')
    .select('status, subject, to_email, sent_at, sent_by_name, updated_at, email_campaigns!inner(type, name, fye_month, fye_year)')
    .ilike('company_name', `%${companyQuery.trim()}%`)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  if (!data?.length) return { found: false, message: `No email draft/campaign record found for "${companyQuery}".` };

  const drafts: EmailDraftStatusRow[] = data.map(r => {
    const raw = r.email_campaigns as unknown as CampaignRef | CampaignRef[] | null;
    const campaign = Array.isArray(raw) ? raw[0] : raw;
    return {
      status: r.status,
      campaignType: campaign?.type ?? null,
      campaignName: campaign?.name ?? null,
      fyeMonth: campaign?.fye_month ?? null,
      fyeYear: campaign?.fye_year ?? null,
      subject: r.subject,
      toEmail: r.to_email,
      sentAt: r.sent_at,
      sentByName: r.sent_by_name,
      updatedAt: r.updated_at,
    };
  });
  return { found: true, companyQuery, drafts };
}
