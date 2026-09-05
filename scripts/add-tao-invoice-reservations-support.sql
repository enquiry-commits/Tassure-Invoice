-- Allow TAO invoice-creation reservations. invoice_creation_reservations.qb_company
-- has a hard CHECK constraint limited to ('TAB','TAC') from when the table was
-- first created (see add-multi-company-qb-support.sql) — inserting a TAO row
-- (from the new /billing/tao ACC billing page) is rejected by Postgres until
-- this runs.
--
-- Run this ONCE in the Supabase SQL editor BEFORE deploying the app code that
-- creates TAO invoices. Idempotent — safe to re-run. Constraint name isn't
-- hardcoded (auto-generated, not known in advance) — look it up and drop
-- whatever CHECK constraint currently exists on the column, same pattern as
-- add-multi-company-qb-support.sql's unique-constraint rescoping.
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'invoice_creation_reservations'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%qb_company%'
  loop
    execute format('alter table invoice_creation_reservations drop constraint %I', r.conname);
  end loop;
end $$;

alter table invoice_creation_reservations
  add constraint invoice_creation_reservations_qb_company_check
  check (qb_company in ('TAB', 'TAC', 'TAO'));
