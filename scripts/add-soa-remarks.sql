-- One shared operational Remarks value per real company/customer across the
-- SOA Outstanding All/TAB/TAC/TAO views.
--
-- Keyed by normalized customer name rather than companies.id because many
-- genuine QuickBooks Outstanding customers do not have a companies row.
-- There is deliberately no qb_company column: TAB/TAC/TAO source rows for
-- the same company must all display and edit the same shared remark.
--
-- Run once in Supabase SQL Editor. Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS public.soa_remarks (
  id BIGSERIAL PRIMARY KEY,
  customer_name_norm TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  remarks TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_email TEXT
);

COMMENT ON TABLE public.soa_remarks IS
  'One shared SOA Outstanding remark per normalized company/customer across TAB, TAC and TAO.';

COMMENT ON COLUMN public.soa_remarks.customer_name_norm IS
  'Normalized company/customer name; used because not every QuickBooks customer exists in companies.';

COMMENT ON COLUMN public.soa_remarks.remarks IS
  'Shared operational note shown once across a grouped company and all of its source rows.';
