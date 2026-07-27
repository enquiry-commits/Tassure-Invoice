-- Client Communications workbench: Outlook-opened state and audit fields.
-- Safe to run more than once in the Supabase SQL Editor.

ALTER TABLE public.email_drafts
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS opened_by_email text,
  ADD COLUMN IF NOT EXISTS opened_by_name text;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'email_drafts'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.email_drafts DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END;
$$;

ALTER TABLE public.email_drafts
  ADD CONSTRAINT email_drafts_status_check
  CHECK (status IN ('pending', 'opened', 'sent', 'skipped'));

CREATE INDEX IF NOT EXISTS email_drafts_opened_at_idx
  ON public.email_drafts (opened_at DESC)
  WHERE opened_at IS NOT NULL;

COMMENT ON COLUMN public.email_drafts.contact_name IS
  'Reviewer-confirmed greeting name used when the email body was merged.';
COMMENT ON COLUMN public.email_drafts.opened_at IS
  'Time the prepared draft was successfully opened in local Outlook; not proof that it was sent.';
