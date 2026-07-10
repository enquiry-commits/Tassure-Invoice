-- Add missing columns to ar_reminder table
-- Run in Supabase SQL Editor (Run without RLS)

ALTER TABLE ar_reminder
  ADD COLUMN IF NOT EXISTS reminder_note   TEXT,
  ADD COLUMN IF NOT EXISTS ar_status       TEXT,
  ADD COLUMN IF NOT EXISTS software_update TEXT,
  ADD COLUMN IF NOT EXISTS dpo             TEXT,
  ADD COLUMN IF NOT EXISTS ond_ron         TEXT,
  ADD COLUMN IF NOT EXISTS acc_pic         TEXT,
  ADD COLUMN IF NOT EXISTS tax_pic         TEXT;
