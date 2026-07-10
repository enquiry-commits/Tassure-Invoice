-- Add MAS + GRADE columns to master_list (needed for Active Client / MAS sheets)
-- Run this in Supabase SQL Editor ("Run without RLS" if prompted)

ALTER TABLE master_list ADD COLUMN IF NOT EXISTS mas   TEXT;
ALTER TABLE master_list ADD COLUMN IF NOT EXISTS grade TEXT;
