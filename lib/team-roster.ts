import 'server-only';
import { createAdminClient } from '@/lib/supabase';
import { staffByTeam, formatStaffNameList, rankForEmail, type StaffTeam, type PersonRank } from '@/lib/staff-directory';
import { pageAll } from '@/lib/page-all';

/**
 * Who is in each department, and roughly how much each person carries —
 * 2026-09-10. Asked "你可以分出各部门人员有谁吗", the assistant said it had
 * no such tool; it does now.
 *
 * The roster itself is authoritative, not derived: it comes from the `team`
 * field on lib/staff-directory.ts, which Vincent hand-maintains (and which
 * this cross-checked against the real PIC distribution — Accounting people
 * do appear in ar_reminder.acc_pic, Tax in tax_pic, and so on). The load
 * numbers ARE derived, from live ar_reminder assignments, so a name reads
 * as "carrying ~166 companies" rather than just being on a list.
 */

export type RosterMember = {
  name: string;
  email: string;
  rank: PersonRank;
  // Companies currently assigned to this person in the column that matches
  // their team (Secretary → pic, Accounting → acc_pic, Tax → tax_pic).
  // null for teams with no AR column (Partners, Management, Audit).
  companyLoad: number | null;
};

export type RosterTeam = {
  team: StaffTeam;
  members: RosterMember[];
};

export type TeamRosterResult = {
  teams: RosterTeam[];
  nomineeDirectorRoster: { name: string; activeAppointments: number }[];
  loadColumnNote: string;
};

const TEAM_LOAD_COLUMN: Partial<Record<StaffTeam, 'pic' | 'acc_pic' | 'tax_pic'>> = {
  'Corporate Secretarial': 'pic',
  'Corporate Secretarial (Malaysia)': 'pic',
  Accounting: 'acc_pic',
  Tax: 'tax_pic',
};

export async function getTeamRoster(): Promise<TeamRosterResult> {
  const sb = createAdminClient();

  const [arRows, ndRows, ndAppts] = await Promise.all([
    pageAll<Record<string, unknown>>(() => sb.from('ar_reminder').select('pic, acc_pic, tax_pic')),
    sb.from('nominee_directors').select('id, name').then(r => r.data ?? []),
    sb.from('nd_appointments').select('nd_id, cessation_date').then(r => r.data ?? []),
  ]);

  // Count assignments per resolved staff name, per column.
  const load: Record<'pic' | 'acc_pic' | 'tax_pic', Map<string, number>> = {
    pic: new Map(), acc_pic: new Map(), tax_pic: new Map(),
  };
  for (const r of arRows) {
    for (const col of ['pic', 'acc_pic', 'tax_pic'] as const) {
      for (const name of formatStaffNameList(r[col] as string | null)) {
        load[col].set(name, (load[col].get(name) ?? 0) + 1);
      }
    }
  }

  const teams: RosterTeam[] = staffByTeam().map(({ team, members }) => {
    const col = TEAM_LOAD_COLUMN[team];
    return {
      team,
      members: members.map(m => ({
        name: m.name,
        email: m.email,
        rank: rankForEmail(m.email),
        companyLoad: col ? (load[col].get(m.name) ?? 0) : null,
      })),
    };
  });

  // The Nominee Director roster is a separate concept — people (staff or
  // otherwise) who ACT as a nominee director for clients, not a department.
  const activeByNd = new Map<number, number>();
  for (const a of ndAppts as { nd_id: number; cessation_date: string | null }[]) {
    if (a.cessation_date) continue;
    activeByNd.set(a.nd_id, (activeByNd.get(a.nd_id) ?? 0) + 1);
  }
  const nomineeDirectorRoster = (ndRows as { id: number; name: string }[])
    .map(nd => ({ name: nd.name, activeAppointments: activeByNd.get(nd.id) ?? 0 }))
    .filter(x => x.activeAppointments > 0)
    .sort((a, b) => b.activeAppointments - a.activeAppointments);

  return {
    teams,
    nomineeDirectorRoster,
    loadColumnNote: 'companyLoad is how many AR Reminder cycles that person is currently the PIC on for their team\'s column (Secretary → pic, Accounting → acc_pic, Tax → tax_pic). It is a rough size indicator, not a formal caseload — one person can appear on a cycle jointly with another.',
  };
}
