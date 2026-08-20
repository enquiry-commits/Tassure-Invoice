-- Vincent, 2026-08-20: the daily Late Filing sync re-stamped a fresh
-- "Review: Auto condition cleared on {date} ... Previous: {remarks}" note
-- every run a company stayed cleared, with no staff action needed to stop
-- it — a company cleared for two weeks grew an 11-layer nested chain
-- ("Resolved: ... Previous: Review: ... Previous: Review: ... "). The sync
-- route itself is fixed to only stamp this once per actual transition
-- (app/api/late-filing/sync/route.ts) — this collapses the 12 rows that
-- already accumulated a chain down to just their current (latest) line.

-- Preview first — check this looks right before running the UPDATE below.
SELECT id, company_name,
  regexp_replace(remarks, ' Previous:.*', '', 's') AS would_become
FROM late_filing_companies
WHERE remarks ILIKE '%Previous:%';

UPDATE late_filing_companies
SET remarks = regexp_replace(remarks, ' Previous:.*', '', 's')
WHERE remarks ILIKE '%Previous:%';
