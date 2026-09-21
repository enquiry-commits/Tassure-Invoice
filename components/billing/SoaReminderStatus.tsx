import type { SoaReminderProgress } from '@/lib/soa-reminder-progress';

export function SoaReminderStatus({ progress }: { progress: SoaReminderProgress }) {
  if (!progress.completedLabel) {
    return <span style={{ color: '#94a3b8', fontSize: 11 }}>Not sent</span>;
  }
  const sentDate = progress.completedAt
    ? new Date(progress.completedAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' })
    : null;
  return (
    <div style={{ lineHeight: 1.35 }}>
      <span style={{
        display: 'inline-block', padding: '3px 7px', borderRadius: 6,
        background: '#ecfdf5', border: '1px solid #bbf7d0', color: '#15803d',
        fontSize: 10.5, fontWeight: 800, whiteSpace: 'nowrap',
      }}>
        {progress.completedLabel}
      </span>
      {sentDate && <div style={{ marginTop: 3, color: '#94a3b8', fontSize: 9.5 }}>{sentDate}</div>}
    </div>
  );
}
