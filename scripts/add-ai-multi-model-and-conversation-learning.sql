-- Multi-model agent telemetry + conversation-derived learning.
-- Safe to run more than once. Server-only tables intentionally have RLS
-- enabled with no browser policies; Next.js service-role APIs are the only
-- readers/writers.

DO $$
BEGIN
  IF to_regclass('public.ai_learning_candidates') IS NULL THEN
    RAISE EXCEPTION 'ai_learning_candidates is required; run scripts/add-ai-learning-foundation.sql first';
  END IF;
  IF to_regclass('public.ai_messages') IS NULL THEN
    RAISE EXCEPTION 'ai_messages is required; run scripts/add-ai-conversations.sql first';
  END IF;
END;
$$;

-- The original activity-only checks did not allow conversation signals.
ALTER TABLE ai_learning_candidates
  DROP CONSTRAINT IF EXISTS ai_learning_candidates_pattern_kind_check;
ALTER TABLE ai_learning_candidates
  ADD CONSTRAINT ai_learning_candidates_pattern_kind_check CHECK (
    pattern_kind IN (
      'frequent_page', 'frequent_action',
      'conversation_preference', 'conversation_workflow',
      'conversation_correction', 'conversation_decision'
    )
  );

ALTER TABLE ai_learning_candidates
  DROP CONSTRAINT IF EXISTS ai_learning_candidates_proposed_memory_type_check;
ALTER TABLE ai_learning_candidates
  ADD CONSTRAINT ai_learning_candidates_proposed_memory_type_check CHECK (
    proposed_memory_type IN ('preference', 'behaviour', 'decision', 'rejection', 'pattern')
  );

CREATE TABLE IF NOT EXISTS ai_agent_runs (
  id bigserial PRIMARY KEY,
  account_email text NOT NULL,
  conversation_id bigint REFERENCES ai_conversations(id) ON DELETE SET NULL,
  route text NOT NULL CHECK (route IN ('claude_only','claude_then_openai','openai_only','intent_fallback')),
  primary_provider text NOT NULL,
  primary_model text,
  secondary_provider text,
  secondary_model text,
  tool_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('completed','fallback','failed')),
  latency_ms integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_account_time
  ON ai_agent_runs (account_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_conversation
  ON ai_agent_runs (conversation_id, created_at DESC);
ALTER TABLE ai_agent_runs ENABLE ROW LEVEL SECURITY;

-- Optional message provenance. The application falls back to the old insert
-- shape until this migration is run, so deploy order is safe.
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS agent_route text;
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS agent_run_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_messages_agent_run') THEN
    ALTER TABLE ai_messages
      ADD CONSTRAINT fk_ai_messages_agent_run
      FOREIGN KEY (agent_run_id) REFERENCES ai_agent_runs(id) ON DELETE SET NULL;
  END IF;
END;
$$;

