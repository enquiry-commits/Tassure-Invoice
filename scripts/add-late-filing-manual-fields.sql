-- Same per-field manual-override protection as master_list.manual_fields
-- (scripts/add-master-list-manual-fields.sql), applied to late_filing_
-- companies instead — replaces the old row-level "does remarks start with
-- AUTO:" gate, which silently reverted a manually-corrected date field
-- whenever staff left remarks untouched in the same save (the edit modal
-- always round-trips the whole form).
--
-- No atomic-merge RPC needed here, unlike master_list: this table already
-- has a row-level optimistic-concurrency check (previousUpdatedAt vs.
-- updated_at) in app/api/late-filing/route.ts's PATCH, which already
-- serializes two staff editing the same row, so a plain read-then-merge in
-- that same request is safe — there is no separate per-field race to guard
-- against the way there was for master_list's independent-field PATCHes.
-- Safe to run more than once in Supabase SQL Editor.

ALTER TABLE public.late_filing_companies
  ADD COLUMN IF NOT EXISTS manual_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- One-time backfill so existing rows keep their current protection status
-- under the new per-field system: under the old row-level gate, ANY row
-- whose remarks no longer started with "AUTO:" had already stopped being
-- touched by the sync entirely (all 5 fields at once). Without this
-- backfill, manual_fields would default to '{}' for these rows and the
-- next sync run would start overwriting them again.
UPDATE public.late_filing_companies
SET manual_fields = jsonb_build_object(
  'financial_year_end', true, 'last_agm_date', true,
  'last_annual_return_date', true, 'next_agm_due_date', true, 'remarks', true
)
WHERE remarks IS NOT NULL AND remarks !~* '^AUTO:' AND manual_fields = '{}'::jsonb;
