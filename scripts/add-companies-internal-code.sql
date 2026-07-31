-- Adds the staff-assigned client Code (e.g. "CA001") to companies, synced
-- from TeamWork's client_id field (app/api/teamwork/sync/route.ts). This is
-- what lets Master List's "Add Manual" form auto-fill the Code for a company
-- that's already in TeamWork, instead of staff retyping it by hand.
-- Run this in Supabase SQL Editor ("Run without RLS" if prompted).

ALTER TABLE companies ADD COLUMN IF NOT EXISTS internal_code TEXT;
CREATE INDEX IF NOT EXISTS idx_companies_internal_code ON companies (internal_code);
