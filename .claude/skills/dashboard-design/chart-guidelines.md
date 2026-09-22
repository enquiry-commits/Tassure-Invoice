# Dashboard Chart Guidelines

## Chart Selection

**Line chart** — trends over time, growth trajectories, time-series comparisons.
Examples: Revenue by Month, Client Growth, Invoice Volume Trend, this app's own "Client Flow by Year" (New vs Churned — a real per-year value whose SHAPE across ordered years matters, which only a line communicates at a glance).

**Area chart** — cumulative trends, emphasizing volume, an important primary time-series metric. Not used purely for decoration.

**Vertical bar chart** — category comparisons, year-to-year values, discrete period comparisons.
Examples: Revenue by Year, Clients by Department.

**Horizontal bar chart** — rankings, long category names, top customers, outstanding balances.
Examples: Top 10 Clients by Revenue, Largest AR/SOA Balances, Service Mix, Staff Workload (all already `HBars` in this app).

**Stacked bar chart** — composition over time, status breakdown.
Examples: Active vs Churned Clients over time, Paid vs Outstanding Invoices, task status.

**Combo chart** — two related metrics with genuinely different units, e.g. Revenue + Invoice Count. Bars normally represent volume/value; lines normally represent trend/count/rate. A dual-axis combo chart is a legitimate, established pattern (Recharts supports a second `yAxisId` cleanly) — it is not automatically wrong, but two scales on one plot area IS genuinely harder to read than either metric on its own, so confirm the combo actually earns its place over two separate single-axis charts before building one. This app currently keeps Revenue (bar) and Average Invoice Value (line, a single derived ratio) as two separate cards rather than one dual-axis combo — a deliberate choice made 2026-09-22 specifically to avoid a dual-axis plot; changing that back to a combo chart is a real design decision, not just an implementation upgrade, so confirm it rather than silently reverting.

**Donut chart** — simple composition, 2–5 categories. Avoid many categories on a donut; use a table or horizontal bars instead once a dimension has more than ~8 real values (see `app/reports/page.tsx`'s Explore section, which already switches from `Donut` to `HBars` past 8 categories).

**KPI card** — a single important value. Not every metric needs a chart — `MetricCard` already exists for this in this app.

**Progress / target visualization** — Actual vs Target (Revenue Target, Collection Target, Task Completion). Nothing in this app currently has a real target/goal value stored anywhere — never fabricate one; this pattern only applies once a real target exists in the data.

**Table** — detailed values, rankings, records requiring action, or anywhere precision matters more than visual trend. This app's own `system-list-table`/`system-list-shell` classes are the established table pattern — reuse them, don't reinvent a table style per page.

**Apache ECharts** — only for a Heatmap, Sankey, Treemap, Geographic Map, Calendar Heatmap, complex relationship graph, advanced funnel, or genuinely complex multidimensional visualization Recharts cannot do. Do not use ECharts for a basic bar or line chart — this app has none of the above needs today.

## Axis Rules

**Y-axis**: readable values (`0`, `100K`, `200K`) via `formatCompactNumber`/a chart's own `tickFormatter`, never raw `0`, `100000`, `200000`. If the scale matters, keep the axis — don't hide it to look minimal.

**X-axis**: keep labels readable; don't overload with labels. For many dates, reduce tick density (Recharts' `interval` prop) rather than shrinking the font until it's unreadable.

## Grid Rules

Subtle horizontal grid lines (`CartesianGrid vertical={false}`, a light stroke like `#eef2f7`) where they improve readability. Avoid strong grids. Vertical grid lines normally disabled unless genuinely useful.

## Line Rules

Lines must be clearly visible — this app's own convention is `strokeWidth={2.5}`, never a hairline. Show real per-point markers only when the dataset is small and individual points matter (this app's charts are almost always yearly, 4–8 points, so markers are normally on) — don't render dozens of markers on a dense time series.

## Tooltip

Every tooltip in this app goes through the shared `ChartTooltip` component in `components/dashboard/Charts.tsx` — Period/Category, metric name, a formatted value via the chart's own `valueFormatter`. Don't build a one-off tooltip per chart.

## Legend

Short, human-readable labels ("Revenue", "Invoice Count") — never a raw field/column name like `quickbooks_invoice_total_amount_sum`.

## Data Labels

Use selectively. `HBars` shows a data label at the end of each bar (rankings genuinely benefit from the exact number being visible); `VBars`/`LineChart` rely on tooltip + axis instead, since labeling every bar/point on a denser chart creates clutter.
