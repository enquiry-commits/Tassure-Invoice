-- Row-level "who last touched this" attribution for master_list, mirroring
-- ar_reminder's updated_by_email/updated_by_name columns (add-ar-collaboration.sql)
-- so Master List can show the same "last edited by X" trace instead of a
-- checkmark that vanishes with no record of who did what.
-- Safe to run more than once in Supabase SQL Editor.

ALTER TABLE public.master_list
  ADD COLUMN IF NOT EXISTS updated_by_email text,
  ADD COLUMN IF NOT EXISTS updated_by_name text;
