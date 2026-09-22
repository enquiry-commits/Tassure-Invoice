# Reports V3 — Phase 1 Implementation Plan (Analytics Correctness)

**Status: plan only, per Vincent's explicit instruction ("Do not start Phase
2 until Phase 1 has been implemented and validated" / "provide the detailed
implementation plan for PHASE 1 only" before changing more production
code). Nothing beyond this document has been written this turn.**

Scope: Vincent's 8-item Phase 1 list, from "The audit is approved... We
will follow this order." Cross-referenced against
`docs/MANAGEMENT_ANALYST_GAP_ANALYSIS.md` and what was already shipped in
the immediately preceding turn (before this phased breakdown was given).

---

## 0. What's already done vs what this plan covers

Three of the 8 items were already substantially built in the prior turn
(under the earlier, less formally-phased request) — this plan does NOT
re-propose them, only notes their current state and any real gap that
remains:

| # | Item | State |
|---|---|---|
| 1 | Comparable Period Engine | **Done.** `lib/reporting-period.ts`, `lib/reports-data.ts`'s `computeComparableRevenue()`. INV-DATA-059. |
| 3 | Missing ≠ Zero | **Done for revenue/invoice-count.** `computeRevenueTrend()` returns `null`, `components/dashboard/Charts.tsx` renders gaps not 0-bars. **Not yet applied to Client Flow** (see §3 below — a real, different design question, not a copy-paste). |
| 4 | Clear YTD / Full-Year labeling | **Done as a display label** ("2026 YTD" on chart X-axis). **Not yet a structured metadata field** other consumers (the Metric Catalogue, a future UI badge) could read without parsing a string — see §4. |

This plan covers completing §3/§4's remaining gap, plus building items 2,
5, 6, 7, 8 from scratch.

---

## 1. Metric Catalogue

### Files
- **New**: `lib/metric-catalogue.ts`

### Interface
```ts
export type MetricStatus = 'available' | 'partial' | 'planned';
export type MetricDefinition = {
  metricId: string;                // e.g. 'revenue_ytd_comparable'
  name: string;
  businessDefinition: string;      // plain-English, for a future "ⓘ" tooltip
  formula: string;                 // human-readable, e.g. "SUM(quickbooks_invoices.total_amt) WHERE txn_date IN period"
  numerator: string;
  denominator: string | null;
  periodRule: string;              // e.g. "YTD vs previous YTD, validated by buildReportingContext()"
  filters: string[];
  currency: 'SGD' | null;
  owner: string;                   // the function that actually computes it — e.g. "lib/reports-data.ts:computeComparableRevenue"
  version: string;                 // bump when the formula changes, so a narrative citing an old version is a real signal
  status: MetricStatus;
};
export const METRIC_CATALOGUE: MetricDefinition[] = [ /* ... */ ];
```

### Data flow
This is a **documentation/registry layer describing existing calculations**
— per spec §14 ("Do not duplicate logic inside prompts"), it does NOT
recompute anything. Each entry's `owner` field points at the real function
in `lib/reports-data.ts` that already does the math. Initial population:
every metric already live today (Active Clients, New/Churned/Net Client
Growth, Revenue YTD comparable, Average Invoice Value, Service Mix counts,
Staff Workload) — `status: 'available'`. Phase 2/3 metrics (GRR, NRR, ARPC,
Revenue Bridge components) get added to this SAME registry as
`status: 'planned'` now, `'available'` once actually built — so the
registry never drifts from reality the way an aspirational doc would.

### Where it surfaces in Phase 1
Two consumers, both additive:
1. `lib/reports-narrative.ts`'s system prompt gets a short reference to the
   catalogue's `periodRule` text for `comparableRevenueYoy`, replacing the
   current inline hard-coded description — one source of truth for "how is
   this defined" instead of the definition living only in the prompt
   string.
2. Exposed as a plain export other Phase-1 code (the new validation guard,
   §7) can import — e.g. to confirm a claimed metric name against a real
   `metricId` before trusting a narrative's citation of it.

