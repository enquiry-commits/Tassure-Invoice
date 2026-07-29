interface SectionCardProps {
  title: string;
  count?: number;
  children: React.ReactNode;
  className?: string;
}

export default function SectionCard({ title, count, children, className = '' }: SectionCardProps) {
  return (
    <div className={`system-list-shell ${className}`}>
      <div className="system-list-title-bar px-4 py-3 justify-between">
        <h2 className="system-list-title">
          {title}{count !== undefined ? ` (${count})` : ''}
        </h2>
      </div>
      <div>{children}</div>
    </div>
  );
}
