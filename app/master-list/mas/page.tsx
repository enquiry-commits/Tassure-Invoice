import MasterListTable from '@/components/MasterListTable';

// Reduced column set per user request — this view only.
const MAS_FIELDS = [
  'company_name', 'roc_no', 'fye', 'last_accounts_date', 'next_agm_due_date', 'mas',
] as const;

export default function MasPage() {
  return (
    <MasterListTable
      listType="mas"
      title="MAS"
      fields={[...MAS_FIELDS]}
    />
  );
}
