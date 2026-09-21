import type { SoaReminderProgress } from '@/lib/soa-reminder-progress';
import type { QbCompany } from '@/lib/quickbooks';

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

export function SoaReminderGroupStatus({ items }: {
  items: { source: QbCompany; progress: SoaReminderProgress }[];
}) {
  const stages = new Set(items.map(item => item.progress.completedStage ?? 0));
  if (stages.size <= 1) {
    const latest = [...items]
      .sort((a, b) => (b.progress.completedAt ?? '').localeCompare(a.progress.completedAt ?? ''))[0];
    return (
      <div style={{ textAlign: 'center' }}>
        <SoaReminderStatus progress={latest?.progress ?? items[0].progress} />
        <div style={{ marginTop: 3, color: '#94a3b8', fontSize: 9.5 }}>
          {items.map(item => item.source).join(' + ')}
        </div>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', lineHeight: 1.35 }}>
      <span style={{
        display: 'inline-block', padding: '3px 7px', borderRadius: 6,
        background: '#fffbeb', border: '1px solid #fde68a', color: '#a16207',
        fontSize: 10.5, fontWeight: 800,
      }}>
        Mixed
      </span>
      <div style={{ marginTop: 4, display: 'grid', gap: 2 }}>
        {items.map(item => (
          <div key={item.source} style={{ color: '#64748b', fontSize: 9.5, whiteSpace: 'nowrap' }}>
            {item.source} · {item.progress.completedStage ? `${item.progress.completedStage}${item.progress.completedStage === 1 ? 'st' : item.progress.completedStage === 2 ? 'nd' : 'rd'} Done` : 'Not sent'}
          </div>
        ))}
      </div>
    </div>
  );
}
