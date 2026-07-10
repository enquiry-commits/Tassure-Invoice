-- Late Filing Companies table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS late_filing_companies (
  id                    SERIAL PRIMARY KEY,
  company_name          TEXT NOT NULL,
  uen                   TEXT,
  financial_year_end    TEXT,          -- 'JAN' | 'FEB' | ... | 'DEC'
  last_annual_return_date DATE,
  last_agm_date           DATE,
  last_accounts_date      DATE,
  next_agm_due_date       DATE,
  remarks               TEXT,          -- 'ACRA STRIKE OFF' | 'STRIKE OFF - CLIENT LODGED OBJECTION' | etc.
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Allow service role full access
ALTER TABLE late_filing_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON late_filing_companies
  FOR ALL USING (true) WITH CHECK (true);
