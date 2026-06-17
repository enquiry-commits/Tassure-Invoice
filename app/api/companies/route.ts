import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

const today = () => new Date().toISOString().split('T')[0];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filter = searchParams.get('filter') ?? '';
  const search = (searchParams.get('search') ?? '').toLowerCase();
  const page   = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10));
  const limit  = Math.min(200, parseInt(searchParams.get('limit') ?? '50', 10));

  // Fetch all appointments once (250 rows) to build ND status lookups
  const { data: allAppts } = await supabase
    .from('nd_appointments')
    .select('company_name, nd_id, cessation_date');

  const t = today();
  const activeNDMap  = new Map<string, number[]>();  // company → [nd_ids]
  const hasAnyNDSet  = new Set<string>();

  for (const row of allAppts ?? []) {
    hasAnyNDSet.add(row.company_name);
    const isActive = !row.cessation_date || row.cessation_date > t;
    if (isActive) {
      const ids = activeNDMap.get(row.company_name) ?? [];
      ids.push(row.nd_id);
      activeNDMap.set(row.company_name, ids);
    }
  }

  // Build Supabase query
  let q = supabase.from('companies').select('*');

  if (search) {
    q = q.or(`company_name.ilike.%${search}%,registration_no.ilike.%${search}%`);
  }

  if (filter === 'address') {
    q = q.eq('uses_address', true);
  }

  if (filter === 'nd') {
    const names = [...activeNDMap.keys()];
    if (names.length === 0) return NextResponse.json({ total: 0, page, limit, data: [] });
    q = q.in('company_name', names);
  }

  if (filter === 'nd-ceased') {
    // Companies that appear in nd_appointments but have NO active ND
    const ceasedOnly = [...hasAnyNDSet].filter(n => !activeNDMap.has(n));
    if (ceasedOnly.length === 0) return NextResponse.json({ total: 0, page, limit, data: [] });
    q = q.in('company_name', ceasedOnly);
  }

  const { data: allRows, error } = await q.order('company_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const enriched = (allRows ?? []).map(c => ({
    ...c,
    hasActiveND: activeNDMap.has(c.company_name),
    activeNDCount: (activeNDMap.get(c.company_name) ?? []).length,
  }));

  const total  = enriched.length;
  const sliced = enriched.slice((page - 1) * limit, page * limit);

  return NextResponse.json({ total, page, limit, data: sliced });
}
