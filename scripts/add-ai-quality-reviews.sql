-- 2026-09-22 — Vincent's own "AI Agent/My Tasks 少一些东西" review, item 6
-- ("质量抽查机制" — every real AI-assistant bug documented in
-- docs/INVARIANTS.md's INV-AI/INV-DATA-022/023 family was found by Vincent
-- personally screenshotting a wrong reply; nothing ever samples or reviews
-- replies on its own). This is the `ai_feedback` table scripts/add-ai-
-- conversations.sql's own header deliberately deferred back on 2026-09-08
-- ("belong to that document's own later phases... have no concrete consumer
-- yet") — named ai_quality_reviews instead of the blueprint's ai_feedback
-- since what this actually holds is a specific automated judge's verdict,
-- not generic user-submitted feedback (thumbs up/down, a different, still
-- unbuilt feature).
--
-- One row per (message_id) — a message is judged at most once; a human
-- reviewing a flagged row later fills in the human_* columns on the SAME
-- row rather than creating a second one, so "does a human agree with the
-- machine" stays attached to the exact verdict it is agreeing/disagreeing
-- with.
CREATE TABLE IF NOT EXISTS ai_quality_reviews (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  message_id bigint NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  conversation_id bigint NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  account_email text NOT NULL,
  user_question text NOT NULL,
  assistant_reply text NOT NULL,
  tools_used text[] NOT NULL DEFAULT '{}',
  verdict text NOT NULL CHECK (verdict IN ('pass', 'flag')),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  judge_model text NOT NULL,
  -- Filled in only when a human (always Vincent today — see the API route's
  -- own admin-only gate) actually looks at a flagged row. NULL means
  -- "nobody has reviewed the machine's verdict yet", not "confirmed fine".
  human_verdict text CHECK (human_verdict IN ('confirmed_issue', 'false_positive')),
  human_note text,
  human_reviewed_by text,
  human_reviewed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_quality_reviews_message
  ON ai_quality_reviews (message_id);
CREATE INDEX IF NOT EXISTS idx_ai_quality_reviews_verdict
  ON ai_quality_reviews (verdict, created_at DESC);
