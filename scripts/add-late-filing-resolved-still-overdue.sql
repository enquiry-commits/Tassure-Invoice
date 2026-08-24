-- Vincent, 2026-08-24: a company staff has manually Resolved is trusted
-- forever by the rest of the sync (remarks stays frozen via
-- manual_fields.remarks) — nothing ever re-checked whether that trust was
-- actually correct (confirmed live: CO-OPERATE ASSOCIATES was Resolved
-- while still genuinely 1847 days overdue). This column lets the sync
-- quietly re-verify every run and flag the mismatch without either
-- silently trusting it forever or noisily pulling it back into Total Late
-- Filers.
ALTER TABLE late_filing_companies
  ADD COLUMN IF NOT EXISTS resolved_but_still_overdue_since DATE;
