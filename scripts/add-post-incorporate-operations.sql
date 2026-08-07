-- Post Incorporate (Tassure) document generator: records every document set
-- generated through the new /post-incorporate page. Replaces the old
-- desktop tool's 3-tier JSON-files-on-a-network-share history — a real
-- Postgres table also removes the need for that tool's manual multi-user
-- file-lock mechanism (Postgres already serializes concurrent writes).
--
-- form_data stores the full submitted company/directors/shareholders input
-- as JSON, so a past operation's exact inputs can always be inspected or
-- reused as a starting point for "last used values" autocomplete, without
-- a separate history-file format.
--
-- Run ONCE in the Supabase SQL editor. Idempotent — safe to re-run.

create table if not exists post_incorporate_operations (
  id bigserial primary key,
  company_name text not null,
  company_uen text not null,
  need_nd_service boolean not null default false,
  form_data jsonb not null,
  generated_files text[] not null default '{}',
  created_by_email text,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists post_incorporate_operations_company_idx on post_incorporate_operations (company_uen);
create index if not exists post_incorporate_operations_created_at_idx on post_incorporate_operations (created_at desc);
