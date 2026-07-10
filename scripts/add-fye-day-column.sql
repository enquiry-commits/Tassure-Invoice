-- Store the exact FYE day-of-month (from TeamWork's fye_date field, e.g. "31/12")
-- so due_date can be computed precisely (FYE + 7 months) instead of assuming month-end.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS fye_day INTEGER;
