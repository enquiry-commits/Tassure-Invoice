-- 2026-09-08 — Vincent: "My Tasks 这个页面是好像AI聊天这样的界面，好像
-- Chatgpt/ Claude 这样的，可以New Chat, 记录Chats and tasks, 可以
-- Pin/ Pinned". Table names match the "Suggested Tables" list in his own
-- shared blueprint (AI_Native_Personal_Work_Assistant_Blueprint /
-- Claude_Code_Master_Brief) — ai_conversations / ai_messages — rather than
-- inventing different names for the same concept.
--
-- Deliberately NOT building the blueprint's other 8 suggested tables
-- (user_memories, entity_memories, user_patterns, task_priority_scores,
-- ai_recommendations, ai_feedback, ai_action_audit) in this same pass —
-- those belong to that document's own later phases (2-4, its own roadmap:
-- weeks/months out) and have no concrete consumer yet. user_events is
-- already covered by user_activity_events (scripts/add-user-activity-
-- events.sql, shipped the same day) — same concept, not duplicated here.
CREATE TABLE IF NOT EXISTS ai_conversations (
  id bigserial PRIMARY KEY,
  account_email text NOT NULL,
  title text NOT NULL DEFAULT 'New chat',
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_account
  ON ai_conversations (account_email, pinned DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON ai_messages (conversation_id, created_at ASC);
