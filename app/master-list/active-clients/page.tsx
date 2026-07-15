import MasterListTable from '@/components/MasterListTable';

// Reduced, reordered column set per user request — everything else (Update
// Date, Sec Agent, KYC Year, Corp Tax, E-filing Auth, A/C, Audit, GST,
// Compil Report, CPF Submit, Mailing Add, Mailing List, Inc. Date,
// Shareholders, Directors, ACRA Update) is dropped from THIS view only.
// Other Master List pages (Ad-Hoc/MAS/Strike Off/Terminated/Name Change)
// still use the full column set via MasterListTable's default.
const ACTIVE_CLIENT_FIELDS = [
  'company_name', 'roc_no', 'status', 'internal_code', 'join_date',
  'add_here', 'invoice_address', 'contact_window', 'email', 'tel',
  'nominee_director', 'secretary', 'annual_return', 'fye',
  'last_ar_date', 'last_agm_date', 'last_accounts_date', 'next_agm_due_date',
  'months_from_last_accounts', 'remark', 'referral', 'risk_level',
  'incorp_with_us', 'mas', 'grade',
] as const;

export default function ActiveClientsPage() {
  return (
    <MasterListTable
      listType="active_client"
      title="Active Client"
      accentColor="#15803d"
      fields={[...ACTIVE_CLIENT_FIELDS]}
      columnWidths={{ status: 60, fye: 60 }}
      moveTargets={[
        { type: 'strike_off', label: 'Strike Off',          statusValue: 'STRUCK OFF' },
        { type: 'terminated', label: 'Terminated Services', statusValue: 'TERMINATED' },
      ]}
    />
  );
}
