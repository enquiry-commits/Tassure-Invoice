import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  value: number | string;
  label: string;
  color: 'orange' | 'yellow' | 'gray' | 'red' | 'blue' | 'green';
  Icon: LucideIcon;
  sub?: string;
}

const colors = {
  orange: { bg: '#f97316', text: '#ffffff' },
  yellow: { bg: '#d97706', text: '#ffffff' },
  gray:   { bg: '#475569', text: '#ffffff' },
  red:    { bg: '#dc2626', text: '#ffffff' },
  blue:   { bg: '#1d4ed8', text: '#ffffff' },
  green:  { bg: '#16a34a', text: '#ffffff' },
};

export default function StatCard({ value, label, color, Icon, sub }: StatCardProps) {
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
        className="w-11 h-11 rounded-full flex items-center justify-center"
        style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
      >
        <Icon size={22} strokeWidth={1.75} color="rgba(255,255,255,0.85)" />
      </div>
    </div>
  );
}
