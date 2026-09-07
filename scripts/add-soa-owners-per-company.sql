-- soa_owners becomes per-(customer, QuickBooks company) instead of one
-- global owner per customer name.
--
-- Vincent, 2026-09-07: "所以现在这边的逻辑是什么和我GOOGLE SHEET的显示，为
-- 什么又存在差异" — investigated against the real sheet (it has 3 SEPARATE
-- tabs — TAB/TAC/TAO — each with its own PIC column) before answering.
-- Confirmed root cause: soa_owners was only ever backfilled from the TAB
-- tab (the sheet's default/first tab), then applied as ONE global owner
-- across all 3 pages. But the real sheet genuinely assigns a DIFFERENT
-- person per system for the same company in real cases — 13 of the 81
-- companies that owe on 2+ systems have a different primary PIC on each
-- tab (e.g. "Meishan Silk Road Trading": TAB tab says CKY, TAO tab says
-- VC — two different real people). A single company-name-keyed row can
-- never represent that.
--
-- Safe to run more than once in the Supabase SQL Editor.

ALTER TABLE public.soa_owners ADD COLUMN IF NOT EXISTS qb_company text;

-- Every existing row came from the original TAB-tab-only backfill
-- (2026-09-05/06) — label them accurately rather than guessing.
UPDATE public.soa_owners SET qb_company = 'TAB' WHERE qb_company IS NULL;

ALTER TABLE public.soa_owners ALTER COLUMN qb_company SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'soa_owners_qb_company_check'
  ) THEN
    ALTER TABLE public.soa_owners
      ADD CONSTRAINT soa_owners_qb_company_check CHECK (qb_company IN ('TAB', 'TAC', 'TAO'));
  END IF;
END $$;

-- The original UNIQUE was declared inline on customer_name_norm alone
-- (auto-generated name, never hardcoded elsewhere in this repo — same
-- dynamic-lookup convention as scripts/add-tao-invoice-reservations-
-- support.sql) — drop it and replace with a composite key so the same
-- customer can have one confirmed owner PER system.
DO $$
DECLARE
  old_constraint_name text;
BEGIN
  SELECT conname INTO old_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.soa_owners'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%(customer_name_norm)%';
  IF old_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.soa_owners DROP CONSTRAINT %I', old_constraint_name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'soa_owners_name_company_key'
  ) THEN
    ALTER TABLE public.soa_owners
      ADD CONSTRAINT soa_owners_name_company_key UNIQUE (customer_name_norm, qb_company);
  END IF;
END $$;
