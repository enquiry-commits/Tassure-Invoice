-- 2026-09-08 — controlled AI learning foundation.
--
-- This does NOT let an AI silently define a person or change business data.
-- It stores only deterministic, evidence-backed observations from
-- user_activity_events. A candidate remains inert until Vincent, the explicit
-- system admin, approves it. Approval promotes exactly
-- one inferred memory into the existing assistant context; business records
-- are never changed by this migration.

DO $$
BEGIN
  IF to_regclass('public.user_memories') IS NULL THEN
    RAISE EXCEPTION 'user_memories is required; run scripts/add-user-memories.sql first';
  END IF;
END;
$$;

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
  promoted_memory_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_email, pattern_kind, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_learning_candidates_account_status
  ON ai_learning_candidates (account_email, status, updated_at DESC);

-- CREATE TABLE IF NOT EXISTS does not add newly introduced columns when an
-- earlier revision of this migration has already been run.
ALTER TABLE ai_learning_candidates
  ADD COLUMN IF NOT EXISTS promoted_memory_id bigint;

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

-- Link an approved candidate to exactly one inferred user memory. Existing
-- explicit memories remain untouched, and the link makes approval idempotent:
-- approving the same candidate again updates its one memory, never duplicates
-- it. The cyclic references are added after both tables exist.
ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS source_candidate_id bigint;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memories_source_candidate
  ON user_memories (source_candidate_id) WHERE source_candidate_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_candidate_promoted_memory') THEN
    ALTER TABLE ai_learning_candidates
      ADD CONSTRAINT fk_ai_candidate_promoted_memory
      FOREIGN KEY (promoted_memory_id) REFERENCES user_memories(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_memory_source_candidate') THEN
    ALTER TABLE user_memories
      ADD CONSTRAINT fk_user_memory_source_candidate
      FOREIGN KEY (source_candidate_id) REFERENCES ai_learning_candidates(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- Upgrade/backfill path for a database that ran the earlier shadow-only
-- revision and already contains approved review metadata.
INSERT INTO user_memories (
  account_email, memory_type, content, confidence, source_count,
  source, last_seen, source_candidate_id
)
SELECT
  account_email,
  proposed_memory_type,
  COALESCE(NULLIF(BTRIM(approved_content), ''), proposed_content),
  confidence,
  source_count,
  'inferred',
  last_seen,
  id
FROM ai_learning_candidates
WHERE status = 'approved'
ON CONFLICT (source_candidate_id) WHERE source_candidate_id IS NOT NULL
DO UPDATE SET
  content = EXCLUDED.content,
  confidence = EXCLUDED.confidence,
  source_count = EXCLUDED.source_count,
  last_seen = EXCLUDED.last_seen;

UPDATE ai_learning_candidates AS candidate
SET promoted_memory_id = memory.id
FROM user_memories AS memory
WHERE memory.source_candidate_id = candidate.id
  AND memory.source = 'inferred'
  AND candidate.promoted_memory_id IS DISTINCT FROM memory.id;

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
  memory_id bigint;
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

  IF p_decision = 'approve' THEN
    INSERT INTO user_memories (
      account_email, memory_type, content, confidence, source_count,
      source, last_seen, source_candidate_id
    ) VALUES (
      before_row.account_email, before_row.proposed_memory_type, chosen_content,
      before_row.confidence, before_row.source_count, 'inferred',
      before_row.last_seen, before_row.id
    )
    ON CONFLICT (source_candidate_id) WHERE source_candidate_id IS NOT NULL
    DO UPDATE SET
      content = EXCLUDED.content,
      confidence = EXCLUDED.confidence,
      source_count = EXCLUDED.source_count,
      last_seen = EXCLUDED.last_seen
    RETURNING id INTO memory_id;
  ELSE
    -- Only the inferred memory linked to this candidate can be removed here.
    -- Explicit user-authored memories have source_candidate_id NULL and cannot
    -- be touched by a candidate review transition.
    DELETE FROM user_memories
    WHERE source_candidate_id = before_row.id AND source = 'inferred';
    memory_id := NULL;
  END IF;

  UPDATE ai_learning_candidates SET
    status = next_status,
    approved_content = CASE WHEN p_decision = 'approve' THEN chosen_content ELSE NULL END,
    reviewed_by = p_actor_email,
    reviewed_at = now(),
    review_note = LEFT(NULLIF(BTRIM(p_note), ''), 1000),
    promoted_memory_id = memory_id,
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

-- A fresh analysis can increase an already-approved candidate's confidence
-- and evidence count. Keep only those evidence fields in sync; never rewrite
-- the human-approved content without another explicit review action.
CREATE OR REPLACE FUNCTION sync_approved_ai_learning_memory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND NEW.promoted_memory_id IS NOT NULL THEN
    UPDATE user_memories SET
      confidence = NEW.confidence,
      source_count = NEW.source_count,
      last_seen = NEW.last_seen
    WHERE id = NEW.promoted_memory_id
      AND source_candidate_id = NEW.id
      AND source = 'inferred';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_approved_ai_learning_memory ON ai_learning_candidates;
CREATE TRIGGER trg_sync_approved_ai_learning_memory
AFTER UPDATE OF confidence, source_count, last_seen, status, promoted_memory_id
ON ai_learning_candidates
FOR EACH ROW EXECUTE FUNCTION sync_approved_ai_learning_memory();

REVOKE ALL ON FUNCTION sync_approved_ai_learning_memory() FROM PUBLIC, anon, authenticated;
