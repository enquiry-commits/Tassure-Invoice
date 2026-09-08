-- 2026-09-08 — from Vincent's shared blueprint (AI_Native_Personal_Work_
-- Assistant_Blueprint_CN.docx / Claude_Code_Master_Brief_AI_Work_
-- Assistant.md), section 5 "Memory System" + section 20's own explicit
-- advice: "同步建立 Memory Schema 和 Context Orchestrator，避免未来重构"
-- (build the memory schema in parallel now, to avoid future rework) —
-- even though the full learning/pattern-mining engine (the blueprint's
-- own Phase 3, weeks 5-8) is NOT being built today.
--
-- v1 write path is deliberately narrow and explicit: a `remember_this`
-- assistant tool only fires when the user directly asks the AI to
-- remember/note something — never auto-mined from user_activity_events.
-- The blueprint itself warns against exactly that shortcut: "AI 不应因为
-- 一次对话就永久定义用户"; "用户的一次情绪性表达不应被直接写成永久性格
-- 或偏好". Schema still matches the blueprint's own suggested fields
-- (type, content, confidence, source_count, last_seen) so automatic
-- pattern-mining can slot in later without a schema rewrite.
CREATE TABLE IF NOT EXISTS user_memories (
  id bigserial PRIMARY KEY,
  account_email text NOT NULL,
  memory_type text NOT NULL CHECK (memory_type IN ('fact','preference','behaviour','relationship','project','decision','rejection','pattern')),
  content text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0.6 CHECK (confidence >= 0 AND confidence <= 1),
  source_count integer NOT NULL DEFAULT 1,
  -- Who/what caused this row — 'explicit' (user directly said "remember
  -- this", v1's only write path) vs. 'inferred' (reserved for a future
  -- automatic pattern-mining pass over user_activity_events — not written
  -- by anything today, but the column exists now so that later work is an
  -- addition, not a migration).
  source text NOT NULL DEFAULT 'explicit' CHECK (source IN ('explicit','inferred')),
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_memories_account
  ON user_memories (account_email, last_seen DESC);
