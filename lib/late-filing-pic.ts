// The Secretary PIC of the AR rows the Late Filing sync mirrors (INV-AR-021 (8)) — pure, no database, no network.
//
// The mirror used to insert its AR row WITHOUT a PIC, and My Tasks lists a Late Filing item only for the PIC of that mirrored row
// (lib/my-tasks-data.ts matchedAs) — so 18 of the 26 marker rows on 2026-10-10, ORBITEZ's real overdue row #886 among them, were on
// nobody's list. Vincent, 2026-10-10 ("这个可以做"): new mirror rows carry the company's TeamWork PIC, and the nightly sync fills the
// existing ones. Only a BLANK Secretary PIC is ever filled — a PIC a person typed, or one already there, is never touched.
import { resolveTeamworkPic } from './teamwork-pic';

/** One run never fills more than this many rows; more than that means something is wrong and NOTHING is filled (the run says so). */
export const MAX_PIC_FILLS_PER_RUN = 40;

/** The company's Secretary PIC exactly as AR Generate gives it to a new row: the secretary sub-role first, else TeamWork's person in charge, as names. '' = none usable. */
export function companySecretaryPic(c: { sec_pic?: string | null; pic?: string | null }): string {
  return resolveTeamworkPic(c.sec_pic ?? c.pic ?? null);
}

export type PicFillRow = { id: number; entity_name: string; company_id: number | null; uen: string | null; pic: string | null; status: string | null };
export type PicFillCompany = { id: number; company_name: string; registration_no: string | null; pic: string | null; sec_pic: string | null };
export type PicSkipReason = 'has-pic' | 'hidden' | 'terminated' | 'no-company' | 'ambiguous-company' | 'no-pic';
export type PicFillPlan = {
  fills: Array<{ rowId: number; entity: string; pic: string; had: 'null' | 'empty' }>;
  skipped: Array<{ rowId: number; entity: string; why: PicSkipReason }>;
  blocked: boolean;      // more than max rows would be filled: none is
  wouldFill: number;
};

const key = (v: string | null | undefined) => String(v ?? '').trim().toUpperCase();

/**
 * Which blank-PIC marker rows get which PIC. A row's company is its company_id, else the ONE company with its UEN, else the ONE company
 * with its exact name; two candidates is "ambiguous" and the row is left alone (never a guess). Hidden rows, terminated companies, rows
 * that already have a PIC (any text, even raw ids) and companies TeamWork gives no usable PIC are skipped.
 */
export function planMirrorPicFills(
  rows: readonly PicFillRow[],
  companies: readonly PicFillCompany[],
  isTerminated: (uen: string | null, name: string) => boolean,
  max = MAX_PIC_FILLS_PER_RUN,
): PicFillPlan {
  const byId = new Map(companies.map(c => [c.id, c]));
  const byUen = new Map<string, PicFillCompany[]>();
  const byName = new Map<string, PicFillCompany[]>();
  for (const c of companies) {
    if (key(c.registration_no)) (byUen.get(key(c.registration_no)) ?? byUen.set(key(c.registration_no), []).get(key(c.registration_no))!).push(c);
    (byName.get(key(c.company_name)) ?? byName.set(key(c.company_name), []).get(key(c.company_name))!).push(c);
  }
  const plan: PicFillPlan = { fills: [], skipped: [], blocked: false, wouldFill: 0 };
  for (const r of rows) {
    const skip = (why: PicSkipReason) => plan.skipped.push({ rowId: r.id, entity: r.entity_name, why });
    if (String(r.pic ?? '').trim()) { skip('has-pic'); continue; }
    if (r.status === 'Excluded') { skip('hidden'); continue; }
    if (isTerminated(r.uen, r.entity_name)) { skip('terminated'); continue; }
    let company = r.company_id != null ? byId.get(r.company_id) : undefined;
    if (!company) {
      const byU = byUen.get(key(r.uen)) ?? [];
      const byN = byName.get(key(r.entity_name)) ?? [];
      const candidates = key(r.uen) ? byU : byN;
      if (candidates.length > 1) { skip('ambiguous-company'); continue; }
      company = candidates[0];
    }
    if (!company) { skip('no-company'); continue; }
    const pic = companySecretaryPic(company);
    if (!pic) { skip('no-pic'); continue; }
    plan.fills.push({ rowId: r.id, entity: r.entity_name, pic, had: r.pic === null ? 'null' : 'empty' });
  }
  plan.wouldFill = plan.fills.length;
  if (plan.fills.length > max) { plan.blocked = true; plan.fills = []; }
  return plan;
}
