import MasterListTable from '@/components/MasterListTable';
import { STRIKING_OFF_STATUS, TERMINATED_STATUS } from '@/lib/master-list-status';

// Reduced, reordered column set per user request — everything else (Update
// Date, Sec Agent, KYC Year, Corp Tax, E-filing Auth, A/C, Audit, GST,
// Compil Report, CPF Submit, Mailing Add, Mailing List, Inc. Date,
// Shareholders, Directors, ACRA Update) is dropped from THIS view only.
// Other Master List pages (Ad-Hoc/MAS/Strike Off/Terminated/Name Change)
// still use the full column set via MasterListTable's default.
//
// Further trimmed per Vincent's follow-up request: ACC/TAX, Incorp w/ Us,
// MAS, Add @, Contact Window, and >13M Accts are also dropped from this
// view (still available on the other Master List pages that use the full
// column set, and still stored in the DB — just not shown here).
//
// Email/Tel hidden per Vincent: "用户说暂时用不到，但是以后可能会用到" — not
// deleted, just left out of this array; still in the DB and still shown on
// other Master List pages. Add them back to this list (after 'invoice_address')
// to restore.
//
// nominee_director/secretary are grouped right after status as a "who's
// assigned" cluster — MasterListTable renders these with a green/grey
// checkbox next to the name (Active Client only; every other Master List
// page still shows nominee_director/secretary as plain text).
const ACTIVE_CLIENT_FIELDS = [
  'company_name', 'roc_no', 'status',
  'nominee_director', 'secretary',
  'internal_code', 'join_date',
  'invoice_address',
  'annual_return', 'fye',
  'last_ar_date', 'last_agm_date', 'last_accounts_date', 'next_agm_due_date',
  'remark', 'referral', 'risk_level', 'grade',
] as const;

export default function ActiveClientsPage() {
  return (
    <MasterListTable
      listType="active_client"
      title="Active Client"
      fields={[...ACTIVE_CLIENT_FIELDS]}
      columnWidths={{ status: 60, fye: 60 }}
      enableListView
      enableExport
      // strike_off's statusValue is 'Striking Off', not 'STRUCK OFF' — Vincent,
      // 2026-09-23, from a real case (YOUWE SOLUTIONS PTE. LTD, moved into
      // this list but its TeamWork status was still genuinely "Striking Off",
      // live-confirmed against TeamWork's own getCompanies response at the
      // time): "一开始Move 过来的时候，也应该是先默认显示是 Striking Off，
      // 等到同步TW过后，才根据TW的 status 更新，而不是一开始move 过来，就是
      // 默认 Struck off" — moving a row here is a staff ACTION taken before
      // any TeamWork confirmation exists yet; claiming "STRUCK OFF" (a
      // completed, final state) at that exact moment overstates what's
      // actually known. `app/api/master-list/move/route.ts` writes this
      // value unconditionally on move and does NOT set `manual_fields.status`,
      // so app/api/teamwork/sync/route.ts's nightly status sync (matches
      // "Striking Off" via `components/MasterListTable.tsx`'s own
      // `statusColor()`, same red badge either way) is still free to correct
      // it to whatever TeamWork's real status turns out to be the next time
      // it runs — this default is deliberately a starting placeholder, not a
      // claim of fact.
      //
      // Both placeholders are TeamWork's OWN wording, and app/api/master-list/
      // move/route.ts now decides them server-side too (INV-DATA-067) — Terminated
      // Services used to stamp 'TERMINATED', which the next night's sync rewrote
      // to 'Terminated' (Master List colleague: "strike off & terminate的status
      // 不要自己变…follow teamwork"). Import the constants; don't type the literals.
      moveTargets={[
        { type: 'strike_off', label: 'Strike Off',          statusValue: STRIKING_OFF_STATUS },
        { type: 'terminated', label: 'Terminated Services', statusValue: TERMINATED_STATUS },
      ]}
    />
  );
}
