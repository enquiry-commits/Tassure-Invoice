-- ar_reminder.prepared_date ("Report Ready" on the AR Reminder page) is
-- currently a native `date` column, which can only ever hold a real date.
-- Vincent (2026-08-17) wants the Report Ready dropdown to also allow
-- "DORMANT" (the company has no report to prepare) and free-typed custom
-- text, matching how accounts_status already works (a `text` column,
-- date-validated only at the app layer, not the database).
-- `USING prepared_date::text` preserves every existing value's exact
-- "YYYY-MM-DD" text, so nothing needs backfilling.
-- Safe to run more than once in Supabase SQL Editor.

ALTER TABLE public.ar_reminder
  ALTER COLUMN prepared_date TYPE text USING prepared_date::text;
