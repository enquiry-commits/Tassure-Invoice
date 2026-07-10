-- Add service period columns to quickbooks_invoice_items
-- Run in Supabase SQL Editor (Run without RLS)

ALTER TABLE quickbooks_invoice_items
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end   DATE,
  ADD COLUMN IF NOT EXISTS fye_date     DATE;
