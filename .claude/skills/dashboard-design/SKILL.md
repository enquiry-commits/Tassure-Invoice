# Professional Dashboard Design Skill

Use this skill whenever modifying:

- Dashboard
- Analytics
- Reports
- Management Overview
- Company Overview
- Finance Overview
- Client Overview
- KPI pages
- Revenue analytics
- AR analytics
- Task analytics
- Operational analytics

The objective is to create a professional B2B SaaS analytics experience.

Do not treat charts as decorative elements. Every visualization must answer a business question.

See also in this same skill directory: `chart-guidelines.md` (chart type selection, axes, tooltips, legends), `dashboard-layout.md` (page structure, KPI rows, grid, typography), `dashboard-review.md` (the checklist to run before calling a dashboard task done).

## This project's actual stack (read before reaching for anything else)

This app does **not** use Tailwind utility classes or shadcn/ui as its component paradigm — it styles almost everything with inline `style={{}}` objects plus a hand-rolled CSS-variable design system (`app/globals.css`: `--sidebar-bg`, `--list-header`, etc.) and a handful of shared components (`components/MetricCard.tsx`, the local `Card` pattern repeated per page). `tailwindcss` is present in `package.json` but is not the app's real styling layer — confirm with a quick `grep -c className= <file>` before assuming otherwise; it will come back near zero on most pages.

So "Component priority: 1. Existing project components" (below) means: reuse `MetricCard`, the existing `Card` pattern, and `app/globals.css`'s tokens for layout/cards/KPIs — and use **Recharts** (installed, no shadcn dependency) for the actual chart rendering, since this app has no charting library. Do not introduce shadcn/ui's Card/Badge/Tabs/Select primitives into a page that doesn't already use them — that would fight the existing architecture, not extend it. If a future page genuinely needs shadcn (e.g. it's already Tailwind-native), that's a separate, explicit decision — check `components.json` exists first.

## Component Priority

Use:

1. Existing design-system components (`MetricCard`, this project's own `Card`/`ChartTooltip` patterns)
2. Recharts, for anything chart-shaped
3. shadcn/ui — only on a page that is already Tailwind/shadcn-native
4. Tremor — only when it provides a meaningful improvement Recharts + existing components can't
5. Apache ECharts — only for advanced visualization Recharts cannot do (heatmap, Sankey, treemap, geographic map, calendar heatmap, complex relationship graph, advanced funnel)

Never manually implement a chart using raw CSS/SVG if Recharts already supports the same visualization — `components/dashboard/Charts.tsx` is the shared implementation; extend it rather than hand-rolling a one-off chart in a page.

## Dashboard Card Design

Dashboard cards should normally use:

- 12–16px radius
- 20–24px internal padding
- subtle border
- minimal or no heavy shadow
- clear title
- optional short description
- strong information hierarchy
- consistent spacing

Avoid oversized cards containing very little information.

## Chart Height

Normal dashboard chart: 260–360px
Small dashboard chart: 200–280px
Complex visualization: 320–450px

Avoid 400px+ charts when only 4–6 data points exist.

## Chart Requirements

Always consider whether the chart requires: X-axis, Y-axis, grid, tooltip, legend, data labels, reference line, comparison indicator, responsive container, empty state, loading state.

Do not hide important scale information just to make the interface minimal.

## Visual Hierarchy

Primary KPI → Comparison / Trend → Visualization → Supporting details → Methodology / disclaimer.

Technical disclaimers must not visually compete with the business data — see `dashboard-layout.md`'s "Explanatory Text" section.

## Number Formatting

Use `lib/chart-format.ts` (`formatCompactNumber`, `formatCompactCurrency`, `formatPercent`) for every chart/KPI in this app rather than a one-off `.toFixed()` — it is the one shared implementation of:

```
1284000 -> 1.28M
428300  -> 428K
12450   -> 12.5K
850     -> 850

1284000 SGD -> S$1.28M   (formatCompactCurrency)
428300 SGD  -> S$428K

0.183 -> 18.3%            (formatPercent)
```

Some pre-computed values in this app are already scaled (e.g. `lib/reports-data.ts`'s `revenueTrendThousands` stores dollars/1000) — pass `unitScale` to `formatCompactCurrency` rather than re-deriving the real amount by hand at the call site.

## Comparison Indicators

Where appropriate show ↑ 12.4% / ↓ 4.2% with a contextual label ("vs previous year", "vs last month", "vs previous period"). Do not manufacture a comparison value if the underlying data does not actually support one — see the Data Rule below.

## Responsive Design

Use Recharts' `ResponsiveContainer` (already the convention in `components/dashboard/Charts.tsx`) rather than a hardcoded pixel width. Check desktop, laptop and tablet widths, not just desktop.

## Accessibility

Sufficient contrast, readable typography, understandable tooltips, chart information not communicated by color alone, usable hover targets.

## The one non-negotiable data rule

**Never alter real business data to make a chart look better.** Do not invent values, interpolate missing values, fabricate comparisons or growth percentages, change a calculation in `lib/*.ts`/an API route, or silently drop outliers. If data quality is genuinely uncertain, show the real available data and say so in a subordinate methodology note — never hide it by smoothing the chart instead. This mirrors this repo's own root `CLAUDE.md` rule on pricing/billing data — chart work is presentation-layer only unless a change is explicitly requested and confirmed.
