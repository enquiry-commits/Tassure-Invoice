import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { todaySGT } from '@/lib/date';

const today = todaySGT;

export async function GET() {
  const [
    { count: totalClients },
    { count: withAddress },
    { count: totalNDPersons },
    { data: allAppts },
    { data: syncRows },
  ] = await Promise.all([
    supabase.from('companies').select('*', { count: 'exact', head: true }),
    supabase.from('companies').select('*', { count: 'exact', head: true }).eq('uses_address', true),
    supabase.from('nominee_directors').select('*', { count: 'exact', head: true }),
    supabase.from('nd_appointments').select('nd_id, company_name, cessation_date'),
    supabase.from('automation_sync_runs').select('finished_at').eq('status', 'success').order('finished_at', { ascending: false }).limit(1),
  ]);

  const t = today();
  const activeNDCompanySet = new Set<string>();
  const allNDCompanySet    = new Set<string>();
  const activeNDPersonSet  = new Set<number>();

  for (const row of allAppts ?? []) {
    allNDCompanySet.add(row.company_name);
    const isActive = !row.cessation_date || row.cessation_date > t;
    if (isActive) {
      activeNDCompanySet.add(row.company_name);
      activeNDPersonSet.add(row.nd_id);
    }
  }

  return NextResponse.json({
    totalClients:      totalClients ?? 0,
    withAddress:       withAddress  ?? 0,
    activeNDCompanies: activeNDCompanySet.size,
    ceasedOnlyCompanies: [...allNDCompanySet].filter(c => !activeNDCompanySet.has(c)).length,
    activeNDPersons:   activeNDPersonSet.size,
    totalNDPersons:    totalNDPersons ?? 0,
    lastSynced:        syncRows?.[0]?.finished_at ?? null,
  });
}
