# Automation hardening rollout

Apply this rollout in order. Do not deploy the application code before the
database migration is complete.

1. Change the TeamWork password. An old fallback credential existed in Git,
   so removing it from the current files does not revoke the exposed value.
2. Confirm all variables listed in `.env.example` exist in Vercel Production.
   `CRON_SECRET` is mandatory for Vercel Cron requests to pass `proxy.ts`.
3. Run `scripts/harden-automation.sql` in the Supabase SQL Editor.
4. Run the verification queries below.
5. Deploy the application.
6. Trigger each sync once manually while signed in and check the Automation
   Health strip on Dashboard.
7. After the cloud `teamwork_nd` run succeeds, disable the Windows scheduled
   task `Tassure-ND-Sync` to avoid maintaining two schedulers.

## Migration verification

```sql
select to_regclass('public.automation_sync_runs') as sync_runs,
       to_regclass('public.automation_sync_locks') as sync_locks,
       to_regclass('public.automation_exceptions') as exceptions,
       to_regclass('public.invoice_creation_reservations') as invoice_reservations;

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'quickbooks_invoices'
  and column_name in ('qb_invoice_id', 'qb_customer_id', 'last_seen_sync_run');

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'quickbooks_invoice_items'
  and column_name in (
    'qb_line_id', 'qb_customer_id', 'last_seen_sync_run',
    'classification_source', 'period_parse_status'
  );
```

Every requested table/column should be returned. The four `to_regclass`
values must not be null.

## First-run checks

```sql
select source, status, started_at, finished_at, summary, error
from public.automation_sync_runs
order by started_at desc
limit 30;

select source, exception_type, entity_name, details, last_seen_at
from public.automation_exceptions
where status = 'open'
order by last_seen_at desc;

select qb_company, status, doc_number, company_name, error, updated_at
from public.invoice_creation_reservations
where status in ('pending', 'uncertain')
order by updated_at desc;
```
