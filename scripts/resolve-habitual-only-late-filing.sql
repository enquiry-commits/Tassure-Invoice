-- Vincent, 2026-08-20: "habitual" flagging (a bad historical average alone,
-- with no cycle actually overdue right now) is being dropped as a concept
-- — too easy to confuse with companies genuinely late today. This resolves
-- the 12 existing rows that were only ever flagged that way (no currently
-- outstanding cycle: mirrored_ar_reminder_id is null, remarks is the plain
-- "AUTO: Avg N days late..." pattern with no "Overdue N days"). Going
-- forward the sync (app/api/late-filing/sync/route.ts) no longer creates
-- rows like this at all.

-- Preview first — confirm this is exactly the 12 companies expected.
SELECT id, company_name, remarks, next_agm_due_date
FROM late_filing_companies
WHERE mirrored_ar_reminder_id IS NULL
  AND remarks ~* '^AUTO: Avg \d+ days late'
  AND remarks !~* 'Overdue \d+ days';

-- manual_fields.remarks = true matches what a human clicking "Resolved" in
-- the UI would set (see app/api/late-filing/route.ts's nextManualFields) —
-- protects this text from ever being overwritten by a future sync refresh.
UPDATE late_filing_companies
SET remarks = 'Resolved: Habitual-only flag retired — no cycle was ever actually overdue',
    manual_fields = COALESCE(manual_fields, '{}'::jsonb) || '{"remarks": true}'::jsonb,
    updated_at = now()
WHERE mirrored_ar_reminder_id IS NULL
  AND remarks ~* '^AUTO: Avg \d+ days late'
  AND remarks !~* 'Overdue \d+ days';
