-- SOA collections owner — separate from companies.pic (Secretary PIC, which
-- can legitimately list 2+ co-assigned people, e.g. "Chin Kah Ye, Ang Shi
-- Ming"). For an outstanding balance, Chelsea needs to pick exactly ONE of
-- them as the person actually responsible for chasing this specific client's
-- payment — companies.pic itself must never be overwritten just to resolve
-- that ambiguity, since it's used elsewhere for its own separate meaning.
--
-- Run this ONCE in the Supabase SQL editor. Idempotent — safe to re-run.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS soa_pic TEXT;
