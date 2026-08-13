import MasterListTable from '@/components/MasterListTable';

// Same full column set every other default-fields page gets (see COLUMNS in
// MasterListTable.tsx), with new_company_name inserted right after
// company_name — the one column specific to this page's rename records.
const NAME_CHANGE_FIELDS = [
  'company_name', 'new_company_name', 'roc_no', 'status', 'internal_code',
  'update_date', 'join_date', 'sec_agent', 'kyc_year', 'register_of_controllers',
  'corporate_tax', 'efiling_authorization', 'ac', 'audit', 'gst', 'compil_report',
  'cpf_submit', 'add_here', 'invoice_address', 'mailing_address', 'contact_window',
  'mailing_list', 'inc_date', 'shareholders', 'directors',
  'nominee_director', 'secretary', 'annual_return', 'fye', 'last_ar_date',
  'last_agm_date', 'last_accounts_date', 'next_agm_due_date', 'months_from_last_accounts',
  'remark', 'referral', 'risk_level', 'incorp_with_us', 'acra_update', 'mas', 'grade',
] as const;

export default function NameChangePage() {
  return <MasterListTable listType="name_change" title="Change Co Name" fields={[...NAME_CHANGE_FIELDS]} />;
}
