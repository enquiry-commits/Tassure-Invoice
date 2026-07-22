-- TeamWork Report recipient directory used by all Campaign Centre types.
-- Safe to run more than once in the Supabase SQL Editor.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS tw_to_emails text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS tw_cc_emails text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS tw_recipient_source text,
  ADD COLUMN IF NOT EXISTS tw_recipient_synced_at timestamptz;

COMMENT ON COLUMN public.companies.tw_to_emails IS
  'External customer recipients from TeamWork Report > Reminder Upcoming To Be Sent.';
COMMENT ON COLUMN public.companies.tw_cc_emails IS
  'Tassure internal recipients after Campaign Centre CC rules are applied.';
COMMENT ON COLUMN public.companies.tw_recipient_source IS
  'Source of the current campaign recipient directory.';
