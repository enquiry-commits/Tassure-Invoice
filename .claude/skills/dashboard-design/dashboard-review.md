# Dashboard Quality Review

Before declaring a dashboard task complete, inspect every chart you touched or added and check:

1. Is this the correct visualization type (see `chart-guidelines.md`)?
2. Is chart height appropriate for the amount of data (see SKILL.md's Chart Height section)?
3. Is there excessive empty space?
4. Is the Y-axis readable (compact-formatted, not raw large numbers)?
5. Is the X-axis readable (not overloaded with labels)?
6. Are numbers formatted through `lib/chart-format.ts`, not a one-off `.toFixed()`?
7. Is the tooltip useful (period/category, metric name, formatted value)?
8. Is the legend understandable (human-readable labels, not raw field names)?
9. Are lines/bars clearly visible (no hairlines, no near-invisible fills)?
10. Are colors consistent with `lib/chart-colors.ts`'s `REPORT_COLORS`/`REPORT_PALETTE` — not a new ad hoc color picked for this one chart?
11. Does the chart work responsively (`ResponsiveContainer`, no hardcoded pixel width)?
12. Does the card communicate a clear business question, not just render a chart because the data existed?
13. Could this information be represented better as a `MetricCard` instead of a chart?
14. Could this information be represented better as a table (this app's `system-list-table` pattern) instead of a chart?
15. Is technical methodology visually subordinate (small, muted, below a divider — see the `note` prop) rather than competing with the real data?
16. Does this look like production SaaS software rather than a developer prototype?

Also, specifically for this app:

17. Did you touch real business data, a calculation in `lib/*.ts`, or an API route to make a chart "look better"? If yes, stop — that's the one non-negotiable rule in SKILL.md, not a style choice.
18. Did you introduce shadcn/ui, Tailwind utility classes, or a new component library into a page that doesn't already use them? If yes, confirm that's genuinely wanted first — see SKILL.md's stack note.
19. Ran `npx tsc --noEmit` and `npm run build` clean after the change? (`npm run lint` is NOT this project's normal verification gate — it has a large pre-existing baseline of errors in `scripts/*.js` unrelated to app code; lint only the files you actually changed if you want a signal from it.)

Do not mark the task complete until these checks pass.
