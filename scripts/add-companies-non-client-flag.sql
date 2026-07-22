-- Legacy compatibility flag used by the Companies page for TeamWork's
-- Shareholder identity. TeamWork's visible Client column is derived from
-- `corporate_shareholder` and `corporate_shareholder_client`; `non_client`
-- is a separate flag and must not be treated as Shareholder.
--
-- Run ONCE in the Supabase SQL editor. Idempotent — safe to re-run.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS is_non_client BOOLEAN DEFAULT false;