**Explicitly NOT in Phase 1 scope**: an interactive "ⓘ Methodology" UI
popover (dashboard-design skill's own suggested pattern). That's a Reports
V3 UI task, not an analytics-correctness one — building the registry now
means the UI can read it later with zero rework.

### Migration requirements
None — pure TypeScript, no DB table.

### Tests
A diagnostic script asserting every `owner` reference actually resolves to
a real exported function name (`grep`-based, catches a typo/rename before
it silently goes stale) — folded into §8's test file, not a separate one.

### Backward compatibility / risk
None — net-new file, nothing else imports it yet until steps above wire it
in.

---

## 2. Missing ≠ Zero — completing Client Flow

### The real difference from Revenue's case
`quickbooks_invoices` has a clean, provable boundary: zero rows exist
before 2024-01-02, so "this year never appears in the aggregation" reliably
means "no data collected," never "zero business activity." `master_list`
has no equivalent clean boundary — Tassure's client base predates the
YEARS_BACK=5 window, so a year with zero entries in `newByYear`/
`churnedByYear` could mean either "genuinely zero new/churned clients that
year" (a real, meaningful business fact worth showing as 0) or "the
`join_date`/`update_date` free-text values for that year's rows failed to
parse" (a data-quality problem that should NOT be silently rendered as a
real zero either). These need different handling, not the same null-if-
absent rule revenue used.

### Files
- **Modify**: `lib/reports-data.ts` (`computeClientFlow`)
- **Modify**: `app/api/reports/route.ts` (consumes `computeClientFlow`'s
  output, builds `newClientsTrend`/`churnedTrend`)

### Design
Track parse success alongside the count, not just the count:
```ts
export function computeClientFlow(masterList: Record<string, unknown>[]) {
  const newByYear: Record<number, number> = {};
  const newParseFailuresByYear: Record<number, number> = {};
  // ... same loop, but also increment a failure counter when
  // parseFlexibleDate() returns null for a row that otherwise looks like
  // it should count (e.g. list_type indicates it's a real active-client
  // row with SOME join_date text present but unparseable) ...
  return { newByYear, churnedByYear, /* + failure counts */ };
}
```
Then in `route.ts`: a year renders as a real `0` (not null) UNLESS its
own parse-failure count for that year is high relative to expected volume
— in which case it renders `null` with a distinct tooltip reason
("data quality: N records for this year had an unparseable date"), never
silently conflated with "genuinely zero." This is a judgment call on the
threshold (e.g. "any failures at all" vs "failures exceeding N%") that
should be confirmed rather than picked silently — flagged as an open
question below.

### Open question for Vincent (do not guess)
What threshold makes a year's client-flow count untrustworthy enough to
show as "data quality issue" instead of a real number? Zero tolerance (any
parse failure flags the year) is the safest default and what this plan
will implement unless told otherwise, but it may flag more years than
useful, since `lib/date.ts`'s own documented coverage gaps are real
(non-date free text like "struck off by client" is expected on some rows,
not a bug).

### Migration requirements
None.

### Tests
`year with 0 real new-client rows renders 0`, `year with a parse-failure-
heavy sample renders null with a data-quality reason` — added to §8's file.

### Backward compatibility / risk
`Pt.value` is already `number | null` app-wide (shipped with the revenue
fix) — no further type widening needed. Risk: getting the threshold wrong
in either direction (too strict = years that are actually fine show as
"no data," eroding trust in the flag the same way a guard that cries wolf
does per INV-DATA-044's own documented lesson; too loose = a real data-
quality problem still renders as a trustworthy 0). This is exactly why the
threshold is called out as a question, not assumed.

---

## 3. Clear YTD / Full-Year — structured metadata

### Files
- **Modify**: `components/dashboard/Charts.tsx` (`Pt` type)
- **Modify**: `app/api/reports/route.ts` (where `yearLabel()` currently
  only touches the display string)

### Design
Add an optional `complete?: boolean` field to `Pt` (defaults to `true` via
absence, so every existing caller is unaffected):
```ts
type Pt = { label: string; value: number | null; color?: string; complete?: boolean };
```
`route.ts` sets `complete: false` on the current year's point instead of
(in addition to) appending "YTD" to the label string — the CHART keeps
reading the label for its own display text (no rendering change needed),
but any OTHER consumer (the Metric Catalogue's `periodRule`, a future
narrative-validation guard, an eventual UI badge) can check `complete`
as real structured data instead of pattern-matching " YTD" out of a label
string, which is fragile (breaks the moment the label wording changes).

