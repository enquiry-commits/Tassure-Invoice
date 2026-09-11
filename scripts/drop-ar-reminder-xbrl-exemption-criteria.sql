-- Vincent (2026-09-11): the XBRL exemption-criteria breakdown built earlier
-- today was reverted — the request was not meant to be added into this
-- system. This drops the two columns added by
-- scripts/add-ar-reminder-xbrl-exemption-criteria.sql (which Vincent had
-- already run in production before asking for the revert).
-- Safe to run more than once in Supabase SQL Editor.

ALTER TABLE public.ar_reminder
  DROP COLUMN IF EXISTS xbrl_revenue_le_10m,
  DROP COLUMN IF EXISTS xbrl_assets_le_10m;
