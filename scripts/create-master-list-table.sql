-- Master List table (Strike Off / Terminated / Name Change / Inactive Old Record)
-- Source: Copy of 2022.09.30-Master List (Strike off & Terminated).xlsx — 4 sheets, same 40-column structure
-- Run this in Supabase SQL Editor ("Run without RLS" if prompted)

CREATE TABLE IF NOT EXISTS master_list (
  id                          SERIAL PRIMARY KEY,
  list_type                   TEXT NOT NULL,   -- 'strike_off' | 'terminated' | 'name_change' | 'inactive_old'
  row_order                   INTEGER,         -- preserves original row order within each sheet

  update_date                 TEXT,
  internal_code               TEXT,            -- e.g. CC033
  company_name                TEXT,
  roc_no                      TEXT,
  status                      TEXT,            -- 'STRUCK OFF' | 'TERMINATED' | 'YES' | etc.
  join_date                   TEXT,
  sec_agent                   TEXT,
  kyc_year                    TEXT,
  register_of_controllers     TEXT,
  corporate_tax                TEXT,
  efiling_authorization       TEXT,
  ac                          TEXT,
  audit                       TEXT,
  gst                         TEXT,
  compil_report               TEXT,
  cpf_submit                  TEXT,
  add_here                    TEXT,
  invoice_address             TEXT,
  mailing_address              TEXT,
  contact_window               TEXT,
  mailing_list                TEXT,
  email                       TEXT,
  tel                         TEXT,
  inc_date                    TEXT,
  shareholders                TEXT,
  directors                   TEXT,
  nominee_director            TEXT,
  secretary                   TEXT,
  annual_return               TEXT,
  fye                         TEXT,
  last_ar_date                TEXT,
  last_agm_date               TEXT,
  last_accounts_date          TEXT,
  next_agm_due_date           TEXT,
  months_from_last_accounts   TEXT,
  remark                      TEXT,
  referral                    TEXT,
  risk_level                  TEXT,
  incorp_with_us              TEXT,
  acra_update                 TEXT,

  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_master_list_type ON master_list(list_type);
CREATE INDEX IF NOT EXISTS idx_master_list_company_name ON master_list(company_name);

-- Allow service role full access
ALTER TABLE master_list ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON master_list
  FOR ALL USING (true) WITH CHECK (true);
