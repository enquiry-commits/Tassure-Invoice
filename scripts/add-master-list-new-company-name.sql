-- Change Co Name special handling: a dedicated column for the NEW legal name,
-- separate from company_name (which keeps the OLD name the company was known
-- by before the rename). Only meaningful for list_type='name_change' rows,
-- but lives on the shared master_list table like every other column here.
-- Run this in Supabase SQL Editor ("Run without RLS" if prompted).

ALTER TABLE master_list ADD COLUMN IF NOT EXISTS new_company_name TEXT;

COMMENT ON COLUMN master_list.new_company_name IS
  'list_type=name_change only: the company''s new legal name after the rename. '
  'company_name on that same row is the OLD name — other pages look up a '
  'name_change row by matching roc_no (UEN) to show a "formerly known as" hint, '
  'so this is the single source of truth for the rename rather than a note '
  'copied onto every other row.';
