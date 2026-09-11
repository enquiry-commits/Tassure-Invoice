-- Vincent (2026-09-11): the AR Reminder XBRL field was a single flat
-- NO/SIMPLIFIED/FULL status with no record of WHY. He sent the actual
-- compliance form his team fills in: for the immediate past two
-- consecutive financial years, whole group (parent and subsidiary) —
-- 1. total annual revenue <= $10m, 2. total assets <= $10m, each a
-- separate Yes/No answer. These two criteria are captured as their own
-- columns alongside the existing `xbrl` status dropdown, not merged into
-- it — the NO/SIMPLIFIED/FULL classification itself is still set manually
-- by staff; this system does not derive it from the two answers (that
-- mapping rule was not given and is not invented here).
-- Safe to run more than once in Supabase SQL Editor.

ALTER TABLE public.ar_reminder
  ADD COLUMN IF NOT EXISTS xbrl_revenue_le_10m text,
  ADD COLUMN IF NOT EXISTS xbrl_assets_le_10m text;
