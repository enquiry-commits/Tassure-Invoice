-- Vincent, 2026-08-20: records exactly which ar_reminder row a given
-- late_filing_companies row's "⚠ LATE FILING:" marker was mirrored into,
-- so the sync's new reconciliation pass can keep that marker line synced
-- (updated/removed) as the company's Late Filing status changes over
-- time, without needing to re-derive a cycle key from dates that stop
-- making sense once a company is resolved.
ALTER TABLE late_filing_companies
  ADD COLUMN IF NOT EXISTS mirrored_ar_reminder_id BIGINT REFERENCES ar_reminder(id) ON DELETE SET NULL;
