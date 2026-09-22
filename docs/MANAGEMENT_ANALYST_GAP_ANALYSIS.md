# AI Management Analyst — Gap Analysis

**Status: audit only, per Vincent's explicit instruction ("Do not implement
anything yet"). Nothing in this document has been built. No production
code, schema, or prompt was changed to produce it.**

Source spec: `TASSURE_AI_Management_Analyst_Package.md` (Vincent's
Downloads folder, 2026-09-22). This doc audits that spec section-by-section
against the REAL current state of this repo — verified against live
Supabase schema and real row counts, not assumed from memory.

---

## 0. Headline finding

**The exact failure mode the spec calls out first — "comparing partial-year
revenue with a full prior year and calling it YoY" — is already live in
production today**, in the one feature this whole package is meant to
replace (`lib/reports-narrative.ts`, the Reports page's "AI 分析" card,
shipped 2026-09-22, same day as this audit).

`app/api/reports/route.ts` builds its `years` array as fixed calendar years
(`thisYear - YEARS_BACK + 1 … thisYear`) and `computeRevenueTrend()` sums
every invoice falling in each calendar year. The current year's bucket
(2026) necessarily contains only Jan–Sep so far; every prior year's bucket
is a full 12 months. `lib/reports-narrative.ts`'s `pctChange(revenueByYear[
lastIdx], revenueByYear[lastIdx - 1])` then computes "2026 (9 months) vs
2025 (12 months)" and hands the model that ratio labeled `revenueYoyPct` —
a real, reproducible instance of the spec's own Bad Output #3 example
("Revenue declined 14.4% YoY" without checking equivalent periods).

This isn't a knock on that feature — it already does several things the
spec asks for (see §3) — it's the clearest possible proof that a
**Comparable Period Engine (spec §6, Phase 1 priority #1) is the correct
first thing to build**, not a theoretical gap.

---

## 1. Investigation method

Checked directly against the live system, not assumed from prior session
notes:

- Queried real Supabase schema (columns) for 27 tables via the service-role
  key already in `.env.local` — every column list in §2 below is a live
  `select('*').limit(1)` result, not a migration-script guess.
- Read `lib/reports-narrative.ts`, `app/api/reports/route.ts`,
  `lib/reports-data.ts` in full — the actual current "AI analysis" feature.
- Read `app/api/assistant/route.ts`'s prompt/tool architecture, already
  covered extensively earlier this session (INV-AI-004/005/006).
- Read `lib/ai-learning/{candidates,conversations,patterns}.ts`,
  `lib/user-memories.ts` — the existing memory/learning system.
- Checked real row counts/date ranges: 952 companies (911 active), 8,017
  QuickBooks invoices spanning 2024-01-02 to 2026-09-22 (~33 months).
- Checked for a persisted invoice line-item table — none exists
  (`quickbooks_invoice_line_items`/`_lines` all 404 against the real
  schema); line-item detail is fetched live from the QuickBooks API
  per-invoice on demand (`lib/quickbooks-invoice-lines.ts`), never bulk-
  synced for analytics.
- Checked `generated_invoices.services` — real sample row: `["Deferred",
  "Secretary", "AR"]`, `total_amt: 660` — service NAMES tagged per invoice,
  no itemized per-service dollar split.

---

## 2. Current state snapshot (the 9 requested inspection areas)

### 1–2. Database schema / report-generation logic

Real tables relevant to this package (live column lists, abbreviated):

| Table | Key columns for this package |
|---|---|
| `companies` | `company_name, fye_month, pic/sec_pic/acc_pic/tax_pic, uses_address/has_nd/has_xbrl/has_accounts/has_tax, is_active, client_type, tw_status, customer_source, ssic_description_1/2, services_manual` |
| `master_list` | `list_type` (active_client/strike_off/terminated/mas/ad_hoc/…), `join_date, update_date, fye, nd_active/secretary_active/acc_active/tax_active` |
| `ar_reminder` | per-cycle AR/AGM/XBRL/dormant status, `pic/acc_pic/tax_pic`, due dates, filing dates |
| `late_filing_companies` | overdue AR/AGM tracking, mirrors `ar_reminder` |
| `generated_invoices` | TAB/TAC invoices this app itself created — `services[]` (name tags, not amounts), `total_amt`, `fye_year/fye_cycle` |
| `quickbooks_invoices` | the real scraped QB ledger — 8,017 rows, `customer_name, total_amt, balance, txn_date, status, qb_company, location_name` |
| `quickbooks_credit_memos`, `quickbooks_ar_aging_detail` | real aging snapshot (near-real-time via webhook, INV-QB-021), `aging_bucket, open_balance` — this is a real, working AR-aging feed |
| `soa_owners` | per-(customer, qb_company) collections owner, human override + auto-suggested |
| `nd_appointments`, `trademark_records`, `email_drafts`, `post_incorporate_operations` | service-specific operational records, each with its own `created_by_email` audit trail but no shared `fact_client_service` shape |
| `user_memories`, `ai_learning_candidates`, `ai_conversations/ai_messages/ai_agent_runs` | the existing (behavioral, not business-analysis) memory/learning system |
| `automation_sync_runs`, `automation_exceptions` | the existing automation-health telemetry — a real precedent for "evidence run" tracking |

`app/api/reports/route.ts` + `lib/reports-data.ts` are the report-generation
logic: one `GET` handler that fetches `companies`/`master_list`/
`quickbooks_invoices`/`ar_reminder`, computes donuts/trends/workload
client-side-shaped objects, and returns them. All calculation is
deterministic JS (good — matches the spec's "SQL/code does the math"
principle) but is **inline in the route/lib file, not a reusable metric
catalogue** — there is no `metric_id`/`formula`/`period_rule` registry
anywhere; a metric's definition lives only in the shape of the code that
computes it.

### 3. Existing AI prompt architecture

Two real, separate LLM call sites relevant here:

- `app/api/assistant/route.ts` — the My Tasks/chat assistant. Multi-model
  (Claude tool-use + optional OpenAI synthesis, INV-AI-003), 35+ tools,
  deterministic reply-scanning guards against hallucinated capability
  denial (INV-AI-004) and unfounded specificity. This is the general
  conversational assistant, not a management-analysis engine — it answers
  point questions ("Chelsea 今天要做什么"), it doesn't produce a structured
  periodic report.
- `lib/reports-narrative.ts` — the Reports page's "AI 分析" card, the
  actual predecessor to what this package wants to become. **Already does
  several things right**: forces structured output via a tool call
  (`submit_analysis`, `insights[]` with `signal`/title/body, never a prose
  blob), computes YoY **in code**, not left to the model to eyeball
  (`pctChange()` in `lib/reports-narrative.ts`), carries an explicit
  `dataScopeCaveat` string forbidding profitability/margin claims since no
  cost/balance-sheet data exists anywhere in this system, and is bilingual
  by design (both languages in one call). **Already does several things
  the spec explicitly forbids or asks to fix**: no comparable-period
  validation (§0 above), no FACT/INFERENCE/HYPOTHESIS distinction (only a
  3-value `signal` good/watch/warning, closer to spec §22's severity
  concept than §11's evidence classification), no per-insight `confidence`
  field, no revenue bridge/cohort/retention/eligibility inputs (because
  none of those are computed anywhere yet — see §4), no human-feedback
  loop specific to a narrative insight, no regulatory-knowledge retrieval.

### 4. Existing analytics calculations

`lib/reports-data.ts`: `computeRevenueTrend()` (year-bucketed revenue +
invoice count from `quickbooks_invoices`), `computeClientFlow`-equivalent
(new/churned by `master_list.join_date`/`update_date`, both free-text
fields needing `lib/date.ts`'s tolerant parser), `computePicWorkload()`
(open AR/AGM cycles per staff). `lib/soa-data.ts`: real AR-aging/outstanding
balance computation, already correct and near-real-time (INV-QB-021),
genuinely reusable for a DSO/collection-rate metric later. `lib/firm-pulse.ts`
and `lib/outstanding-lookup.ts`: firm-wide and per-company outstanding
summaries. **None of these are client-level revenue bridges, cohort
retention, GRR/NRR, or service-eligibility calculations — those do not
exist anywhere in this codebase today.**

### 5. Client status data

Real and reasonably rich: `master_list.list_type` (active_client, ad_hoc,
mas, name_change, strike_off, terminated, trademark) is the authoritative
lifecycle state; `companies.is_active`/`tw_status`/`client_type` mirror it
from the TeamWork sync side; `master_list.join_date` (cohort join point,
free-text, tolerant-parsed) and `update_date` (last lifecycle change,
same caveat) exist and are already used for the current New/Churned flow
calculation. **What's missing**: no `fact_client_status_history` — a
status CHANGE is only ever the current row's value plus whatever
`audit_log`/`ar_reminder_audit` happened to capture as a side effect of an
edit; there is no first-class "this client went active→terminated on this
date" event log to build true cohort survival curves from.

### 6. Invoice / revenue data

8,017 real `quickbooks_invoices` rows (TAB/TAC/TAO combined, 2024-01 to
2026-09), plus `generated_invoices` (this app's own TAB/TAC creation
record, service-NAME-tagged but not itemized), plus a real near-real-time
AR-aging snapshot (`quickbooks_ar_aging_detail`, webhook-driven). **No
persisted invoice line-item table** — real per-line Class/Description/
amount only exists live in the QuickBooks API, fetched on demand per
invoice (`lib/quickbooks-invoice-lines.ts`), never bulk-synced. **No
recurring-vs-one-off flag anywhere.** No expense/cost data, no balance
sheet, no cash flow statement anywhere in this system, ever (already
correctly documented in `lib/reports-narrative.ts`'s own
`dataScopeCaveat`) — this is a hard, permanent ceiling on anything
profitability/margin-shaped, not a phase-1 gap to close later.

### 7. Client-service relationships

Exists only as **boolean flags on `companies`** (`uses_address`, `has_nd`,
`has_xbrl`, `has_accounts`, `has_tax`) plus `master_list`'s parallel
`*_active` columns, plus service-specific tables with no shared shape
(`nd_appointments` has real start/end dates per person-company;
`trademark_records` has per-mark dates; Billing/AR has FYE-cycle
service flags baked into `ar_reminder` itself). **There is no unified
`fact_client_service` table** (client_id, service_id, start_date, end_date,
status) the spec's data model wants — each service's "is this client using
X" lives in its own place with its own shape, which is exactly why a
service-eligibility ENGINE (spec §9) doesn't exist: there's nowhere central
to compute "eligible but not using" against.

### 8. Current Singapore compliance/service fields

Genuinely strong coverage for what this business actually tracks day to
day: FYE month/day, AR/AGM due dates and cycles (`ar_reminder`, with real
EOT — Extension of Time — tracking), XBRL flag + a standing "confirm
required this FY" warning in Billing (amount is stable, applicability
isn't, already handled as a human-confirm step, not automated), Nominee
Director appointments with real subrole-review automation cross-checking
TeamWork, dormant-company flag on `ar_reminder`. **What's absent**: none of
this is stored as a *queryable, versioned rule* — "does this company need
an AGM this year" is answered by the AR Reminder page's own procedural
logic (TeamWork sync + human review), not a `dim_regulatory_rule` table
with `rule_text`/`conditions`/`source_url`/`effective_date` the spec wants.
There is no ACRA/IRAS source citation anywhere in this codebase; nothing
resembling official-source retrieval exists.

### 9. Existing AI memory/history implementation

This is the one area where the underlying MECHANISM the spec wants
(evidence-backed, confidence-scored, human-gated promotion, never
auto-trusting an AI-generated statement as fact) **already exists and is
proven in production** — just scoped to a different subject. `lib/
ai-learning/{candidates,conversations,patterns}.ts` + `user_memories` +
`ai_learning_candidates`: every candidate carries `confidence`,
`source_count`, `distinct_days`, `evidence`; automatic promotion requires
`confidence >= 0.9 AND distinct_days >= 5`; everything below that sits in
a human review queue (`/ai-learning`, admin-gated) until approved/rejected;
a promoted memory becomes its own row in `user_memories`, never
retro-fitted into the candidate. This is real and already shipped, but it
learns **staff behavioral patterns** ("this person usually opens X page"),
not **validated business facts about the client portfolio**. `ai_quality_
reviews` (INV-AI-006, this session, migration not yet run in production)
is the closest existing analogue to spec §27's Memory Test / human-feedback
loop, but it grades chat-reply BEHAVIOR (denial patterns), not a
management-narrative insight's correctness. **There is no `fact_human_
feedback`/`fact_analysis_insight`/analyst-memory-specific table anywhere.**

---

## 3. Gap analysis by spec section

Legend: 🟢 Already Available · 🟡 Partially Available · 🔴 Missing · ⛔ Blocked by Missing Data

| Spec section | Requirement | Status | Why |
|---|---|---|---|
| §4 SKILL.md | Skill file structure, FACT/INFERENCE/HYPOTHESIS/ACTION framing | 🔴 | No skill file exists for this yet. Pattern (a project `.claude/skills/` dir) already established this session (`dashboard-design`) — mechanically easy to add once the *content* below is real. |
| §5 SG corporate-services intelligence | Domain list (AR, AGM, XBRL, ND, RORC/ROND/RONS, CIT, ECI, GST, …) | 🟡 | The *operational tracking* of most of these exists (AR/AGM/XBRL/ND in `ar_reminder`/`nd_appointments`) — the *regulatory knowledge* (eligibility rules, conditions, official sources) does not. |
| §5 Regulatory knowledge storage (`dim_regulatory_rule`) | 🔴 | No such table, no scraped/curated ACRA/IRAS rule content anywhere. |
| §5 Eligibility (eligible/not/unknown/served/external) | 🔴 | Nothing computes this today — `companies.has_xbrl` etc. record USAGE, not ELIGIBILITY. |
| §6 Comparable Period Engine | ⛔→🔴 | **Actively violated today**, not just absent (§0). Building this is unblocked by data (years/dates already exist) — it's pure logic, highest-leverage first build. |
| §7 Revenue Bridge (NEW/CHURNED/EXPANDED/CONTRACTED/STABLE per client) | 🟡 | Raw ingredients exist (`quickbooks_invoices.customer_name/total_amt/txn_date` per invoice → can be aggregated to per-client per-period revenue); the classification logic itself doesn't exist anywhere. Needs a client-name normalization pass (same `normalize()`/fuzzy-match caveats that already bite SOA — INV-QB-018 family — will apply here too). |
| §7 Revenue by Service | ⛔ | No persisted line-item data (see §2.6) — `generated_invoices.services` is name-tags-per-whole-invoice, not itemized amounts; `quickbooks_invoices` has none. Real per-service dollar splits exist only live in the QB API, invoice-by-invoice — not viable to bulk-query for a report today without a new sync job. |
| §7 Recurring vs one-off revenue | ⛔ | No flag exists anywhere; would need either a new manual/inferred classification rule (real risk of the exact "invented" business rule CLAUDE.md's root file forbids without Vincent's explicit rule) or a new data field captured going forward. |
| §7 ARPC, median revenue/client, concentration, Top 5/10 | 🟡 | Computable today from `quickbooks_invoices` grouped by `customer_name` — real client-name normalization needed (companies with 2+ QB customer-name variants), but no new data required. |
| §8 Logo metrics (opening/new/churned/closing/retention/churn) | 🟡 | `master_list.list_type`/`join_date`/`update_date` give this at the LIST level already (this is literally what Reports' current "Client Flow" chart computes); a formal logo-retention % and closing-count reconciliation isn't computed today but needs no new data. |
| §8 GRR / NRR | 🔴 | Needs the Revenue Bridge (§7) first — not independently buildable. |
| §8 Cohort analysis (join month/quarter/year, Month 0/1/3/6/12/24 tracking) | 🟡 | `join_date` exists (free-text, tolerant-parsed, real coverage gaps documented in `lib/date.ts`'s own comments) — cohort GROUPING is possible today; the Month-N retention-curve computation itself doesn't exist. |
| §9 Service eligibility engine (per service) | 🔴 | No eligibility rules encoded anywhere for any service. This is the single largest net-new build in the whole package — every other gap in §9 depends on it. |
| §9 Correct cross-sell funnel / eligible attach rate | ⛔ | Directly blocked by the eligibility engine above — cannot be built before it, only faked (exactly the spec's own forbidden shortcut: "service users ÷ all active clients"). |
| §10 Forecasting pipeline | 🟡→🔴 | Real data volume exists at the edge of the spec's own minimum (~33 months of invoice-level `txn_date`, spec wants 24–36+ monthly periods) — but it has never been assembled into a validated monthly series, no backtest harness exists, no baseline model exists. Building the *pipeline* is 🔴; the *minimum raw data* is 🟡 (present but thin, and per-service/per-client granularity for real features is much thinner once split out). |
| §11 Reasoning guardrails (FACT/INFERENCE/HYPOTHESIS/ACTION, forbidden phrases, confidence) | 🟡 | The *mechanism precedent* exists and works (INV-AI-004's deterministic reply-scanning guards already catch a different class of false claim in the chat assistant; `lib/reports-narrative.ts` already has a working confidence-adjacent `signal` field and a real `dataScopeCaveat`). The specific FACT/INFERENCE/HYPOTHESIS taxonomy and forbidden-phrase language guard (§26) do not exist for the Reports narrative today. |
| §12 Analyst memory (FACT/DECISION/OUTCOME/PREFERENCE/HYPOTHESIS_MEMORY, human validation gate) | 🟡 | The exact ARCHITECTURE this section asks for (never trust an AI statement as fact until a human validates it, confidence-gated auto-promotion, evidence-linked) is already built and running for staff-behavior learning (`ai_learning_candidates`/`user_memories`). Re-scoping/extending it to business-analysis insights is a real but bounded lift — not a from-scratch build. |
| §13 Report writing structure (Executive Summary → Key Changes → Drivers → Risks → Opportunities → Actions → Data Limitations) | 🟡 | `lib/reports-narrative.ts` already outputs structured `insights[]` + a scope-limiting `summaryZh/En`, rendered as distinct cards, not a prose wall (a real, deliberate fix already shipped 2026-09-22: "文字没有优先级"). It does not yet follow this exact 7-part hierarchy or separate Risks from Opportunities from Actions. |
| §14 Deterministic analytics engine (`src/analytics/...`) | 🟡 | Equivalent deterministic calculation ALREADY happens in `lib/reports-data.ts`/`lib/soa-data.ts` — the spec's own principle ("Claude explains, code calculates") is already the working pattern here, just not organized into the suggested `periods/revenue/clients/services/forecast/evidence` module structure. |
| §15 Suggested data model (`dim_client`, `fact_invoice`, `fact_client_service`, etc.) | 🟡 | Real tables cover most of the SAME information under different names/shapes (`companies` ≈ `dim_client`, `quickbooks_invoices` ≈ `fact_invoice`) — see §2 mapping above. `fact_client_service`, `fact_service_eligibility`, `fact_analysis_run`, `fact_analysis_insight`, `fact_human_feedback`, `dim_regulatory_rule`, `fact_analyst_memory` have no equivalent at all. |
| §16 Metric catalogue (formal `metric_id`/formula/owner registry) | 🔴 | Metrics are computed correctly but implicitly, in code — no registry, no versioning, no documented formula/denominator per metric. |
| §17 Revenue bridge client-level classification logic | 🔴 | Same as §7 — depends on per-client revenue aggregation, which is buildable but not built. |
| §18 Cohort analysis tables | 🟡 | Same as §8 cohort row — grouping data exists, the tracked-metrics-over-Month-N structure doesn't. |
| §19 Service eligibility TS interface | 🔴 | Same as §9. |
| §20 Evidence schema (structured JSON per insight) | 🟡 | `lib/reports-narrative.ts`'s `submit_analysis` tool call is a real, working precedent for forcing structured (not prose) LLM output — the exact fields this spec wants (`hypotheses[]`, `missingEvidence[]`, `type: fact/inference/...`) aren't in the current schema yet, but the mechanism (tool-forced JSON, not free text) is proven and reusable. |
| §21 Confidence rules | 🟡 | `signal` (good/watch/warning) exists but conflates severity with confidence — the spec wants these as two separate axes. |
| §22 Report severity (5-level, configurable thresholds) | 🟡 | 3-level `signal` exists, model-chosen per insight, not threshold-configured. |
| §23 AI analysis workflow (17-step pipeline) | 🔴 | The current narrative generator does roughly steps 1, 4 (partially — see §0 bug), 11 (partially), 12–13; it has no eligibility check, no anomaly check, no regulatory retrieval, no output validation-against-evidence step, no stored "analysis run" record, no feedback loop. |
| §24/§25 Output format / UI cards | 🟡 | `app/reports/page.tsx` already renders each insight as its own card with a signal badge, title, body, bilingual toggle, and a "generated at"/cached timestamp — real UI infrastructure exists; it doesn't yet expose Evidence/Methodology/Source as an expandable "Why?" per the spec's exact UI ask. |
| §26 AI language guard (forbidden causal words → rewrite) | 🔴 | No automated check for "因为/therefore/proves/健康增长" exists on the narrative output; the system prompt asks the model to hedge appropriately, but nothing verifies it did (the same class of gap INV-AI-004's guards exist to close for the CHAT assistant — same pattern, different subject, not yet applied here). |
| §27 Validation tests | 🔴 | No automated test suite exists for this project at all (a deliberate, documented choice for this whole codebase — `docs/CURRENT_STATE.md`'s own "No automated CI/test suite" note) — the spec's specific test cases (period rejection, client-count-vs-revenue, eligibility-denominator) don't exist, and would be the first tests of any kind in this repo if built literally as unit tests, vs. this project's own established pattern of one-off diagnostic scripts run against real data before shipping. |

---

## 4. What this means, in priority order

Cross-referencing the spec's own §29 priority list against what's real in
this codebase today:

1. **Comparable Period Engine** — 🔴/⛔, but genuinely small and highest
   leverage: it fixes a bug that is live in production right now, needs no
   new data, and every later phase (revenue bridge, cohort, forecasting)
   inherits its correctness. This should be first regardless of anything
   else.
2. **Revenue Bridge / GRR/NRR/ARPC/concentration** — 🟡 raw ingredients
   real, logic missing. Second priority matches the spec's own ordering
   and this codebase's readiness — `quickbooks_invoices` already has
   everything needed except a client-name normalization pass (a known,
   solved problem elsewhere in this codebase — `lib/company-name.ts`).
3. **Client Retention / Cohorts** — 🟡, depends on #2's revenue
   classification for the revenue-retention half; the logo-retention half
   is buildable independently and sooner.
4. **Service Eligibility / Cross-sell** — 🔴, the single largest net-new
   build (no eligibility rule exists for any service today) and the one
   requirement most likely to need real business-rule input FROM Vincent
   per service (this is exactly the kind of domain judgment `CLAUDE.md`'s
   root rule says must never be invented/assumed) — realistically needs a
   real working session per major service (XBRL, GST, Corporate Tax
   eligibility rules aren't obvious from data alone).
5. **Evidence + Confidence Layer** — 🟡, the mechanism is proven
   (`ai_learning_candidates`'s own confidence/evidence pattern,
   `reports-narrative.ts`'s tool-forced structured output) — this is
   substantially an extension/re-application exercise, not new invention.
6. **Singapore Regulatory Knowledge** — 🔴, and the highest-risk item to
   get wrong silently: this needs a real sourcing/verification workflow
   (ACRA/IRAS citations, `last_verified_at`), not something to synthesize
   from Claude's own training knowledge into a table and call "verified."
7. **Analyst Memory** — 🟡, the exact architecture already exists and
   works for a different subject (staff behavior) — re-scoping it to
   business-insight validation is bounded, known-shape work.
8. **Forecasting** — 🟡/🔴, correctly last per the spec's own ordering:
   ~33 months of raw invoice history exists (at the spec's own stated
   minimum), but no monthly series has been assembled/validated, no
   backtest harness exists, and per-service/per-client granularity (which
   real forecasting features would want) is much thinner once split out
   of the aggregate.

## 5. Two things worth flagging before any implementation plan is finalized

- **§27's literal ask ("automated tests")** conflicts with this project's
  own established, documented practice of verifying every change against
  real production data via one-off diagnostic scripts rather than a
  persisted unit-test suite (`docs/CURRENT_STATE.md`: "a deliberate,
  working pattern given the project's actual scale"). The spec's actual
  test CASES (period-comparability rejection, the count-vs-revenue check,
  the eligibility-denominator check) are worth building as real guardrail
  LOGIC either way — whether they're expressed as a `scripts/test-*.mjs`
  diagnostic (this repo's own convention, see `test-reply-guards.ts`) or a
  real test framework is a process choice, not a data/architecture gap,
  and is worth confirming before Phase 1 starts.
- **Revenue-by-service and recurring-vs-one-off are hard-blocked by
  missing data**, not just missing logic. Before promising either in a
  phased plan, this needs a real decision: (a) accept they stay
  unavailable, (b) build a new sync job to persist QuickBooks line items
  going forward (no retroactive history — the same "starts empty at
  deploy" constraint every other new tracking table in this codebase has
  hit), or (c) approximate service-level revenue from the existing
  `generated_invoices.services` NAME tags plus a proportional-split
  heuristic — which would need to be labeled as an estimate, not a real
  split, per the spec's own confidence rules.

---

*No implementation has started. Next step, if this analysis looks right:
confirm the priority order in §4, and confirm the two flags in §5, before
any skill file, analytics module, or schema change is written.*
