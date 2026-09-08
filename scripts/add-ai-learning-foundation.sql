-- 2026-09-08 — AI learning foundation, phase 1 (shadow mode).
--
-- This does NOT let an AI silently define a person or change business data.
-- It stores only deterministic, evidence-backed observations from
-- user_activity_events. A candidate remains inert until the owning user (or
-- Vincent as system admin) explicitly reviews it. Assistant prompt wiring is
-- deliberately deferred so this migration can ship without changing the
-- assistant route Claude Code is actively evolving in parallel.

CREATE TABLE IF NOT EXISTS ai_learning_candidates (
  id bigserial PRIMARY KEY,
  account_email text NOT NULL,
  pattern_kind text NOT NULL CHECK (pattern_kind IN ('frequent_page','frequent_action')),
  pattern_key text NOT NULL,
  proposed_memory_type text NOT NULL CHECK (proposed_memory_type IN ('behaviour','pattern')),
  proposed_content text NOT NULL,
  status text NOT NULL DEFAULT 'observing'
    CHECK (status IN ('observing','ready_for_review','approved','rejected','dismissed')),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source_count integer NOT NULL CHECK (source_count >= 1),
  distinct_days integer NOT NULL CHECK (distinct_days >= 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  approved_content text,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_email, pattern_kind, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_learning_candidates_account_status
  ON ai_learning_candidates (account_email, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_learning_feedback (
  id bigserial PRIMARY KEY,
  candidate_id bigint NOT NULL REFERENCES ai_learning_candidates(id) ON DELETE CASCADE,
  actor_email text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve','reject','dismiss','reopen')),
  previous_status text NOT NULL,
  next_status text NOT NULL,
  previous_content text,
  final_content text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_learning_feedback_candidate_time
  ON ai_learning_feedback (candidate_id, created_at DESC);

-- These tables are server-only. No browser/client policy is intentionally
-- granted: the authenticated Next.js API performs ownership and management
-- checks, while the service-role client is the only database writer/reader.
ALTER TABLE ai_learning_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_learning_feedback ENABLE ROW LEVEL SECURITY;

-- Atomic review: the candidate transition and its evidence trail either both
-- commit or both roll back. The API performs the user/admin authorization;
-- only the service role may execute this database function.
CREATE OR REPLACE FUNCTION review_ai_learning_candidate(
  p_candidate_id bigint,
  p_actor_email text,
  p_decision text,
  p_final_content text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS SETOF ai_learning_candidates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  before_row ai_learning_candidates%ROWTYPE;
  after_row ai_learning_candidates%ROWTYPE;
  next_status text;
  chosen_content text;
BEGIN
  IF p_decision NOT IN ('approve','reject','dismiss','reopen') THEN
    RAISE EXCEPTION 'Invalid learning review decision';
  END IF;

  SELECT * INTO before_row
  FROM ai_learning_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Learning candidate not found'; END IF;

  next_status := CASE p_decision
    WHEN 'approve' THEN 'approved'
    WHEN 'reject' THEN 'rejected'
    WHEN 'dismiss' THEN 'dismissed'
    ELSE CASE WHEN before_row.confidence >= 0.75 AND before_row.distinct_days >= 3
      THEN 'ready_for_review' ELSE 'observing' END
  END;
  chosen_content := LEFT(COALESCE(NULLIF(BTRIM(p_final_content), ''), before_row.proposed_content), 1000);

  UPDATE ai_learning_candidates SET
    status = next_status,
    approved_content = CASE WHEN p_decision = 'approve' THEN chosen_content ELSE NULL END,
    reviewed_by = p_actor_email,
    reviewed_at = now(),
    review_note = LEFT(NULLIF(BTRIM(p_note), ''), 1000),
    updated_at = now()
  WHERE id = p_candidate_id
  RETURNING * INTO after_row;

  INSERT INTO ai_learning_feedback (
    candidate_id, actor_email, decision, previous_status, next_status,
    previous_content, final_content, note
  ) VALUES (
    before_row.id, p_actor_email, p_decision, before_row.status, next_status,
    COALESCE(before_row.approved_content, before_row.proposed_content),
    CASE WHEN p_decision = 'approve' THEN chosen_content ELSE NULL END,
    LEFT(NULLIF(BTRIM(p_note), ''), 1000)
  );

  RETURN NEXT after_row;
END;
$$;

REVOKE ALL ON FUNCTION review_ai_learning_candidate(bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION review_ai_learning_candidate(bigint, text, text, text, text) TO service_role;
