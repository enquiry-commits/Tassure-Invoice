-- Monthly originals export (2026-10-08, Vincent/Chelsea). Once a month the system lists the invoices issued in the
-- month, one ZIP per book (TAB / TAC / TAO), built in the browser of whoever clicks Download; Chelsea files the
-- PDFs on the file server. This table only RECORDS that a book's ZIP was made (who/when/how many/how many without an
-- original) so My Tasks can stop reminding. No PDFs are stored. Run ONCE in the Supabase SQL editor. Idempotent.

CREATE TABLE IF NOT EXISTS originals_exports (
  id BIGSERIAL PRIMARY KEY,
  month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  qb_company TEXT NOT NULL CHECK (qb_company IN ('TAB', 'TAC', 'TAO')),
  invoice_count INTEGER NOT NULL DEFAULT 0,
  missing_count INTEGER NOT NULL DEFAULT 0,
  exported_by_email TEXT,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (month, qb_company)
);

ALTER TABLE originals_exports ENABLE ROW LEVEL SECURITY;
