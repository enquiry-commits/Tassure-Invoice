-- TeamWork's `client` field (used by app/api/teamwork/sync/route.ts's insert
-- filter) turned out NOT to mean "is a real CSS client" — verified against
-- live TeamWork data, several genuinely Active corp-sec clients (BIC Systems
-- Asia Pacific, Blue Eagle Supply Chain, Benfold Shipping, Billiongold
-- Marine, Bistro Bugis, Care Property Holdings, ...) have client="0" despite
-- being real clients with a proper client_id (CB003, CB025, ...). The field
-- that actually distinguishes a real client from a Shareholder/related
-- entity is `non_client` ("1" for Shareholder-type rows like "1X EXCHANGE
-- PSS LIMITED", "0" for genuine clients).
--
-- Run ONCE in the Supabase SQL editor. Idempotent — safe to re-run.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS is_non_client BOOLEAN DEFAULT false;
