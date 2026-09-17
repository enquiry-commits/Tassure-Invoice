/**
 * One-time cleanup: soa_owners was seeded on 2026-09-07 by a backfill script
 * (updated_by_email='backfill@internal') using the OLD "same owner regardless
 * of which QB book" theory, before the 2026-09-07 split enforced per-book
 * scoping. 119 of 383 real rows ended up with a staff member from the wrong
 * team for their qb_company (e.g. ACN Consultants Pte Ltd's TAB row recorded
 * "Tee Yu Heng", Accounting, even though the real invoice Class is "Ang Shi
 * Ming" — Vincent, 2026-09-17: "换director 就不可能是ACC的 YU HENG做的").
 *
 * Deletes ONLY rows that are still team-mismatched under the corrected
 * PIC_TEAMS_BY_COMPANY (lib/soa-owner.ts, TAB/TAO now also allow Corporate
 * Secretarial (Malaysia) — Tey Shemin's 63 real rows are correctly excluded
 * by this script for that reason), AND only ever rows written by
 * backfill@internal — never a row a real human has confirmed/edited since,
 * even if that one also happens to look mismatched (a human's own deliberate
 * pick is a different, separate question, not this script's job).
 *
 * Deleting (not nulling) lets effectiveOwner() fall through to
 * suggestedOwner — the now-correctly-team-restricted, freshly computed
 * value from the real QuickBooks Class/Location data — rather than leaving
 * a stale wrong value in place. Safe to re-run (idempotent: nothing left to
 * delete on a second run).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Mirrors lib/staff-directory.ts's `team` field for every name that appears
// as a real soa_pic value, and lib/soa-owner.ts's (now-widened)
// PIC_TEAMS_BY_COMPANY — inlined since this script can't import the .ts
// modules directly (no extensionless resolution outside Next.js's bundler).
const TEAM_BY_NAME = {
  'Lim Hoe Chyi': 'Corporate Secretarial', 'Hoo Seng Xin': 'Corporate Secretarial',
  'Jenny Lai': 'Corporate Secretarial', 'Chin Kah Ye': 'Corporate Secretarial',
  'Ang Shi Ming': 'Corporate Secretarial',
  'Tey Shemin': 'Corporate Secretarial (Malaysia)', 'Tan Min Quan': 'Corporate Secretarial (Malaysia)',
  'Lee Jing Fei': 'Accounting', 'Jay Tay': 'Accounting', 'Tee Yu Heng': 'Accounting',
  'Vernice Chai': 'Accounting', 'Chee Wei En': 'Accounting',
  'Clarence Saw': 'Tax', 'Quinnie Tan': 'Tax', 'Victoria Yap': 'Tax',
  'Esther Loo': 'Management', 'Chelsea Ang': 'Management', 'Vincent Seow': 'Management', 'Yuna Lai': 'Management',
  'Cindy Zhang': 'Partners', 'Samuell Ng': 'Partners', 'Tan Yee Soon': 'Partners', 'Leonard Lee': 'Partners', 'Teo Siok Fieng': 'Partners',
};
const PIC_TEAMS_BY_COMPANY = {
  TAB: ['Corporate Secretarial', 'Corporate Secretarial (Malaysia)'],
  TAO: ['Accounting', 'Tax', 'Corporate Secretarial (Malaysia)'],
};

async function pageAll(table, select) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await sb.from(table).select(select).range(start, start + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

(async () => {
  const owners = await pageAll('soa_owners', 'id, customer_name, qb_company, soa_pic, updated_by_email');
  const toDelete = owners.filter(o => {
    if (o.updated_by_email !== 'backfill@internal') return false;
    const teams = PIC_TEAMS_BY_COMPANY[o.qb_company];
    if (!teams) return false; // TAC unrestricted
    const team = TEAM_BY_NAME[o.soa_pic];
    if (!team) return false; // unrecognized value (e.g. "BD") — leave alone
    return !teams.includes(team);
  });

  console.log(`Deleting ${toDelete.length} stale backfill soa_owners rows (of ${owners.length} total):`);
  for (const o of toDelete) console.log(`  ${o.qb_company} | ${o.customer_name} | soa_pic="${o.soa_pic}" (${TEAM_BY_NAME[o.soa_pic]})`);

  if (!toDelete.length) { console.log('Nothing to delete.'); return; }

  const { error, count } = await sb.from('soa_owners').delete({ count: 'exact' }).in('id', toDelete.map(o => o.id));
  if (error) { console.error('DELETE failed:', error.message); process.exit(1); }
  console.log(`\nDone. Deleted ${count} row(s).`);
})().catch(e => { console.error(e); process.exit(1); });
