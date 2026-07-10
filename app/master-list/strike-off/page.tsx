import MasterListTable from '@/components/MasterListTable';

export default function StrikeOffPage() {
  return (
    <MasterListTable
      listType="strike_off"
      title="Strike Off"
      accentColor="#b91c1c"
      moveTargets={[
        { type: 'active_client', label: 'Active Client', statusValue: 'YES' },
      ]}
    />
  );
}
