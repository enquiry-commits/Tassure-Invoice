-- Active Client's Services section (Nominee Dir./Secretary/ACC/TAX): Vincent
-- wants the checkbox freely toggleable regardless of whether a name is on
-- file, and ACC/TAX turned from read-only (AR Reminder's synced value) into
-- editable, with a manual entry overriding AR Reminder's value once set.
--
-- Run ONCE in the Supabase SQL editor. Idempotent — safe to re-run.

ALTER TABLE master_list
  ADD COLUMN IF NOT EXISTS nd_active boolean,
  ADD COLUMN IF NOT EXISTS secretary_active boolean,
  ADD COLUMN IF NOT EXISTS acc_pic_override text,
  ADD COLUMN IF NOT EXISTS acc_active boolean,
  ADD COLUMN IF NOT EXISTS tax_pic_override text,
  ADD COLUMN IF NOT EXISTS tax_active boolean;

-- Backfill so nothing visually changes until someone manually re-toggles it:
-- ND/Secretary start checked exactly where the existing "isSet(text)" rule
-- already had them checked.
UPDATE master_list SET nd_active = (
  nominee_director IS NOT NULL
  AND upper(trim(nominee_director)) NOT IN ('', 'NO', 'NA', 'N.A.', 'NONE', '-', '—', '0')
) WHERE nd_active IS NULL;

UPDATE master_list SET secretary_active = (
  secretary IS NOT NULL
  AND upper(trim(secretary)) NOT IN ('', 'NO', 'NA', 'N.A.', 'NONE', '-', '—', '0')
) WHERE secretary_active IS NULL;

-- ACC/TAX start checked exactly where AR Reminder (joined by UEN, same match
-- /api/master-list already does) currently shows a PIC.
UPDATE master_list ml SET acc_active = COALESCE((
  SELECT (ar.acc_pic IS NOT NULL AND trim(ar.acc_pic) <> '')
  FROM ar_reminder ar WHERE upper(trim(ar.uen)) = upper(trim(ml.roc_no)) LIMIT 1
), false) WHERE acc_active IS NULL;

UPDATE master_list ml SET tax_active = COALESCE((
  SELECT (ar.tax_pic IS NOT NULL AND trim(ar.tax_pic) <> '')
  FROM ar_reminder ar WHERE upper(trim(ar.uen)) = upper(trim(ml.roc_no)) LIMIT 1
), false) WHERE tax_active IS NULL;
