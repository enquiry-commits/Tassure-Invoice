import MasterListTable from '@/components/MasterListTable';

// Reduced, reordered column set per user request — Code, Update Date,
// Shareholders, Directors, Nominee Director, Secretary, Annual Return, FYE,
// Last AR/AGM/Accounts Date, Next AGM Due, >13M Accts, MAS, Grade are
// dropped from THIS view only. Other Master List pages are unaffected.
const AD_HOC_FIELDS = [
  'company_name', 'roc_no', 'status', 'join_date', 'sec_agent', 'kyc_year',
  'register_of_controllers', 'corporate_tax', 'efiling_authorization',
  'ac', 'audit', 'gst', 'compil_report', 'cpf_submit', 'add_here',
  'invoice_address', 'mailing_address', 'contact_window', 'mailing_list',
  'email', 'tel', 'inc_date', 'remark', 'referral', 'risk_level',
  'incorp_with_us', 'acra_update',
] as const;

export default function AdHocPage() {
  return (
    <MasterListTable
      listType="ad_hoc"
      title="Ad-Hoc"
      accentColor="#0e7490"
      fields={[...AD_HOC_FIELDS]}
    />
  );
}
