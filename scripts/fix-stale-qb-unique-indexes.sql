-- Drop stale PRE-multi-company unique indexes on the QB mirror tables.
--
-- add-multi-company-qb-support.sql rescoped uniqueness to (qb_company, ...)
-- by dropping unique CONSTRAINTS (pg_constraint contype='u') — but a
-- standalone UNIQUE INDEX (created via CREATE UNIQUE INDEX, not visible in
-- pg_constraint) survived: qb_items_invoice_line_idx on (invoice_no, line_num).
-- TAB and TAC have independent DocNumber sequences, so the first colliding
-- number (e.g. 02680026 in both companies) made TAC line-item upserts fail.
--
-- This drops EVERY unique index on the two tables except the correct
-- per-company keys and the primary keys. Idempotent — safe to re-run.
do $$
declare r record;
begin
  for r in
    select indexname from pg_indexes
    where tablename in ('quickbooks_invoices', 'quickbooks_invoice_items')
      and indexdef ilike 'create unique index%'
      and indexname not in (
        'quickbooks_invoices_company_invoice_no_key',
        'quickbooks_invoice_items_company_invoice_line_key',
        'quickbooks_invoices_pkey',
        'quickbooks_invoice_items_pkey'
      )
  loop
    execute format('drop index if exists %I', r.indexname);
  end loop;
end $$;
