interface StatCardProps {
  value: number | string;
  label: string;
  color: 'orange' | 'yellow' | 'gray' | 'red' | 'blue' | 'green';
  icon?: string;
  sub?: string;
}

const colors = {
  orange: { bg: '#f97316', text: '#ffffff', icon: '#ffedd5' },
  yellow: { bg: '#d97706', text: '#ffffff', icon: '#fef3c7' },
  gray:   { bg: '#475569', text: '#ffffff', icon: '#e2e8f0' },
  red:    { bg: '#dc2626', text: '#ffffff', icon: '#fee2e2' },
  blue:   { bg: '#1d4ed8', text: '#ffffff', icon: '#dbeafe' },
  green:  { bg: '#16a34a', text: '#ffffff', icon: '#dcfce7' },
};

export default function StatCard({ value, label, color, icon = '🏢', sub }: StatCardProps) {
  const c = colors[color];
  return (
    <div
      className="rounded-xl p-5 flex items-center justify-between shadow-sm"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      <div>
        <div className="text-3xl font-bold leading-none">{value}</div>
        <div className="text-sm font-medium mt-1 opacity-90">{label}</div>
        {sub && <div className="text-xs mt-0.5 opacity-70">{sub}</div>}
      </div>
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
        style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
      >
        {icon}
      </div>
    </div>
  );
}
