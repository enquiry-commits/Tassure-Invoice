-- Quotation "Completed" + Remarks (2026-10-07, Vincent). The Quotation page reads
-- every QuickBooks Estimate live and re-matches invoices on each load, so a
-- Closed PI kept matching further invoices forever. Each week the person in
-- charge checks a PI is Closed and traced to the right invoice(s) and presses
-- "Completed": from then on the PI leaves the main list, its invoices are
-- FROZEN as they were at that moment (`completed_trace`, never re-matched),
-- and it is only shown under the "Completed" card. Remarks can be written at
-- any time, completed or not. A completed PI's record (remarks and snapshot
-- too) is deleted automatically one year after it was completed.
-- Run this ONCE in the Supabase SQL editor. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS quotation_reviews (
  id BIGSERIAL PRIMARY KEY,
  qb_company TEXT NOT NULL CHECK (qb_company IN ('TAB', 'TAC', 'TAO')),
  qb_estimate_id TEXT NOT NULL,
  doc_number TEXT,
  txn_date DATE,
  remarks TEXT,
  remarks_updated_at TIMESTAMPTZ,
  remarks_updated_by_email TEXT,
  completed_at TIMESTAMPTZ,
  completed_by_email TEXT,
  completed_trace JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (qb_company, qb_estimate_id)
);

-- the daily clean-up reads "completed more than a year ago"
CREATE INDEX IF NOT EXISTS quotation_reviews_completed_at_idx ON quotation_reviews (completed_at);

-- same posture as the other app tables: only the service-role API routes read/write it
ALTER TABLE quotation_reviews ENABLE ROW LEVEL SECURITY;
