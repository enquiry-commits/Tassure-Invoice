import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';
import { computeCurrencyTotals, mergeCurrencyTotals, type CurrencyTotal } from '@/lib/turnover-ai';

export type TurnoverProject = {
  id: number;
  name: string;
  client_company_id: number | null;
  gst_enabled: boolean;
  created_by: string;
  created_at: string;
  documentCount: number;
  pendingCount: number;
  totals: CurrencyTotal[];
};

// GET /api/turnover-ai/projects — the Projects list (the feature's new
// home page, replacing the old flat Inbox/Review Queue/Summary tabs —
// Vincent: "员工可以先开一个项目，点击项目后，再导入PDF"). Each project's
// totals already fold in whatever the 3-day retention sweep purged
// (project.confirmed_totals) with whatever's still live (unpurged
// confirmed line items) — see lib/turnover-ai.ts's mergeCurrencyTotals.
export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const supabase = createAdminClient();
  const { data: projects, error } = await supabase.from('turnover_projects').select('*').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const projectIds = (projects ?? []).map(p => p.id);
  const { data: docs } = projectIds.length
    ? await supabase.from('turnover_documents').select('id, project_id').in('project_id', projectIds)
    : { data: [] as { id: number; project_id: number }[] };
  const docIds = (docs ?? []).map(d => d.id);
  const { data: items } = docIds.length
    ? await supabase.from('turnover_line_items').select('document_id, review_status, currency, edited_currency, amount, edited_amount').in('document_id', docIds)
    : { data: [] as { document_id: number; review_status: string; currency: string | null; edited_currency: string | null; amount: number; edited_amount: number | null }[] };

  type LineItemRow = { document_id: number; review_status: string; currency: string | null; edited_currency: string | null; amount: number; edited_amount: number | null };

  const docProjectById = new Map((docs ?? []).map(d => [d.id, d.project_id]));
  const docsByProject = new Map<number, number>();
  for (const d of docs ?? []) docsByProject.set(d.project_id, (docsByProject.get(d.project_id) ?? 0) + 1);

  const pendingByProject = new Map<number, number>();
  const confirmedItemsByProject = new Map<number, LineItemRow[]>();
  for (const i of (items ?? []) as LineItemRow[]) {
    const projectId = docProjectById.get(i.document_id);
    if (projectId === undefined) continue;
    if (i.review_status === 'unconfirmed') pendingByProject.set(projectId, (pendingByProject.get(projectId) ?? 0) + 1);
    if (i.review_status === 'confirmed') {
      const list = confirmedItemsByProject.get(projectId) ?? [];
      list.push(i);
      confirmedItemsByProject.set(projectId, list);
    }
  }

  const result: TurnoverProject[] = (projects ?? []).map(p => {
    const liveTotals = computeCurrencyTotals(confirmedItemsByProject.get(p.id) ?? []);
    const snapshotTotals = (p.confirmed_totals ?? []) as CurrencyTotal[];
    return {
      id: p.id,
      name: p.name,
      client_company_id: p.client_company_id,
      gst_enabled: p.gst_enabled,
      created_by: p.created_by,
      created_at: p.created_at,
      documentCount: docsByProject.get(p.id) ?? 0,
      pendingCount: pendingByProject.get(p.id) ?? 0,
      totals: mergeCurrencyTotals(snapshotTotals, liveTotals),
    };
  });
  return NextResponse.json({ projects: result });
}

// POST /api/turnover-ai/projects — create a new project (folder). Vincent:
// "员工可以先开一个项目" — name is the only required field; client linking
// and the GST toggle are both optional, set once at creation.
export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { name?: string; clientCompanyId?: number | null; gstEnabled?: boolean };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'A project name is required.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.from('turnover_projects').insert({
    name,
    client_company_id: body.clientCompanyId ?? null,
    gst_enabled: Boolean(body.gstEnabled),
    created_by: account.email,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project: data });
}
