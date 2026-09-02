-- Adds SSIC (Singapore Standard Industrial Classification) fields to
-- companies, synced from TeamWork's own "Principal Activities" table
-- (lib/teamwork-company-profile.ts's extractSsic, written by
-- app/api/teamwork/sync-secretary/route.ts's existing per-company profile
-- fetch — no new scraping pass, this reuses the same page visit already
-- made nightly for Secretary/Officials/Shareholders). A company can have
-- up to two registered activities (Activity I is effectively always
-- present; Activity II is genuinely optional) — kept as two flat column
-- groups rather than a child table, matching how few, fixed-arity fields
-- like this are already modelled elsewhere on companies (e.g. pic/
-- acc_pic/tax_pic on ar_reminder).
-- Run this in Supabase SQL Editor ("Run without RLS" if prompted).

ALTER TABLE companies ADD COLUMN IF NOT EXISTS ssic_code_1 TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ssic_description_1 TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ssic_remarks_1 TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ssic_code_2 TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ssic_description_2 TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ssic_remarks_2 TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ssic_synced_at TIMESTAMPTZ;
