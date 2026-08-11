-- teamwork_shareholder_shares now comes from TeamWork's own Shares module
-- (shares/share_list/<id>), which has a per-transaction Share Cert No. this
-- system didn't have any source for before. Comma-joined when a person has
-- more than one certificate (multiple allotments/transfers).
--
-- Run ONCE in the Supabase SQL editor. Idempotent — safe to re-run.

alter table teamwork_shareholder_shares add column if not exists share_certificate_no text;