### Migration requirements
None.

### Tests
`current year's Pt carries complete:false`, `prior years carry complete
true (or the field absent)` — added to §8.

### Backward compatibility / risk
None — additive optional field, `Charts.tsx` doesn't need to change its
own rendering logic at all in Phase 1 (it doesn't need to KNOW about
`complete`; it already shows the "YTD" text via `label`).

---

## 4. FACT / INFERENCE / HYPOTHESIS / ACTION + Severity/Confidence separation

Grouping these together (spec items 5+6) since they're one coherent schema
change to the same tool call, not two.

### Files
- **Modify**: `lib/reports-narrative.ts` (`ANALYSIS_TOOL` schema, system
  prompt, `ReportsNarrative`/`ReportsInsight` types, `summarizeForPrompt`)
- **Modify**: `app/api/reports/narrative/route.ts` (`parseCachedNarrative`'s
  validation — see Migration requirements below)
- **Modify**: `app/reports/page.tsx` (the AI Analysis card's render —
  currently one signal badge + title + body; needs the new structured
  fields)

### Interface — replaces `ReportsInsight`
```ts
export type ReportsSeverity = 'good' | 'watch' | 'warning'; // unchanged 3-level for Phase 1 — spec's own 5-level (INFORMATION/WATCH/OPPORTUNITY/RISK/CRITICAL) is a Reports V3 UI-polish concern, not analytics-correctness; expanding it is a fast Phase-1.5 follow-up once this schema ships, not bundled in here to keep this change reviewable as one thing
export type ReportsConfidence = 'high' | 'medium' | 'low'; // NEW — independent axis from severity
export type ReportsInsight = {
  severity: ReportsSeverity;               // renamed from `signal` for clarity — same 3 values
  confidence: ReportsConfidence;           // NEW
  titleZh: string; titleEn: string;
  observedZh: string; observedEn: string;      // FACT — directly from comparableRevenueYoy/kpis/etc., never a number the model invented
  driverZh: string; driverEn: string;          // INFERENCE — a reasonable read of the observed facts, still hedged
  notYetProvenZh: string[]; notYetProvenEn: string[]; // HYPOTHESIS — explicit list of unproven alternative explanations (spec §11's own example: pricing / service mix / client mix / billing frequency / one-off engagements)
  nextActionZh: string; nextActionEn: string;  // ACTION
};
```
Tool schema (`ANALYSIS_TOOL.input_schema`) updated to require these exact
fields per insight, `minItems`/`maxItems` unchanged (2-4). System prompt
rewritten to walk the model through this exact FACT→INFERENCE→HYPOTHESIS→
ACTION sequence per insight (mirrors spec §11's own worked example almost
verbatim), and to require `confidence` be justified independently of
`severity` — a `warning`-severity insight can still be `low` confidence
(e.g. "AR overdue amount rose" is a fact worth flagging even if the WHY is
uncertain).

### Data flow
`summarizeForPrompt()` unchanged in what it feeds the model (already fixed
last turn — `comparableRevenueYoy`, null-preserving `revenueByYear`, the
Metric Catalogue's `periodRule` text per §1 above). Only the OUTPUT shape
the model must return changes.

### UI change
`app/reports/page.tsx`'s AI Analysis card currently renders `signal` badge
+ `titleZh/En` + `bodyZh/En` as one paragraph. Restructured to render each
of the 4 sections as its own visually distinct line (label + text), plus a
small `confidence` tag separate from the `severity` color/badge — matching
spec §11's own layout intent, without yet building the full Signal Card /
"Analyse Drivers" button UI from the ORIGINAL Reports V3 spec's §10 (that's
still P1/P2 of the wider Reports V3 effort per the earlier plan, not part
of THIS narrower 8-item Phase 1 list Vincent just gave — flagged as a scope
boundary, not silently expanded).

### Migration requirements
**None**, but `app/api/reports/narrative/route.ts`'s `parseCachedNarrative()`
validation must be tightened in the SAME change, reusing the exact
precedent already in that file's own comment (a round-1→round-2 cache-
shape transition was already handled this same way, no migration, just a
smarter validity check): change the `Array.isArray(parsed?.insights)` check
to also verify each insight has the new required fields (e.g.
`typeof i.observedZh === 'string'`), so an old-shape cached row (today's
`signal`/`bodyZh` shape) is correctly treated as a cache miss and
regenerated fresh on next load — never rendered with missing fields.

