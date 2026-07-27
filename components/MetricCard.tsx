import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

interface MetricCardProps {
  value: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  icon: ReactNode;
  color?: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

export default function MetricCard({
  value,
  label,
  sub,
  icon,
  color = '#1e3a5f',
  active = false,
  href,
  onClick,
  ariaLabel,
  className,
  style,
}: MetricCardProps) {
  const interactive = Boolean(href || onClick);
  const classes = ['metric-card', interactive ? 'metric-card-interactive' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  const cardStyle: CSSProperties = {
    borderColor: active ? color : '#dfe7ec',
    boxShadow: active
      ? `0 0 0 2px ${color}20, 0 8px 24px rgba(28,52,73,.06)`
      : '0 6px 22px rgba(28,52,73,.035)',
    ...style,
  };

  const content = (
    <>
      <span className="metric-card-top">
        <span className="metric-card-icon" style={{ background: `${color}12`, color }}>
          {icon}
        </span>
        {interactive && <ArrowRight size={13} className="metric-card-arrow" />}
      </span>
      <span className="metric-card-value">{value}</span>
      <span className="metric-card-label">{label}</span>
      {sub !== undefined && sub !== null && <span className="metric-card-sub">{sub}</span>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} style={cardStyle} aria-label={ariaLabel}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        style={cardStyle}
        onClick={onClick}
        aria-label={ariaLabel}
        aria-pressed={active}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={classes} style={cardStyle}>
      {content}
    </div>
  );
}
