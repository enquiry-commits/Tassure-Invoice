-- Generic audit trail — starts with Master List field edits, but shared
-- across tables (table_name/row_id) so Companies/QuickBooks-related edits
-- can log to the same table later without a new schema each time.
-- Run this in Supabase SQL Editor ("Run without RLS" if prompted).

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  table_name  TEXT NOT NULL,
  row_id      INTEGER NOT NULL,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  changed_by  TEXT NOT NULL,   -- staff email, derived server-side from the session — never client-supplied
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_row ON audit_log (table_name, row_id, changed_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON audit_log
  FOR ALL USING (true) WITH CHECK (true);
