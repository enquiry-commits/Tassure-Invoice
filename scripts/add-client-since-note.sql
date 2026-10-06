-- Free-text note beside companies.client_since (2026-10-06), e.g. "Re-joined —
-- earlier engagement terminated (first joined 29 Aug 2023)". Shown/edited in
-- Company 360 and included in the Reports export. Idempotent.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS client_since_note TEXT;
