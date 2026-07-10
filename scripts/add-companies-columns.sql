-- ============================================================
-- Step 1: Add service flags + QB linking to companies table
-- ============================================================
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS has_annual_return BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS has_agm           BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS has_xbrl          BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_accounts      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_tax           BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_nd            BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS sec_pic           TEXT,
  ADD COLUMN IF NOT EXISTS acc_pic           TEXT,
  ADD COLUMN IF NOT EXISTS tax_pic           TEXT,
  ADD COLUMN IF NOT EXISTS qb_customer_name  TEXT,
  ADD COLUMN IF NOT EXISTS last_invoice_date DATE,
  ADD COLUMN IF NOT EXISTS is_active         BOOLEAN DEFAULT true;

-- ============================================================
-- Step 2: QB invoice line items table
-- ============================================================
CREATE TABLE IF NOT EXISTS quickbooks_invoice_items (
  id               BIGSERIAL PRIMARY KEY,
  invoice_no       TEXT,
  qb_invoice_id    TEXT,
  customer_name    TEXT NOT NULL,
  txn_date         DATE,
  line_num         INTEGER NOT NULL DEFAULT 1,
  description      TEXT,
  product_service  TEXT,
  qty              NUMERIC(10, 4),
  rate             NUMERIC(12, 2),
  amount           NUMERIC(12, 2),
  service_type     TEXT,   -- AR | AGM | XBRL | Secretary | ND | Address | Accounts | Tax | Audit | Other
  scraped_at       TIMESTAMPTZ DEFAULT NOW(),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Partial unique index so we can upsert by invoice_no + line_num
CREATE UNIQUE INDEX IF NOT EXISTS qb_items_invoice_line_idx
  ON quickbooks_invoice_items (invoice_no, line_num)
  WHERE invoice_no IS NOT NULL;

-- Enable RLS (service role bypasses it)
ALTER TABLE quickbooks_invoice_items ENABLE ROW LEVEL SECURITY;
