-- Persistent staff-set link: a subsidiary's invoices should show the PARENT
-- company's name+address on the "Bill To" block, while still invoicing
-- under the subsidiary's own QuickBooks customer record. Set from the
-- "Build & generate invoice" modal's parent-company picker
-- (app/api/companies/parent/route.ts) — never written by any sync.
-- ON DELETE SET NULL: if a parent company row is ever removed, subsidiaries
-- linked to it fall back to normal (un-overridden) invoicing instead of
-- pointing at a dangling id.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS parent_company_id BIGINT REFERENCES companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_companies_parent_company_id ON companies (parent_company_id);
