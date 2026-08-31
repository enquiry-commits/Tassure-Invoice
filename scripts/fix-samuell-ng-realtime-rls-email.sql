-- Fixes a real login-email mismatch found while building Company 360 / My
-- Tasks (2026-08-31): lib/approved-accounts.ts (Samuell's actual login
-- email, used by Supabase Auth) had 'samuell@tassure.com', but
-- lib/staff-directory.ts (used for PIC matching) has always had
-- 'samuellng@tassure.com' for the same person — confirmed with Vincent
-- that samuellng@tassure.com is correct. The TS file is fixed in the same
-- commit as this script, but the wrong email was ALSO baked into these two
-- live RLS realtime policies (scripts/optimize-realtime-rls-policies.sql,
-- itself superseding the same string in add-ar-collaboration.sql and
-- enable-master-list-realtime.sql) — without this fix, Samuell logs in
-- fine but silently never receives realtime updates on AR Reminder/Master
-- List, since his real JWT email never matches the policy's allowlist.
--
-- Identical to optimize-realtime-rls-policies.sql except for this one
-- string. Safe to run more than once in Supabase SQL Editor.

DROP POLICY IF EXISTS "Authenticated users can receive AR updates" ON public.ar_reminder;
CREATE POLICY "Authenticated users can receive AR updates"
  ON public.ar_reminder FOR SELECT TO authenticated
  USING ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'vincent@tassure.com', 'cindyzhang@tassure.com', 'samuellng@tassure.com',
    'hoechyi@tassure.com', 'sengxin@tassure.com', 'jennylai@tassure.com',
    'kahye@tassure.com', 'shiming@tassure.com', 'shemin@tassure.com',
    'minquan@tassure.com', 'esther@tassure.com', 'chelsea@tassure.com'
  ]));

DROP POLICY IF EXISTS "Authenticated users can receive Master List updates" ON public.master_list;
CREATE POLICY "Authenticated users can receive Master List updates"
  ON public.master_list FOR SELECT TO authenticated
  USING ((SELECT auth.jwt() ->> 'email') = ANY (ARRAY[
    'vincent@tassure.com', 'cindyzhang@tassure.com', 'samuellng@tassure.com',
    'hoechyi@tassure.com', 'sengxin@tassure.com', 'jennylai@tassure.com',
    'kahye@tassure.com', 'shiming@tassure.com', 'shemin@tassure.com',
    'minquan@tassure.com', 'esther@tassure.com', 'chelsea@tassure.com'
  ]));
