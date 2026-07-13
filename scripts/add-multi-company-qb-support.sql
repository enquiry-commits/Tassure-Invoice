-- Multi-company QuickBooks support: TAB (default company, all basic services)
-- + TAC (Nominee Director services only).
--
-- Run this ONCE in the Supabase SQL editor BEFORE deploying the app code that
-- depends on it (the code queries columns/tables this migration creates).
-- Idempotent — safe to re-run.

-- 1) Label each QB OAuth connection so the app can look up "the TAB token" vs
--    "the TAC token" instead of assuming a single connected company.
alter table quickbooks_tokens add column if not exists company_label text;
update quickbooks_tokens set company_label = 'TAB' where company_label is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_tokens_company_label_key') then
    alter table quickbooks_tokens add constraint quickbooks_tokens_company_label_key unique (company_label);
  end if;
end $$;

-- 2) Tag every invoice / line item with which QB company it came from.
alter table quickbooks_invoices add column if not exists qb_company text not null default 'TAB';
alter table quickbooks_invoice_items add column if not exists qb_company text not null default 'TAB';

-- 3) A second QB company has its own independent DocNumber sequence, so
--    "invoice_no is globally unique" no longer holds — rescope the uniqueness
--    constraints to be per-company. Constraint names aren't hardcoded (we
--    don't know them in advance), so drop whatever unique constraints exist
--    on these columns and recreate them scoped by qb_company.
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'quickbooks_invoices' and con.contype = 'u'
  loop
    execute format('alter table quickbooks_invoices drop constraint %I', r.conname);
  end loop;

  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'quickbooks_invoice_items' and con.contype = 'u'
  loop
    execute format('alter table quickbooks_invoice_items drop constraint %I', r.conname);
  end loop;
end $$;

alter table quickbooks_invoices
  add constraint quickbooks_invoices_company_invoice_no_key unique (qb_company, invoice_no);
alter table quickbooks_invoice_items
  add constraint quickbooks_invoice_items_company_invoice_line_key unique (qb_company, invoice_no, line_num);

-- 4) Record every invoice OUR system generates from Billing Drafts. This is
--    the authoritative "already invoiced this cycle" source going forward
--    (vs. fuzzy-parsing descriptions on synced QB data), and is what lets the
--    Billing page show the real invoice number per company per QB company.
create table if not exists generated_invoices (
  id bigserial primary key,
  company_name text not null,
  fye_month text,
  fye_year int,
  fye_cycle text,             -- "dd.mm.yyyy", matches the billedCycles marker format
  qb_company text not null,   -- 'TAB' | 'TAC'
  invoice_no text,
  qb_invoice_id text,
  total_amt numeric,
  services text[],            -- service codes included, e.g. {Secretary,Address,AR}
  created_at timestamptz not null default now()
);
create index if not exists generated_invoices_company_idx on generated_invoices (company_name, fye_cycle);
