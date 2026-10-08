-- SOA manual PIC (2026-10-08, Vincent/Chelsea). The PIC column shows QuickBooks' own PIC (invoice
-- Classes, else the TeamWork PIC). When that is wrong or empty — e.g. a balance that is only an
-- opening-balance Journal Entry carried over from the old system — the person picks ONE person from a
-- dropdown on the row; that manual pick has the HIGHEST priority and the system never overwrites it.
-- One pick per company PER BOOK (TAB / TAC / TAO), like soa_owners. Deliberately a NEW table: the old
-- soa_owners picks (the Sept import and the 5 manual ones) stay ignored (INV-PIC-011) and must not
-- come back to life. Deleting the row = back to QuickBooks' default.
-- Run this ONCE in the Supabase SQL editor. Idempotent.

CREATE TABLE IF NOT EXISTS soa_pic_overrides (
  id BIGSERIAL PRIMARY KEY,
  customer_name_norm TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  qb_company TEXT NOT NULL CHECK (qb_company IN ('TAB', 'TAC', 'TAO')),
  pic TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_email TEXT,
  UNIQUE (customer_name_norm, qb_company)
);

ALTER TABLE soa_pic_overrides ENABLE ROW LEVEL SECURITY;
