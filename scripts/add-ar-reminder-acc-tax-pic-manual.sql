-- Tracks whether ACC PIC / TAX PIC currently holds the value the
-- carry-forward suggestion set (false/null) or a value a person explicitly
-- typed (true) — same "auto-fill dot" convention already used for
-- date_of_agm_manual/filling_date_manual/reminder_note_manual.
ALTER TABLE ar_reminder ADD COLUMN IF NOT EXISTS acc_pic_manual BOOLEAN;
ALTER TABLE ar_reminder ADD COLUMN IF NOT EXISTS tax_pic_manual BOOLEAN;
