-- Speeds up Realtime's per-subscriber RLS check on every change (Vincent
-- asked whether the ~370-710ms measured delivery latency could be brought
-- down further; Supabase's own RLS-performance guidance is to wrap
-- auth.jwt() in a `(SELECT ...)` rather than calling it bare in USING —
-- the bare form gets re-evaluated per row instead of once per statement.
-- Applies to both ar_reminder's existing policy (add-ar-collaboration.sql)
-- and master_list's (enable-master-list-realtime.sql), which both used the
-- unwrapped form. Functionally identical allowlist — this only changes
-- how cheaply Postgres evaluates it.
-- Safe to run more than once in Supabase SQL Editor.

DROP POLICY IF EXISTS "Authenticated users can receive AR updates" ON public.ar_reminder;
CREATE POLICY "Authenticated users can receive AR updates"
  ON public.ar_reminder FOR SELECT TO authenticated
  USING ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'vincent@tassure.com', 'cindyzhang@tassure.com', 'samuell@tassure.com',
    'hoechyi@tassure.com', 'sengxin@tassure.com', 'jennylai@tassure.com',
    'kahye@tassure.com', 'shiming@tassure.com', 'shemin@tassure.com',
    'minquan@tassure.com', 'esther@tassure.com', 'chelsea@tassure.com'
  ]));

DROP POLICY IF EXISTS "Authenticated users can receive Master List updates" ON public.master_list;
CREATE POLICY "Authenticated users can receive Master List updates"
  ON public.master_list FOR SELECT TO authenticated
  USING ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'vincent@tassure.com', 'cindyzhang@tassure.com', 'samuell@tassure.com',
    'hoechyi@tassure.com', 'sengxin@tassure.com', 'jennylai@tassure.com',
    'kahye@tassure.com', 'shiming@tassure.com', 'shemin@tassure.com',
    'minquan@tassure.com', 'esther@tassure.com', 'chelsea@tassure.com'
  ]));
