-- Tracks, per Active Client row, which auto-synced fields a human has
-- overridden — extends the same atomic-JSONB-merge pattern already used for
-- companies.services_manual (see add-service-override-merge-function.sql),
-- applied here to master_list instead. A field flagged true in manual_fields
-- is skipped by every nightly sync that would otherwise overwrite it
-- (teamwork/sync, teamwork/sync-secretary, ar-reminder/sync-workflow);
-- clearing a text/date field back to empty (or explicitly "resuming
-- automation" for a checkbox like nd_active) removes the flag and hands
-- control back to automation on the next run.
-- Safe to run more than once in Supabase SQL Editor.

ALTER TABLE public.master_list
  ADD COLUMN IF NOT EXISTS manual_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.set_master_list_manual_field(p_row_id bigint, p_field text, p_manual boolean)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  result jsonb;
BEGIN
  UPDATE public.master_list
  SET manual_fields = CASE
    WHEN p_manual IS NULL THEN COALESCE(manual_fields, '{}'::jsonb) - p_field
    ELSE COALESCE(manual_fields, '{}'::jsonb) || jsonb_build_object(p_field, p_manual)
  END
  WHERE id = p_row_id
  RETURNING manual_fields INTO result;
  RETURN result;
END;
$$;
