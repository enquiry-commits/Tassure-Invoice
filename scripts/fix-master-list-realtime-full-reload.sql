-- Master List's Realtime subscription was reloading the whole page after
-- EVERY edit anywhere in the table, not just ACC/TAX PIC changes (Vincent:
-- "每次我更改一个东西，系统就会LOADING整个页面一轮"). Root cause: Postgres
-- always sends the FULL new row in a postgres_changes UPDATE payload
-- (payload.new), so checking "does this field exist on the payload" was
-- true on every single edit — the fix (components/MasterListTable.tsx)
-- needs to compare the OLD value against the NEW one instead, which
-- requires payload.old to contain the full previous row rather than just
-- the primary key. That requires REPLICA IDENTITY FULL.
-- Safe to run more than once in Supabase SQL Editor.

ALTER TABLE public.master_list REPLICA IDENTITY FULL;
