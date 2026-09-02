-- Adds a structured customer-source tag to companies, for the Reports page
-- (2026-09-03). Deliberately NOT free text like master_list.referral (which
-- turned out ~99% empty and, where filled, held a person's name rather than
-- a channel category) — value is one of lib/customer-source.ts's fixed
-- CUSTOMER_SOURCE_OPTIONS, edited from Company 360. NULL means untagged
-- ("Unknown" in the UI), which is expected for the entire existing roster
-- until staff start tagging going forward.
-- Run this in Supabase SQL Editor ("Run without RLS" if prompted).

ALTER TABLE companies ADD COLUMN IF NOT EXISTS customer_source TEXT;
