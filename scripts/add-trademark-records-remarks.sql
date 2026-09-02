-- Adds a free-text Remarks field to trademark_records (2026-09-03), per
-- Vincent: some manually-added trademark records aren't actually for a
-- Tassure client (added for reference/tracking only) — this is where
-- staff note that. Available on both categories (Master Records AND In
-- Progress), unlike updates_note (In Progress only, a different purpose —
-- filing-progress updates, not a general note). components/TrademarkTable.tsx
-- shows a small marker next to the company name whenever this is set, so
-- it's visible at a glance without needing to read the Remarks column
-- itself.
-- Run this in Supabase SQL Editor ("Run without RLS" if prompted).

ALTER TABLE trademark_records ADD COLUMN IF NOT EXISTS remarks TEXT;
