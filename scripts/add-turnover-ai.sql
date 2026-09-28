-- 2026-09-28 — Vincent: "Account 之前是他们会需要读客户的单据去计算客户的流水，
-- 这些流水的形式都不同，单据形式也不同...需要AI AGENT先去读取一轮". Then, on
-- putting it behind its own top-level nav section: "我觉得OK", followed by 4
-- business-rule decisions answered via AskUserQuestion:
--   1. Access: Vincent-only for now (see lib/approved-accounts.ts's
--      canViewTurnoverAI, same pattern as canViewQuotation).
--   2. Client matching: BOTH — pick an existing `companies` row (see
--      client_company_id) OR type a client name freehand (client_name is
--      always required; client_company_id is only set when it resolves to a
--      real companies row).
--   3. Confidence threshold: the AI judges high/medium/low itself per
--      receipt (see lib/turnover-ai.ts's extraction tool schema) — nothing
--      stricter imposed here.
--   4. Duplicate detection: a basic same-client + same vendor + same date +
--      same amount reminder (is_duplicate_suspect/duplicate_of_id below),
--      not a hard block — a human still decides.
--
-- Two tables: one per uploaded FILE (turnover_documents — a single upload
-- may bundle several distinct receipts, e.g. a multi-page scan or several
-- photographed slips on one page) and one per individual RECEIPT the AI
-- pulled out of that file (turnover_line_items). Nothing here counts toward
-- a client's turnover total until a human sets review_status = 'confirmed'
-- (app/api/turnover-ai/summary/route.ts only sums 'confirmed' rows) — the
-- AI's own confidence judgement never auto-confirms anything by itself.
--
-- No RLS: read/written exclusively through createAdminClient() (service
-- role), matching every other feature table added this way (e.g.
-- ai_conversations, ai_quality_reviews) — see those files' own precedent.

CREATE TABLE IF NOT EXISTS turnover_documents (
  id bigserial PRIMARY KEY,
  client_company_id bigint REFERENCES companies(id),
  client_name text NOT NULL,
  period_label text,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  storage_path text,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'done', 'failed')),
  error_message text,
  uploaded_by text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_turnover_documents_client
  ON turnover_documents (client_name, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_turnover_documents_uploaded_at
  ON turnover_documents (uploaded_at DESC);

CREATE TABLE IF NOT EXISTS turnover_line_items (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES turnover_documents(id) ON DELETE CASCADE,
  vendor_name text,
  txn_date date,
  amount numeric(14, 2) NOT NULL DEFAULT 0,
  currency text,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  confidence_reason text,
  review_status text NOT NULL DEFAULT 'unconfirmed' CHECK (review_status IN ('unconfirmed', 'confirmed', 'rejected')),
  -- A human correction overrides the AI's own read without destroying it
  -- (vendor_name/txn_date/amount/currency above stay exactly what the AI
  -- said) — every reader that needs the "real" value takes
  -- edited_* ?? the AI's own column, never the AI column alone.
  edited_vendor_name text,
  edited_txn_date date,
  edited_amount numeric(14, 2),
  edited_currency text,
  is_duplicate_suspect boolean NOT NULL DEFAULT false,
  duplicate_of_id bigint REFERENCES turnover_line_items(id),
  raw_extraction jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_turnover_line_items_document
  ON turnover_line_items (document_id);
CREATE INDEX IF NOT EXISTS idx_turnover_line_items_review_status
  ON turnover_line_items (review_status);
