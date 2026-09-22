// Shared number formatting for every dashboard/chart surface — dashboard
// design skill, section "Number Formatting": 1284000 -> 1.28M, 428300 ->
// 428K, 12450 -> 12.5K, 850 -> 850. One implementation so every chart
// abbreviates the same way instead of each call site rolling its own.
export function formatCompactNumber(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${trimTrailingZero((abs / 1_000_000).toFixed(2))}M`;
  if (abs >= 1_000) return `${sign}${trimTrailingZero((abs / 1_000).toFixed(1))}K`;
  return `${sign}${Math.round(abs)}`;
}

function trimTrailingZero(s: string): string {
  return s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

// `unitScale` lets a caller pass a value already expressed in another unit
// (e.g. lib/reports-data.ts's revenueTrendThousands stores dollars/1000) so
// this can still show the REAL magnitude without the caller pre-formatting
// strings itself. Default 1 — value is already in real units.
export function formatCompactCurrency(n: number, opts: { prefix?: string; unitScale?: number } = {}): string {
  const prefix = opts.prefix ?? 'S$';
  const real = n * (opts.unitScale ?? 1);
  return `${prefix}${formatCompactNumber(real)}`;
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}
