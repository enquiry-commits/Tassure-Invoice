import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { todaySGT } from '@/lib/date';

const today = todaySGT;

export async function GET() {
  const [{ data: nds }, { data: appts }] = await Promise.all([
    supabase.from('nominee_directors').select('id, name, member_id').order('name'),
    supabase.from('nd_appointments').select('nd_id, company_name, sub_role, appointment_date, cessation_date'),
  ]);

  const t = today();

  const apptsByND = new Map<number, typeof appts>();
  for (const appt of appts ?? []) {
    const list = apptsByND.get(appt.nd_id) ?? [];
    list.push(appt);
    apptsByND.set(appt.nd_id, list);
  }

  const result = (nds ?? []).map(nd => {
    const appointments = apptsByND.get(nd.id) ?? [];
    const activeCount  = appointments.filter(a => !a.cessation_date || a.cessation_date > t).length;
    const totalCount   = appointments.length;
    return { ...nd, appointments, activeCount, totalCount };
  });

  return NextResponse.json(result);
}
