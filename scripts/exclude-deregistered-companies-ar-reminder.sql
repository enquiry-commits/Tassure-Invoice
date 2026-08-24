-- Vincent, 2026-08-24: ADVANCE BRIGHT GLOBAL and FULLRICH INTERNATIONAL are
-- both fully absent from `companies` (likely genuinely deregistered) — so
-- Late Filing's `inactiveNames` check can never catch them, and the only
-- thing that was keeping them off the page (a "Resolved" late_filing_
-- companies row) got deleted. status='Excluded' is the same permanent
-- exclusion mechanism the AR Reminder page's own delete button already
-- uses (app/api/ar-reminder/route.ts's DELETE handler) — robust against
-- this exact fragility, since it lives on the ar_reminder row itself, not
-- a separate deletable side-table note.
UPDATE ar_reminder
SET status = 'Excluded'
WHERE id IN (902, 903);
