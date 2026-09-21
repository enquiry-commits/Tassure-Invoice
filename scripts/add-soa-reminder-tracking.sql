-- SOA Reminder sequence and Outlook Helper send verification.
-- Run once in Supabase SQL Editor before deploying the matching code.
-- Idempotent: safe to run again.

alter table public.email_drafts
  add column if not exists soa_reminder_stage smallint,
  add column if not exists soa_qb_company text,
  add column if not exists outlook_send_verified_at timestamptz;

do $$ begin
  alter table public.email_drafts
    add constraint email_drafts_soa_reminder_stage_check
    check (soa_reminder_stage is null or soa_reminder_stage between 1 and 3);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.email_drafts
    add constraint email_drafts_soa_qb_company_check
    check (soa_qb_company is null or soa_qb_company in ('TAB', 'TAC', 'TAO', 'ALL'));
exception when duplicate_object then null;
end $$;

-- Preserve historical campaigns/templates. The two old SOA templates stay
-- in the database because email_campaigns.template_id may reference them;
-- the application hides them and permits only these 3 sequence templates.
update public.email_templates
set is_default = false, updated_at = now()
where type = 'soa' and name not in ('1st Reminder', '2nd Reminder', '3rd Reminder');

update public.email_templates
set is_default = (name = '1st Reminder'), updated_at = now()
where type = 'soa' and name in ('1st Reminder', '2nd Reminder', '3rd Reminder');

-- Backfill sequence/scope metadata for old drafts where it can be known.
-- We deliberately DO NOT backfill outlook_send_verified_at: historical
-- status='sent' rows do not prove that Outlook Helper itself acknowledged
-- .Send(), and must not be presented as verified Done.
update public.email_drafts d
set soa_reminder_stage = case t.name
      when '1st Reminder' then 1
      when '2nd Reminder' then 2
      when '3rd Reminder' then 3
    end,
    soa_qb_company = upper(substring(c.name from '^SOA \((TAB|TAC|TAO|ALL)\)'))
from public.email_campaigns c
join public.email_templates t on t.id = c.template_id
where d.campaign_id = c.id
  and c.type = 'soa'
  and t.name in ('1st Reminder', '2nd Reminder', '3rd Reminder');

create index if not exists email_drafts_soa_verified_reminder_idx
  on public.email_drafts (company_id, soa_qb_company, soa_reminder_stage, outlook_send_verified_at desc)
  where status = 'sent' and outlook_send_verified_at is not null;

comment on column public.email_drafts.soa_reminder_stage is
  'SOA collection sequence: 1=1st, 2=2nd, 3=3rd reminder; snapshotted when the draft is created.';
comment on column public.email_drafts.soa_qb_company is
  'SOA scope for this draft: TAB/TAC/TAO/ALL; null only for legacy or Campaign Centre cross-book batches.';
comment on column public.email_drafts.outlook_send_verified_at is
  'Set only after the local Outlook Helper returns success from Outlook .Send(); manual Mark as Sent leaves this null.';
