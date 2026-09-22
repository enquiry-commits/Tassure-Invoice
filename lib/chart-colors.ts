// Shared by app/api/reports/route.ts (server-side donut coloring) and
// app/reports/page.tsx (every fixed chart + the Explore section's dynamic
// palette) — added 2026-09-22. Before this, the page had TWO unrelated
// palettes: a muted 5-color set (teal/blue/gold/plum/rose) for Service Mix/
// PIC Workload/the trend charts, and a separate bright, saturated array
// (teal/blue/violet/magenta/cyan/amber/red/lime/slate) for Client Type,
// Customer Source, and Explore — the SAME page reading as two different
// design systems depending which chart you looked at (Vincent: "Reports 的
// 界面颜色还是要调整好"). One palette now, everywhere on this page: the 5
// named accents plus 5 more tonally-related variants (same muted,
// desaturated family — not bright/saturated) for when a dimension has more
// than 5 categories.
// `navy`/`muted` added 2026-09-22 — app/page.tsx's Dashboard had its own
// separate DASHBOARD_COLORS object with the SAME 6 named values as this
// palette plus these 2 extras, defined a second time rather than imported
// (dashboard upgrade package, section 11: "Do not randomly assign colors
// per chart... establish semantic chart tokens"). One source now — see
// app/page.tsx's own DASHBOARD_COLORS, which re-points at this object
// instead of redefining it.
export const REPORT_COLORS = { ink: '#102a43', navy: '#234e70', teal: '#397f78', blue: '#557795', gold: '#b98243', plum: '#746487', rose: '#b45f6b', muted: '#a8b5c2' };

export const REPORT_PALETTE = [
  REPORT_COLORS.teal, REPORT_COLORS.blue, REPORT_COLORS.gold, REPORT_COLORS.plum, REPORT_COLORS.rose,
  '#5c8f7f', '#7c96ab', '#c99a5c', '#9483a0', '#a8707c',
];
