-- Client Communications: bulk email prep for Letter / AR / SOA reminders.
-- Replaces the manual BULK.xlsm workflow. The system prepares recipient,
-- amount, invoice-number and merged subject/body data; sending itself stays
-- manual via each staff member's own Outlook (a "Compose in Outlook" mailto:
-- link, per Vincent's decision — no email-sending service is wired up).
--
-- Run ONCE in the Supabase SQL editor. Idempotent — safe to re-run.

-- ── Senders ──────────────────────────────────────────────────────────────
-- Mirrors the Excel's "Sender Email list" sheet — which mailbox a campaign is
-- drafted as being "from" (display only; actual send is the staff member's
-- own Outlook, so this does not need mailbox credentials).
create table if not exists email_senders (
  id bigserial primary key,
  email text not null unique,
  display_name text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── Templates ────────────────────────────────────────────────────────────
-- Subject/body carry {{merge_field}} placeholders (companyName, contactName,
-- toEmail, ccEmail, totalAmount, invoiceList, dueDate, fyeMonth, fyeYear).
-- Seeded with a starting template per type; staff edit these in
-- Templates & Senders to match their exact existing wording.
create table if not exists email_templates (
  id bigserial primary key,
  type text not null check (type in ('letter', 'ar', 'soa')),
  name text not null,
  subject_template text not null,
  body_template text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Campaigns ────────────────────────────────────────────────────────────
-- One "batch" created from Campaign Centre — a chosen type + cycle/company
-- selection. Drafts (below) are generated from it.
create table if not exists email_campaigns (
  id bigserial primary key,
  type text not null check (type in ('letter', 'ar', 'soa')),
  name text not null,
  fye_month text,
  fye_year int,
  sender_id bigint references email_senders(id),
  template_id bigint references email_templates(id),
  status text not null default 'draft' check (status in ('draft', 'active', 'completed')),
  created_by_email text,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists email_campaigns_cycle_idx on email_campaigns (fye_month, fye_year);

-- ── Drafts ───────────────────────────────────────────────────────────────
-- One row per company per campaign — the Draft Review + Delivery History
-- unit. invoice_refs is the audit trail of exactly which invoices (across
-- TAB/TAC/TAO) fed the merged amount, so a draft's numbers can always be
-- traced back to real generated_invoices/quickbooks_invoices rows.
create table if not exists email_drafts (
  id bigserial primary key,
  campaign_id bigint not null references email_campaigns(id) on delete cascade,
  company_id bigint references companies(id),
  company_name text not null,
  to_email text,
  cc_email text,
  subject text not null,
  body text not null,
  invoice_refs jsonb not null default '[]'::jsonb,
  total_amount numeric,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped')),
  sent_at timestamptz,
  sent_by_email text,
  sent_by_name text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_drafts_campaign_idx on email_drafts (campaign_id);
create index if not exists email_drafts_status_idx on email_drafts (status);
create index if not exists email_drafts_company_idx on email_drafts (company_id);

-- Seed the two known senders (from the Excel's Sender Email list) and one
-- starting template per type — safe no-ops if already present.
insert into email_senders (email, display_name, is_default)
values
  ('finance@tassure.com', 'Tassure Finance', true),
  ('contact@tassure.com', 'Tassure Contact', false)
on conflict (email) do nothing;

insert into email_templates (type, name, subject_template, body_template, is_default)
select 'ar', 'AR Renewal Reminder (default)',
  'Corporate Secretarial Services Renewal - {{companyName}}',
  E'Dear {{contactName}},\n\nPlease find attached the renewal invoice(s) for {{companyName}}:\n\n{{invoiceList}}\n\nTotal amount due: S${{totalAmount}}\n\nKindly arrange payment at your earliest convenience.\n\nThank you.',
  true
where not exists (select 1 from email_templates where type = 'ar' and is_default);

insert into email_templates (type, name, subject_template, body_template, is_default)
select 'soa', 'Statement of Account (default)',
  'Statement of Account - {{companyName}}',
  E'Dear {{contactName}},\n\nPlease find below the outstanding invoices for {{companyName}}:\n\n{{invoiceList}}\n\nTotal outstanding: S${{totalAmount}}\n\nKindly settle at your earliest convenience.\n\nThank you.',
  true
where not exists (select 1 from email_templates where type = 'soa' and is_default);

insert into email_templates (type, name, subject_template, body_template, is_default)
select 'letter', 'Document Reminder',
  'Reminder - Outstanding Document for {{companyName}}',
  E'Dear {{contactName}},\n\nThis is a reminder that we are still awaiting the following document(s) from {{companyName}}.\n\nKindly send these to us at your earliest convenience.\n\nThank you.',
  true
where not exists (select 1 from email_templates where type = 'letter' and is_default);
