import MasterListTable from '@/components/MasterListTable';

// Same full column set every other default-fields page gets (see COLUMNS in
// MasterListTable.tsx), with the four eot_* fields inserted right after
// company_name — the columns specific to this page's extension records
// (see scripts/add-master-list-eot-fields.sql).
const EOT_FIELDS = [
  'company_name', 'eot_event', 'eot_fye_year', 'eot_original_due_date', 'eot_revised_due_date',
  'roc_no', 'status', 'internal_code',
  'update_date', 'join_date', 'sec_agent', 'kyc_year', 'register_of_controllers',
  'corporate_tax', 'efiling_authorization', 'ac', 'audit', 'gst', 'compil_report',
  'cpf_submit', 'add_here', 'invoice_address', 'mailing_address', 'contact_window',
  'mailing_list', 'inc_date', 'shareholders', 'directors',
  'nominee_director', 'secretary', 'annual_return', 'fye', 'last_ar_date',
  'last_agm_date', 'last_accounts_date', 'next_agm_due_date', 'months_from_last_accounts',
  'remark', 'referral', 'risk_level', 'incorp_with_us', 'acra_update', 'mas', 'grade',
] as const;

export default function EotPage() {
  return <MasterListTable listType="eot" title="EOT" accentColor="#b45309" fields={[...EOT_FIELDS]} />;
}
