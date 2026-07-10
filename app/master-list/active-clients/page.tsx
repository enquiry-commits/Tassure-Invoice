import MasterListTable from '@/components/MasterListTable';

export default function ActiveClientsPage() {
  return (
    <MasterListTable
      listType="active_client"
      title="Active Client"
      accentColor="#15803d"
      moveTargets={[
        { type: 'strike_off', label: 'Strike Off',          statusValue: 'STRUCK OFF' },
        { type: 'terminated', label: 'Terminated Services', statusValue: 'TERMINATED' },
      ]}
    />
  );
}
