-- Atomic merge for companies.services_manual, replacing the app's old
-- read-modify-write (SELECT the JSON, merge one key in JS, UPDATE the whole
-- object). That pattern loses updates under concurrency: if two staff
-- toggle two DIFFERENT services on the same company around the same time,
-- whichever write lands second overwrites the WHOLE object with a copy it
-- read before the first write committed — silently reverting the first
-- person's change, not just its own key. Doing the merge inside a single
-- UPDATE removes the read step (and the race) entirely; Postgres serializes
-- concurrent updates to the same row.
-- Safe to run more than once in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.set_service_override(p_company_id bigint, p_service text, p_value boolean)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  result jsonb;
BEGIN
  UPDATE public.companies
  SET services_manual = CASE
    WHEN p_value IS NULL THEN COALESCE(services_manual, '{}'::jsonb) - p_service
    ELSE COALESCE(services_manual, '{}'::jsonb) || jsonb_build_object(p_service, p_value)
  END
  WHERE id = p_company_id
  RETURNING services_manual INTO result;
  RETURN result;
END;
$$;
