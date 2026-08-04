-- Tracks whether ar_reminder's AGM ("date_of_agm") / AR ("filling_date")
-- columns were set by a human or by the TeamWork sync, so automation never
-- overwrites a manual entry, and clearing the cell reverts it to automated.
-- Safe to run more than once in Supabase SQL Editor.

ALTER TABLE public.ar_reminder
  ADD COLUMN IF NOT EXISTS date_of_agm_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS filling_date_manual boolean NOT NULL DEFAULT false;
