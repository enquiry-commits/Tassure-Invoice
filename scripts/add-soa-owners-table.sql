-- SOA collections owner — keyed by normalized customer name, NOT
-- companies.id. Vincent, 2026-09-06: 18% of real customers with an
-- outstanding QuickBooks balance (60 of 332) have no matching `companies`
-- row at all — some are individuals ("Logan", "Phoebe Chiang"), some are
-- genuine companies never onboarded via TeamWork, and some are naming
-- variants of an existing company that would need manual review to merge
-- safely (bulk-matching risked merging two genuinely different real
-- companies that just share a naming pattern, e.g. "Grand Chen Holdings" vs
-- the real, separate "Grand Chen Resources"). Keying by name instead of a
-- companies.id works uniformly for every real QuickBooks customer without
-- touching the shared companies table at all.
--
-- Supersedes companies.soa_pic (added earlier the same day, never actually
-- used/populated — see scripts/add-companies-soa-pic.sql) — this migration
-- drops that column.
--
-- Run this ONCE in the Supabase SQL editor. Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS soa_owners (
  id BIGSERIAL PRIMARY KEY,
  customer_name_norm TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  soa_pic TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_email TEXT
);

ALTER TABLE companies DROP COLUMN IF EXISTS soa_pic;
