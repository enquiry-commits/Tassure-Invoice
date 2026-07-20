import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: campaign, error: campaignErr } = await supabase
    .from('email_campaigns').select('*, email_senders(email, display_name), email_templates(name, type)')
    .eq('id', id).single();
  if (campaignErr || !campaign) return NextResponse.json({ error: campaignErr?.message ?? 'not found' }, { status: 404 });

  const { data: drafts, error: draftsErr } = await supabase
    .from('email_drafts').select('*').eq('campaign_id', id).order('company_name');
  if (draftsErr) return NextResponse.json({ error: draftsErr.message }, { status: 500 });

  return NextResponse.json({ campaign, drafts: drafts ?? [] });
}
