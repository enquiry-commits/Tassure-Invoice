interface SectionCardProps {
  title: string;
  count?: number;
  children: React.ReactNode;
  className?: string;
}

export default function SectionCard({ title, count, children, className = '' }: SectionCardProps) {
  return (
    <div className={`bg-white rounded-xl shadow-sm overflow-hidden ${className}`}>
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ backgroundColor: '#1d3a5c' }}
      >
        <h2 className="text-white font-semibold text-sm">
          {title}{count !== undefined ? ` (${count})` : ''}
        </h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
