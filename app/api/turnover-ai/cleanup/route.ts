import { NextRequest, NextResponse } from 'next/server';
import { withAutomationRun } from '@/lib/automation-sync';
import { createAdminClient } from '@/lib/supabase';
import { computeCurrencyTotals, mergeCurrencyTotals, STORAGE_BUCKET, type CurrencyTotal } from '@/lib/turnover-ai';

// GET /api/turnover-ai/cleanup — daily retention sweep (vercel.json: 18:00
// UTC). Vincent: "由于这些PDF的量非常大，肯定会导致多余的PDF一直无限保留，
// 所以我现在这些数据和PDF只保留3天，3天后就清除，文件夹可以继续保留" — the
// original files and per-receipt detail are deleted 3 days after upload;
// the project (folder) itself is never touched here (only a staff member
// deleting it removes it — see app/api/turnover-ai/projects/[id]/route.ts's
// DELETE). Before deleting anything, each affected project's CONFIRMED
// totals are folded into turnover_projects.confirmed_totals (Vincent, via
// AskUserQuestion: "保留总数，只清原始文件/明细") so the folder keeps
// showing its number indefinitely even once the evidence is gone.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const RETENTION_DAYS = 3;

async function sweep(): Promise<NextResponse> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: expiring, error: expiringErr } = await supabase
    .from('turnover_documents')
    .select('id, project_id, storage_path')
    .lt('uploaded_at', cutoff);
  if (expiringErr) throw new Error(`Unable to load expiring documents: ${expiringErr.message}`);

  if (!expiring?.length) {
    return NextResponse.json({ ok: true, documentsPurged: 0, projectsUpdated: 0, storageErrors: 0 });
  }

  // Vincent, 2026-10-04: "不需要confirm 先，直接计算出Total" — a line
  // counts toward the project's permanent total unless it was explicitly
  // rejected, matching the same rule the live project-detail/list routes
  // now use (see their own comments). Still never folds a 'rejected' line
  // in, even though its document is expiring and its own row is about to
  // be deleted along with it.
  const docIds = expiring.map(d => d.id);
  const { data: items, error: itemsErr } = await supabase
    .from('turnover_line_items')
    .select('document_id, review_status, currency, edited_currency, amount, edited_amount')
    .in('document_id', docIds)
    .neq('review_status', 'rejected');
  if (itemsErr) throw new Error(`Unable to load expiring line items: ${itemsErr.message}`);

  type LineItemRow = { document_id: number; review_status: string; currency: string | null; edited_currency: string | null; amount: number; edited_amount: number | null };
  const docProjectById = new Map(expiring.map(d => [d.id, d.project_id as number]));
  const itemsByProject = new Map<number, LineItemRow[]>();
  for (const i of (items ?? []) as LineItemRow[]) {
    const projectId = docProjectById.get(i.document_id);
    if (projectId === undefined) continue;
    const list = itemsByProject.get(projectId) ?? [];
    list.push(i);
    itemsByProject.set(projectId, list);
  }

  const affectedProjectIds = [...new Set(expiring.map(d => d.project_id as number))];
  const { data: projects, error: projectsErr } = affectedProjectIds.length
    ? await supabase.from('turnover_projects').select('id, confirmed_totals').in('id', affectedProjectIds)
    : { data: [] as { id: number; confirmed_totals: CurrencyTotal[] }[], error: null };
  if (projectsErr) throw new Error(`Unable to load affected projects: ${projectsErr.message}`);

  let projectsUpdated = 0;
  for (const project of projects ?? []) {
    const newTotals = computeCurrencyTotals(itemsByProject.get(project.id) ?? []);
    const merged = mergeCurrencyTotals((project.confirmed_totals ?? []) as CurrencyTotal[], newTotals);
    const { error: updateErr } = await supabase.from('turnover_projects')
      .update({ confirmed_totals: merged, last_purged_at: new Date().toISOString() })
      .eq('id', project.id);
    if (!updateErr) projectsUpdated++;
  }

  const storagePaths = expiring.map(d => d.storage_path).filter((p): p is string => Boolean(p));
  let storageErrors = 0;
  if (storagePaths.length) {
    const { error: removeErr } = await supabase.storage.from(STORAGE_BUCKET).remove(storagePaths);
    if (removeErr) storageErrors = storagePaths.length;
  }

  const { error: deleteErr } = await supabase.from('turnover_documents').delete().in('id', docIds);
  if (deleteErr) throw new Error(`Unable to delete expired documents: ${deleteErr.message}`);

  return NextResponse.json({
    ok: true,
    documentsPurged: expiring.length,
    projectsUpdated,
    storageErrors,
  });
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'turnover_cleanup', sweep);
}
