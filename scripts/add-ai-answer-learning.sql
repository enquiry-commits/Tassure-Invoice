-- 2026-10-05 — Unit 2 of the AI answer-quality learning loop
-- (docs/INVARIANTS.md INV-AI-012; docs/CURRENT_STATE.md). Designed by the full
-- council of 2026-10-05; Vincent's choices: behaviour rules apply
-- automatically only after a replay exam ("行为类自动 + 考试"), reply
-- evidence kept 30 days ("存 30 天"), a weekly council ("每周一次").
--
-- Safe to run before or after the code that uses it is deployed: every
-- reader/writer of these tables (lib/ai/answer-learning-store.ts,
-- lib/ai-quality/review.ts) treats a missing table as "nothing to do".
-- Every table here is read and written ONLY through createAdminClient()
-- (service role), so RLS is on with no policy (INV-DATA-073).

-- 1. What each assistant reply was built from. claudeAnswer() already held
-- every tool's input and result in memory and threw them away, so a reviewer
-- could see only the reply text (INV-AI-006). One row per assistant run,
-- written after the reply is sent and in its own table — never as a column on
-- the ai_agent_runs insert, because recordAgentRun() returns null on ANY
-- insert error and the reply would lose its agent_run_id. Purged after 30
-- days by the nightly /api/ai-quality/review run.
CREATE TABLE IF NOT EXISTS ai_turn_evidence (
  agent_run_id bigint PRIMARY KEY REFERENCES ai_agent_runs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  account_email text NOT NULL,
  tool_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- which learned guidance rules were in that answer's prompt
  guidance_ids bigint[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ai_turn_evidence_created ON ai_turn_evidence (created_at);
ALTER TABLE ai_turn_evidence ENABLE ROW LEVEL SECURITY;

-- 2. Global answering guidance learned from reviewing replies — EMPTY until
-- a rule passes the learning loop's exam, so answers don't change until then.
-- Only HOW to answer can be stored: the CHECK allows exactly the four
-- behaviour categories, so a pricing/status/client-matching/reminder rule
-- (CLAUDE.md non-negotiables) cannot even be written here. A rule is never
-- edited in place (a change is a new row), expires after 30 days, and is
-- retired one by one.
CREATE TABLE IF NOT EXISTS ai_answer_guidance (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  rule_text text NOT NULL CHECK (char_length(rule_text) BETWEEN 1 AND 280),
  category text NOT NULL CHECK (category IN ('tool_routing', 'ask_first', 'caveat', 'format_language')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  source_review_ids bigint[] NOT NULL DEFAULT '{}',
  created_by text NOT NULL,
  retired_at timestamptz,
  retired_by text,
  exam jsonb
);
CREATE INDEX IF NOT EXISTS idx_ai_answer_guidance_active ON ai_answer_guidance (status, expires_at);
ALTER TABLE ai_answer_guidance ENABLE ROW LEVEL SECURITY;

-- 3. The master switch: one row. Off = no guidance in any prompt, within a
-- minute, no deploy needed. If this row can't be read, the code treats the
-- switch as OFF.
CREATE TABLE IF NOT EXISTS ai_guidance_switch (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
INSERT INTO ai_guidance_switch (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE ai_guidance_switch ENABLE ROW LEVEL SECURITY;

-- 4. The quality judge's retry cap: a reply whose judge call keeps failing is
-- left alone after 3 attempts instead of being paid for on every run.
CREATE TABLE IF NOT EXISTS ai_quality_judge_attempts (
  message_id bigint PRIMARY KEY REFERENCES ai_messages(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  last_attempt_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_quality_judge_attempts ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Self-check for whoever runs this in the SQL editor: four rows, every
-- relrowsecurity = true.
SELECT relname, relrowsecurity
FROM pg_class
WHERE oid IN ('public.ai_turn_evidence'::regclass, 'public.ai_answer_guidance'::regclass,
              'public.ai_guidance_switch'::regclass, 'public.ai_quality_judge_attempts'::regclass)
ORDER BY relname;