### Tests
Schema-shape assertions (every required field present on a real generated
response) + the specific worked example from spec §11 (avg invoice value
up, invoice count down) run through the real prompt once, output inspected
by hand before considering this done — same "verify against a real
generation, not just types" discipline as `lib/reports-narrative.ts`'s
existing header comment already establishes for this file.

### Backward compatibility / risk
Real risk: this is a bigger prompt/schema change than anything else in
Phase 1 — the model could return well-formed JSON that still reads badly
(e.g. `notYetProven` too vague, `driver` overstepping into unhedged
causal language) even with the schema enforcing SHAPE, not judgment
quality. §7's guard is the backstop for exactly this, not this section
alone.

---

## 5. Narrative output validation guardrails (AI Language Guard)

### Files
- **New**: extend the existing guard family, likely as new exported
  functions in `lib/reports-narrative.ts` itself (co-located with the
  schema/prompt they validate, same pattern `app/api/assistant/route.ts`
  uses for its own reply-scanning guards) rather than a new file — small,
  tightly coupled to this one prompt.
- **Modify**: `generateReportsNarrative()`'s return path — apply the guard
  before returning, same "guard runs once, on the final output" lesson
  INV-AI-004 already established for the chat assistant (don't repeat that
  mistake here).

### Design
Two checks, deterministic (regex-based), same family as
`app/api/assistant/route.ts`'s `claimsGenericCapabilityDenial()` etc.:

1. **Forbidden unhedged causal language** (spec §26) — scan `driverZh/En`
   specifically (the INFERENCE field, where overreach is most likely) for
   patterns like `因为.*所以|证明了|proves|caused by|由此可见` without a
   hedge word nearby (可能/大概/likely/may/possibly) in the same sentence.
   On a hit: prepend a correction note to that insight (never silently
   drop content) and log it — same non-destructive pattern every other
   guard this session uses.
2. **Comparable-claim cross-check** — if `observedZh/En` or `driverZh/En`
   contains a percentage figure AND `comparableRevenueYoy.comparable ===
   false`, flag it — the model was told not to cite a % change when
   `comparable` is false; this is the deterministic backstop confirming it
   actually didn't, the same "prompt wording alone already failed once
   before, back it with a regex" lesson INV-AI's own history documents
   repeatedly for the chat assistant.

### Migration requirements
None.

### Tests
Real incident-shaped cases (an insight WITH a hedge word — must pass; an
insight WITHOUT one — must flag; a `comparable:false` scenario with a %
figure anyway — must flag) — added to §8's file, mirroring
`test-reply-guards.ts`'s own established true/false-case structure.

### Backward compatibility / risk
Same risk INV-DATA-044 already documents for the chat guards: a check that
fires on legitimate prose erodes trust fast. Needs the same "must NOT
be flagged" negative-case testing as `test-reply-guards.ts` before
shipping, not just the positive/catches-the-bug cases.

---

## 6. Analytics calculation tests / diagnostic guards

### Files
- **New**: `test-reporting-period.ts` (repo root, `npx tsx test-
  reporting-period.ts`, same convention as `test-reply-guards.ts`/
  `test-orchestrator.ts`)
