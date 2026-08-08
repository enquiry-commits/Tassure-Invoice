-- Nightly-synced snapshot of TeamWork's per-company "Active Officials" table
-- (Director/Secretary/Controller/Representative/Contact Person) and the real
-- Shareholders share register — both scraped from the same company profile
-- page (view_company/<id>/?comp) already fetched every night by
-- teamwork/sync-secretary for the Secretary column. Lets Post Incorporate's
-- UEN lookup read from Supabase instead of doing its own live TeamWork
-- login+fetch on every request.
--
-- Each nightly sync replaces all rows for a given internal_id wholesale
-- (delete + insert), so these are always a full, current snapshot as of
-- that company's last sync — no partial/stale row merging to reason about.
--
-- Run ONCE in the Supabase SQL editor. Idempotent — safe to re-run.

create table if not exists teamwork_company_officials (
  id bigserial primary key,
  internal_id text not null,
  uen text,
  name text not null,
  role text not null,
  id_no text,
  id_type text,
  address text,
  date_of_appointment text,
  synced_at timestamptz not null default now()
);
create index if not exists teamwork_company_officials_internal_id_idx on teamwork_company_officials (internal_id);
create index if not exists teamwork_company_officials_uen_idx on teamwork_company_officials (uen);

create table if not exists teamwork_shareholder_shares (
  id bigserial primary key,
  internal_id text not null,
  uen text,
  shareholder_name text not null,
  issued_share_capital text,
  paid_up_capital text,
  consideration_paid_up_capital text,
  number_of_shares text,
  currency text,
  share_type text,
  share_class text,
  synced_at timestamptz not null default now()
);
create index if not exists teamwork_shareholder_shares_internal_id_idx on teamwork_shareholder_shares (internal_id);
create index if not exists teamwork_shareholder_shares_uen_idx on teamwork_shareholder_shares (uen);
