-- EOT (Extension of Time) tracking, directly on ar_reminder rather than a
-- separate list: an EOT company is fundamentally an ALREADY-tracked AR
-- Reminder cycle whose AGM/AR due date TeamWork shows as extended — not a
-- new set of companies. Keeping the data on the same row Reminder/PIC/etc
-- already live on means one edit is visible everywhere instead of two
-- disconnected copies drifting apart.
-- Run this in Supabase SQL Editor ("Run without RLS" if prompted).

ALTER TABLE ar_reminder ADD COLUMN IF NOT EXISTS ar_original_due_date DATE;
ALTER TABLE ar_reminder ADD COLUMN IF NOT EXISTS ar_revised_due_date DATE;
ALTER TABLE ar_reminder ADD COLUMN IF NOT EXISTS agm_original_due_date DATE;
ALTER TABLE ar_reminder ADD COLUMN IF NOT EXISTS agm_revised_due_date DATE;

COMMENT ON COLUMN ar_reminder.ar_original_due_date IS
  'The AR Due Date before an extension, as TeamWork originally set it — the struck-through '
  'value in TeamWork''s own "<strike>ORIGINAL</strike> <br> REVISED" rendering. Auto-detected '
  'by app/api/late-filing/sync/route.ts''s daily scan; null when this cycle has no known extension.';
COMMENT ON COLUMN ar_reminder.ar_revised_due_date IS
  'The AR Due Date after an extension was granted. This is a visible record of WHY the date '
  'moved — the actual source of truth other pages (Late Filing, Active Client) read from is '
  'lib/teamwork-agm.ts''s parseLatestDmy applied directly to the live TeamWork field, not this column.';
COMMENT ON COLUMN ar_reminder.agm_original_due_date IS
  'Same as ar_original_due_date, for the AGM Due Date instead of the AR Due Date.';
COMMENT ON COLUMN ar_reminder.agm_revised_due_date IS
  'Same as ar_revised_due_date, for the AGM Due Date instead of the AR Due Date.';
