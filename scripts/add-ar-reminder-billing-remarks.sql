-- Vincent (2026-08-17): a free-typed "Remarks" column on the Billing Drafts
-- page, right after PIC. Deliberately a SEPARATE column from ar_reminder's
-- existing `remarks` (that one already has a specific, different job: the
-- TERMINATED/STRIKE OFF/AR COMPLETED dropdown on the AR Reminder tab, which
-- also drives that tab's whole-row grey/green tint) — reusing it here would
-- let a billing note silently collide with that compliance-workflow status.
-- Plain text, no format constraint.
-- Safe to run more than once in Supabase SQL Editor.

ALTER TABLE public.ar_reminder
  ADD COLUMN IF NOT EXISTS billing_remarks text;
