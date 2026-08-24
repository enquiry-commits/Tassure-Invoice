-- Vincent, 2026-08-24: late_filing_companies had no record of who made a
-- change — "Resolved: AUTO: Overdue 1847 days" showed up on CO-OPERATE
-- ASSOCIATES with no way to tell who clicked Resolve or when, unlike
-- ar_reminder which already tracks this via the same two columns.
ALTER TABLE late_filing_companies
  ADD COLUMN IF NOT EXISTS updated_by_email TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_name TEXT;
