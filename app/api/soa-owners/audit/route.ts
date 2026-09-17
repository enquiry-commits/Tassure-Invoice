import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { withAutomationRun, replaceAutomationExceptions, type AutomationRun } from '@/lib/automation-sync';
import { computeSoaRows } from '@/lib/soa-data';
import { resolveStaffName } from '@/lib/staff-directory';
import { normalize } from '@/lib/company-name';
import type { QbCompany } from '@/lib/quickbooks';

// Vincent, 2026-09-17: "这个Outstanding内的公司和PIC和欠款 都是要很准确和实时
// 的，这些都是要最新的不能延迟" — the amounts/aging already refresh near-
// real-time off the QuickBooks webhook (INV-QB-021), and the AUTO-computed
// suggested owner (lib/soa-owner.ts) is derived from that same always-fresh
// invoice data. The one real gap: a human's CONFIRMED Main PIC
// (`soa_owners.soa_pic`) always wins over the auto-suggestion and is never
// re-checked once set — so it can go silently stale for months after a real
// staffing handoff, exactly what happened with 19 real companies still
// recording "Tey Shemin" as their TAO/TAB PIC long after their real invoices
// showed someone else doing the work (found only because Chelsea happened to
// notice one real export — see docs/INVARIANTS.md INV-PIC-007's own
// "Found later the same day" note).
//
// This is that missing self-check, run daily: for every soa_owners row,
// compare the confirmed soa_pic against computeSoaRows()'s own
// suggestedOwner for that exact customer — the SAME shared computation the
// on-screen list/PDF/Excel export already use, never a second,
// independently-derived signal. TAC is skipped: its PIC is the current
// Nominee Director (INV-QB-008), not a Class-derived signal — computeSoaRows
// would essentially never produce a resolvable suggestedOwner to compare
// against there, so auditing it would be a structural no-op, not a real
// check.
//
// Deliberately flags rather than auto-corrects (Vincent's own call,
// 2026-09-17, after weighing it): a manual override can legitimately be
// AHEAD of the invoice data (a real handoff just happened, no new invoice
// keyed under the new person's name yet), so silently overwriting it could
// just as easily destroy a correct, current human decision as fix a stale
// one. Surfaces on the same Automation Health dashboard every other sync
// source does — a human decides whether to update `soa_owners` via the
// existing Main PIC dropdown.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const AUDITED_BOOKS: QbCompany[] = ['TAB', 'TAO'];

async function auditSoaOwners(run: AutomationRun): Promise<NextResponse> {
  const supabase = createAdminClient();
  const exceptions: { key: string; name: string; details: Record<string, unknown> }[] = [];
  let checked = 0;
  let skippedNonStaff = 0;

  for (const book of AUDITED_BOOKS) {
    const [{ data: owners, error: ownersError }, rows] = await Promise.all([
      supabase.from('soa_owners').select('id, customer_name, customer_name_norm, soa_pic').eq('qb_company', book),
      computeSoaRows(book),
    ]);
    if (ownersError) throw new Error(`soa_owners read failed for ${book}: ${ownersError.message}`);

    const suggestedByNorm = new Map(rows.map(r => [normalize(r.companyName), r.suggestedOwner]));

    for (const owner of owners ?? []) {
      const storedResolved = resolveStaffName(owner.soa_pic);
      // Not a recognized staff name — e.g. "BD" (Bad Debt), "Client", "PAC",
      // "dormant" (lib/staff-directory.ts's own documented deliberately-
      // unmatched list). Nothing meaningful to contradict.
      if (!storedResolved) { skippedNonStaff++; continue; }

      checked++;
      const suggested = suggestedByNorm.get(owner.customer_name_norm);
      if (!suggested) continue; // no current invoice-derived signal at all — can't confirm or contradict, leave alone
      const suggestedResolved = resolveStaffName(suggested) ?? suggested;
      if (suggestedResolved === storedResolved) continue; // consistent

      exceptions.push({
        key: `${book}:${owner.customer_name_norm}`,
        name: owner.customer_name,
        details: {
          qb_company: book,
          confirmed_pic: owner.soa_pic,
          current_suggested_owner: suggested,
          soa_owners_id: owner.id,
        },
      });
    }
  }

  await replaceAutomationExceptions('soa_owner_audit', 'stale_confirmed_pic', exceptions);
  await run.heartbeat();

  return NextResponse.json({ ok: true, checked, skippedNonStaff, contradicted: exceptions.length });
}

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'soa_owner_audit', auditSoaOwners);
}
