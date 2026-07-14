-- Manual service overrides on the companies master.
--
-- services_manual holds ONLY human decisions, e.g. {"secretary": true, "tax": false}.
-- A key present here ALWAYS wins over the automatic judgement (QB history /
-- TeamWork-derived flags); a key absent means "automatic". No sync job ever
-- writes this column — it is exclusively set from the AR Reminder detail
-- modal, so manual corrections can never be overwritten by automation.
--
-- Run ONCE in the Supabase SQL editor. Idempotent.
alter table companies add column if not exists services_manual jsonb not null default '{}'::jsonb;
