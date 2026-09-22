# Dashboard Layout Guidelines

The dashboard should communicate, in order: **WHAT IS HAPPENING → WHY IT MATTERS → WHAT REQUIRES ATTENTION.**

Preferred structure top to bottom:

1. Page header
2. Global filters (if any)
3. Primary KPI cards
4. Primary business trend
5. Breakdown / comparison
6. Actionable table / details
7. Methodology / data notes

This app's Reports page (`app/reports/page.tsx`) already roughly follows this: header → AI narrative summary → KPI row → drill-down table (conditional) → composition donuts → service mix → trend charts → Explore (custom pivot) → a placeholder "coming later" note. Match that shape when adding a new analytics page rather than inventing a different order.

## KPI Row

Usually 3–5 important KPIs. This app's `MetricCard` is the established component — pass `active`/`onClick` when a KPI should also act as a filter toggle (Reports' "New This Year"/"Churned This Year" cards already do this).

## Card Density

Avoid large empty white areas. A card's height should fit its actual content — don't force every card in a row to the same height if their content genuinely differs. `components/dashboard/Charts.tsx`'s `HBars` already sizes itself to `data.length * 34px` rather than a fixed height, for exactly this reason.

## Dashboard Grid

Desktop: think in a 12-column grid, even though this app expresses it as CSS `grid-template-columns` with `minmax()`/`auto-fit` rather than literal Tailwind `col-span-*` classes (no Tailwind grid utilities are in use here — see SKILL.md's stack note). Common patterns already used in this app:

- 4 KPI cards: `repeat(auto-fit,minmax(190px,1fr))` (Reports), `repeat(auto-fit,minmax(180px,1fr))` (My Tasks)
- Two paired charts: `repeat(auto-fit,minmax(340px,1fr))` (Reports' Client Type / Customer Source donuts)
- A single full-width chart card: no grid, just a `Card` on its own

## Typography

Page title: strong (this app: ~20px, weight 800).
Card title: medium emphasis (~14px, weight 750).
KPI value: highest emphasis (`MetricCard`'s own large bold number).
Supporting text: secondary (~11–12px, `#64748b`/`#94a3b8`).
Disclaimer/methodology note: lowest emphasis (~10.5px, `#94a3b8`, a top border separating it from the real content — see the `note` prop on this app's `Card` component).

## Explanatory Text

Avoid long paragraphs directly under a chart competing with the data itself. This app's existing `note` prop pattern (small, muted, below a top border, after the real content) already does the right thing — keep using it rather than adding another prose block above/beside the chart. If a page's own methodology genuinely needs more than 1–2 sentences, prefer an expandable section or a tooltip over permanently-visible prose.
