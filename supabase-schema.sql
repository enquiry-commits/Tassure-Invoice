-- ============================================================
-- Tassure Invoice — Billing Dashboard Database Schema
-- Supabase project: wcwozqbiqavxgewilnub
-- ============================================================

-- Companies (synced from CSS scraper)
create table if not exists companies (
  id              serial primary key,
  company_name    text not null,
  registration_no text,
  company_type    text,
  internal_id     text unique,          -- CSS system internal ID
  fye_month       text,
  pic             text,                  -- Person In Charge (Tassure staff)
  uses_address    boolean default false, -- Using 10 Anson Road #12-08
  best_email      text,
  primary_contact jsonb,                 -- { contactName, email, phone }
  contact_persons jsonb default '[]',
  synced_at       timestamptz default now(),
  created_at      timestamptz default now()
);

-- Nominee Directors (the 13 Tassure NDs)
create table if not exists nominee_directors (
  id          serial primary key,
  name        text not null unique,
  member_id   text,                      -- CSS system member ID
  created_at  timestamptz default now()
);

-- ND Appointments (director history per company)
create table if not exists nd_appointments (
  id               serial primary key,
  nd_id            integer references nominee_directors(id),
  company_name     text not null,
  sub_role         text,
  appointment_date date,
  cessation_date   date,
  created_at       timestamptz default now()
);

-- Billing records (draft invoices — never auto-sent)
create table if not exists billing_records (
  id              serial primary key,
  company_name    text not null,
  registration_no text,
  service_type    text not null,   -- 'nominee_director' | 'address_service' | 'secretarial'
  period_start    date,
  period_end      date,
  amount          numeric(10,2),
  currency        text default 'SGD',
  status          text default 'draft',   -- 'draft' | 'reviewed' | 'sent' | 'paid'
  quickbooks_id   text,                   -- QuickBooks invoice ID if matched
  notes           text,
  created_at      timestamptz default now(),
  reviewed_at     timestamptz,
  reviewed_by     text
);

-- Sync log (track when data was last scraped)
create table if not exists sync_log (
  id          serial primary key,
  source      text not null,             -- 'css_companies' | 'nd_appointments'
  records     integer,
  status      text,
  synced_at   timestamptz default now()
);

-- ============================================================
-- Row Level Security (public read for now, restrict writes)
-- ============================================================
alter table companies          enable row level security;
alter table nominee_directors  enable row level security;
alter table nd_appointments    enable row level security;
alter table billing_records    enable row level security;
alter table sync_log           enable row level security;

-- Allow anon read on all tables
create policy "Public read companies"         on companies         for select using (true);
create policy "Public read nominee_directors" on nominee_directors for select using (true);
create policy "Public read nd_appointments"   on nd_appointments   for select using (true);
create policy "Public read billing_records"   on billing_records   for select using (true);
create policy "Public read sync_log"          on sync_log          for select using (true);
