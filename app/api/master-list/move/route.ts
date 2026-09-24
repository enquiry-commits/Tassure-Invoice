import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { placeholderStatusForMove } from '@/lib/master-list-status';

// Move a row from its current list_type to another (e.g. Active Client → Strike Off),
// carrying over all shared fields and re-stamping status/row_order for the destination list.
//
// Strike Off / Terminated Services: the status stamped here is a PLACEHOLDER
// until the next nightly TeamWork sync confirms it, and it is decided HERE,
// not by the browser (docs/INVARIANTS.md INV-DATA-067 / INV-DATA-064):
// "Striking Off" (TeamWork's own in-progress wording) and "Terminate". The
// final "Terminated" is TeamWork's word and only appears once the sync copies
// it — Vincent: "Move 到 Terminated 现在放的 'Terminate'…和TW确认后才变成
// Terminated". The colleague who works those lists: "strike off & terminate的
// status 不要自己变…follow teamwork".
//
// 2026-09-09: this route had NO server-side auth check at all — the only
// gate was a client-side window.confirm() in components/MasterListTable.tsx
// (moveRow), which anyone who could reach this URL directly could bypass
// entirely. Found while surveying other candidates for the chat-driven
// preview+confirm pattern; fixed regardless of whether that survey's
// results get built, since this was a real, standing gap independent of
// it. Matches every sibling mutating route in this app (AR Reminder,
// Trademark, Late Filing below).
export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  const { id, targetType, statusValue } = await req.json();
  if (!id || !targetType) return NextResponse.json({ error: 'id and targetType required' }, { status: 400 });

  const supabase = createAdminClient();

  const { data: row, error: fetchErr } = await supabase.from('master_list').select('*').eq('id', id).single();
  if (fetchErr || !row) return NextResponse.json({ error: fetchErr?.message ?? 'Row not found' }, { status: 404 });

  const { data: maxRow } = await supabase
    .from('master_list')
    .select('row_order')
    .eq('list_type', targetType)
    .order('row_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.row_order ?? 0) + 1;

  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, list_type: _listType, row_order: _rowOrder, ...rest } = row;

  const newRecord = {
    ...rest,
    list_type: targetType,
    row_order: nextOrder,
    status: placeholderStatusForMove(targetType) ?? statusValue ?? rest.status,
  };

  const { data: inserted, error: insertErr } = await supabase.from('master_list').insert(newRecord).select().single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  const { error: deleteErr } = await supabase.from('master_list').delete().eq('id', id);
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: inserted });
}
