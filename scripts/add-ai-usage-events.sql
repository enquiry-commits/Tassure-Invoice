-- AI usage ledger — 2026-10-05. Vincent: "因为我们有AI AGENT，并且全部员工
-- 都能用，因此为了准确的知道每个人使用了多少TOKENS，我要有一个明确的实时记录".
-- Then four decisions via AskUserQuestion: only Vincent sees the usage page;
-- under View As the usage counts for the person who actually pressed the
-- button ("算真正操作的人"); automatic calls caused by a person (the My Tasks
-- brief on opening the page) count under that person, shown apart
-- ("算本人，单独标「自动」"); cost shown in USD.
--
-- ONE row per paid Claude/OpenAI API call, written by the app the moment the
-- call's response arrives (lib/ai/usage.ts; docs/INVARIANTS.md INV-AI-010).
-- Append-only: the app never updates or deletes a row. No prompt or reply
-- text is ever stored — only who, what, which model and the token counts.
--
-- Safe to run more than once. Server-only like ai_agent_runs: RLS enabled
-- with no browser policies; only the Next.js service-role APIs read/write.
-- No CHECK constraints on feature/trigger on purpose: a new feature value
-- added in code must never make the insert fail and silently lose usage
-- (the app's TypeScript types are what keep the values valid).

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The real signed-in person whose action caused the call. NULL = a
  -- scheduled job (trigger 'cron') or a caller the app couldn't identify.
  actor_email text,
  -- The account being viewed under View As, when it differs from the actor.
  subject_email text,
  -- assistant | ai_learning | turnover_ai | my_tasks_brief |
  -- reports_narrative | ai_quality_review | sg_news
  feature text NOT NULL,
  -- chat | auto | upload | manual | cron
  trigger text NOT NULL,
  -- Which call within the feature: router, round_1..4, synthesis, ...
  step text,
  -- Groups every call made for one chat question.
  turn_key text,
  provider text NOT NULL,          -- anthropic | openai
  model text,                      -- as the provider's response reports it
  request_id text,                 -- the provider's own id for the call
  -- Four non-overlapping token buckets, the same for both providers:
  -- input NOT served from the cache, cache writes, cache reads, and output
  -- (reasoning included; reasoning_tokens is the share of it).
  input_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  reasoning_tokens integer NOT NULL DEFAULT 0,
  web_search_requests integer NOT NULL DEFAULT 0,
  -- Estimated USD at the published price when the call was recorded
  -- (lib/ai/pricing.ts); NULL when the model's price isn't in that table.
  cost_usd numeric(12, 6),
  price_version text,
  -- The provider's own usage block, unchanged.
  raw_usage jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_time
  ON ai_usage_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_actor_time
  ON ai_usage_events (actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_turn
  ON ai_usage_events (turn_key) WHERE turn_key IS NOT NULL;

ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
