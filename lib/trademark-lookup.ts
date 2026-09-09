import 'server-only';

import { createAdminClient } from './supabase';

// Added 2026-09-09 — Trademark had ZERO chat coverage before this: no tool
// could answer even "how many trademarks are in progress" (a single-
// company trademark list already exists via company_deep_lookup's
// getCompany360() reuse; this is the company-WIDE counterpart). Reads
// trademark_records directly — the same table app/api/trademark/route.ts
// itself reads, `category`='master' (registered) vs 'in_progress'
// (application not yet granted), `mark_expired_date` for renewal tracking.
export type TrademarkSummary = {
  totalRegistered: number; // category='master'
  totalInProgress: number; // category='in_progress'
  expiringSoon: { companyName: string; applicationNumber: string | null; markExpiredDate: string }[]; // registered marks expiring within expiringSoonDays
  expiringSoonDays: number;
  inProgressList: { companyName: string; statusText: string | null; applicationDate: string | null }[];
};

export async function getTrademarkSummary(expiringSoonDays = 180): Promise<TrademarkSummary> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('trademark_records')
    .select('company_name, category, application_number, application_date, mark_expired_date, status_text');
  const rows = data ?? [];

  const master = rows.filter(r => r.category === 'master');
  const inProgress = rows.filter(r => r.category === 'in_progress');

  const cutoff = new Date(Date.now() + expiringSoonDays * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const expiringSoon = master
    .filter(r => r.mark_expired_date && r.mark_expired_date >= today && r.mark_expired_date <= cutoff)
    .sort((a, b) => String(a.mark_expired_date).localeCompare(String(b.mark_expired_date)))
    .map(r => ({ companyName: r.company_name as string, applicationNumber: (r.application_number as string | null) ?? null, markExpiredDate: r.mark_expired_date as string }));

  return {
    totalRegistered: master.length,
    totalInProgress: inProgress.length,
    expiringSoon,
    expiringSoonDays,
    inProgressList: inProgress.map(r => ({ companyName: r.company_name as string, statusText: (r.status_text as string | null) ?? null, applicationDate: (r.application_date as string | null) ?? null })),
  };
}
