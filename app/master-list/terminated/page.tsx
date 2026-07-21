import MasterListTable from '@/components/MasterListTable';

export default function TerminatedPage() {
  return (
    <MasterListTable
      listType="terminated"
      title="Terminated Services"
      moveTargets={[
        { type: 'active_client', label: 'Active Client', statusValue: 'YES' },
      ]}
    />
  );
}