- **New**: `test-reports-narrative-guards.ts` (§5's guard tests)

### Coverage against Vincent's own 7-item TESTING list
| # | Case | Status this phase |
|---|---|---|
| 1 | Partial year vs full year comparison rejection | **Built now** — `resolvePeriod('ytd', ...)` vs a full-year `custom` range have different `days`, `checkComparable()` rejects. |
| 2 | Same-period YoY acceptance | **Built now** — `ytd` vs `previous_ytd`. |
| 3 | Missing data != zero | **Built now** — `computeRevenueTrend()`'s null-for-absent-year case; Client Flow's version per §2 above once its threshold question is answered. |
| 4 | Service eligibility unknown → no attach-rate opportunity | **Not applicable yet** — no eligibility engine exists (Phase 4, and Phase 4 is explicitly "design the rule spec only, do not implement eligibility logic yet" per Vincent's own instruction below). Reserved as a named-but-empty test case, not skipped silently — a placeholder that fails loudly if anyone tries to compute an opportunity score before Phase 4 real eligibility exists. |
| 5 | Client count growth does not imply revenue growth | **Partially built** — this is really testing that the NARRATIVE doesn't make this specific unsupported leap, which is what §5's guard family is for; a targeted test case using the spec's own numbers (net client count +80, revenue -10%) run through the real narrative generator once, output inspected for the forbidden conclusion. |
| 6 | Revenue bridge reconciliation | **Not applicable yet** — Phase 2. Reserved, same as #4. |
| 7 | Opening + new − churn = closing client reconciliation | **Not fully applicable yet** — "Opening Clients" isn't a computed metric until Phase 3 item 1. A lighter version IS buildable now as a real sanity check on what already exists: `closing (kpis.activeClients) - netGrowthThisYear === "opening"`, where opening is back-derived rather than independently sourced — useful as an internal consistency check today, but not the real spec test (which wants opening/new/churned/closing as 4 INDEPENDENTLY computed numbers that happen to reconcile, catching a real bug if they don't; a back-derived number can never fail that check by construction). Recommend building the LIGHT version now, and flag that the REAL version is a Phase 3 deliverable, not faked in Phase 1. |

### Migration requirements
None.

### Backward compatibility / risk
None — new test files only.

---

## 7. Cross-cutting: "no chart/module independently determines its own
comparison period"

Vincent's own instruction: "Do not let individual charts or narrative
modules independently determine comparison periods." Audited against
current code: `lib/reports-narrative.ts` already goes through
`data.revenue.comparableYoy` (computed once, in `route.ts`, via
`buildReportingContext()`) rather than picking its own period — fixed last
turn. The remaining risk is future code (Phase 2's revenue bridge, Phase
3's cohort work) reaching for a DIFFERENT ad hoc period calculation instead
of `lib/reporting-period.ts`. Mitigation for Phase 1: add a short, direct
comment at the top of `lib/reporting-period.ts` itself (not just relying on
this plan doc) stating this is the ONLY sanctioned period-resolution path
in this codebase — the same kind of durable, load-bearing comment INV-*
entries already model throughout this codebase, so the NEXT person (human
or AI) touching Phase 2/3 code finds the rule at the point of use, not only
in a planning doc that gets superseded.

---

## Summary: files touched in Phase 1

| File | Change |
|---|---|
| `lib/metric-catalogue.ts` | **New** |
| `test-reporting-period.ts` | **New** |
| `test-reports-narrative-guards.ts` | **New** |
| `lib/reports-data.ts` | `computeClientFlow` gains parse-failure tracking |
| `app/api/reports/route.ts` | Client Flow null-handling; `Pt.complete` field set |
| `components/dashboard/Charts.tsx` | `Pt.complete?: boolean` (additive) |
| `lib/reports-narrative.ts` | New `ReportsInsight` schema (FACT/INFERENCE/HYPOTHESIS/ACTION + confidence), new guard functions |
| `app/api/reports/narrative/route.ts` | `parseCachedNarrative()` validates new required fields |
| `app/reports/page.tsx` | AI Analysis card renders the new 4-section structure + confidence tag |
| `lib/reporting-period.ts` | Header comment only — "the only sanctioned period-resolution path" |

No new database table, no migration script, for any Phase 1 item.

## Open questions before implementation starts

1. Client Flow's missing-data threshold (§2) — zero-tolerance default
   proposed; confirm or adjust.
2. Confirm the 3-level severity stays 3-level for Phase 1 (not expanding to
   the original spec's 5-level INFORMATION/WATCH/OPPORTUNITY/RISK/CRITICAL
   yet) — proposed as a Phase-1.5/Reports-V3-UI follow-up, not bundled here.

## Risks (consolidated)

- §4's schema change is the largest single change in this phase — a prompt
  that returns well-shaped-but-still-overreaching text is a real residual
  risk §5's guard only partially covers (regex can't catch everything
  unhedged prose might say).
- §2's threshold choice can go wrong in either direction (over- or under-
  flagging) — needs Vincent's confirmation, not a silent pick.
- Everything else (§1, §3, §6, §7) is low-risk, additive, no existing
  behavior changes for any current caller.
