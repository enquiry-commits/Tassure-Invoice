-- EOT (Extension of Time) special handling: dedicated columns for which
-- cycle/event got extended and by how much, separate from the generic
-- company_name/remark/update_date columns every category already shares.
-- Only meaningful for list_type='eot' rows, but lives on the shared
-- master_list table like every other category-specific column here.
-- Run this in Supabase SQL Editor ("Run without RLS" if prompted).

ALTER TABLE master_list ADD COLUMN IF NOT EXISTS eot_event TEXT;
-- TEXT, not INTEGER: every other column on this generically-editable table
-- (e.g. kyc_year, also year-like) is text, so the shared table UI's
-- edit-cell component can treat every field uniformly as a string.
ALTER TABLE master_list ADD COLUMN IF NOT EXISTS eot_fye_year TEXT;
ALTER TABLE master_list ADD COLUMN IF NOT EXISTS eot_original_due_date DATE;
ALTER TABLE master_list ADD COLUMN IF NOT EXISTS eot_revised_due_date DATE;

COMMENT ON COLUMN master_list.eot_event IS
  'list_type=eot only: which TeamWork event cycle this extension applies to, ''AGM'' or ''AR''. '
  'A company with EOTs on both its AGM and AR due dates for the same FYE gets two separate '
  'eot rows, one per event — same one-row-per-thing convention every other master_list category uses.';
COMMENT ON COLUMN master_list.eot_fye_year IS
  'list_type=eot only: the FYE year (e.g. "2025") this extension''s cycle belongs to. Text, '
  'not integer, matching every other year-like column on this table (e.g. kyc_year).';
COMMENT ON COLUMN master_list.eot_original_due_date IS
  'list_type=eot only: the due date before the extension, as TeamWork originally set it — '
  'the struck-through value in TeamWork''s own "<strike>ORIGINAL</strike> <br> REVISED" rendering.';
COMMENT ON COLUMN master_list.eot_revised_due_date IS
  'list_type=eot only: the due date after the extension was granted — the value this app''s '
  'own Late Filing/AR Reminder/Active Client date logic already uses (see lib/teamwork-agm.ts''s '
  'parseLatestDmy, added 2026-08-28), so this column is a visible record of WHY that date moved, '
  'not itself the source of truth those other pages read from.';
