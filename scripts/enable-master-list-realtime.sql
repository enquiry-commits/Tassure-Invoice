-- Enables Supabase Realtime (postgres_changes) on master_list, same as
-- ar_reminder already has (see add-ar-collaboration.sql) — without this,
-- components/MasterListTable.tsx's live-sync subscription connects but
-- never receives any row change events.
-- Safe to run more than once in Supabase SQL Editor.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'master_list'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.master_list;
  END IF;
END;
$$;

-- Realtime is filtered through RLS for the subscribing role (the browser
-- connects as `authenticated`, not the server's service_role) — master_list
-- only had a service_role policy (create-master-list-table.sql), so without
-- this the subscription above would connect but silently receive nothing.
-- Same allowlist/pattern as ar_reminder's own policy.
DROP POLICY IF EXISTS "Authenticated users can receive Master List updates" ON public.master_list;
CREATE POLICY "Authenticated users can receive Master List updates"
  ON public.master_list FOR SELECT TO authenticated
  USING ((auth.jwt() ->> 'email') = ANY (ARRAY[
    'vincent@tassure.com', 'cindyzhang@tassure.com', 'samuell@tassure.com',
    'hoechyi@tassure.com', 'sengxin@tassure.com', 'jennylai@tassure.com',
    'kahye@tassure.com', 'shiming@tassure.com', 'shemin@tassure.com',
    'minquan@tassure.com', 'esther@tassure.com', 'chelsea@tassure.com'
  ]));
