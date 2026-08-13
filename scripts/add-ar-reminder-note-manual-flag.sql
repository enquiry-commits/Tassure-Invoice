-- Tracks whether ar_reminder's "reminder_note" (the Reminder column on the AR
-- Reminder page) was set by a human or by the TeamWork sync, so automation
-- never overwrites a manual entry, and clearing the cell reverts it to
-- automated — same pattern as date_of_agm_manual/filling_date_manual (see
-- add-ar-manual-date-flags.sql).
-- Safe to run more than once in Supabase SQL Editor.

ALTER TABLE public.ar_reminder
  ADD COLUMN IF NOT EXISTS reminder_note_manual boolean NOT NULL DEFAULT false;
