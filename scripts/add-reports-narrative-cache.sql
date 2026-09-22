-- AI-generated Reports narrative cache (lib/reports-narrative.ts).
-- One row per generation, newest-wins — reads always take the latest row,
-- writes always insert a new one rather than update-in-place, so this
-- doubles as a free history of past write-ups (useful later if the monthly-
-- report idea Vincent mentioned goes ahead) at no extra design cost now.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS reports_narrative_cache (
  id bigserial PRIMARY KEY,
  narrative text NOT NULL,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_narrative_cache_generated_at
  ON reports_narrative_cache (generated_at DESC);

-- Server-only table, same convention as every other *_cache/*_runs table in
-- this app (e.g. ai_agent_runs) — RLS on, no browser policies; only the
-- Next.js service-role API route reads/writes it.
ALTER TABLE reports_narrative_cache ENABLE ROW LEVEL SECURITY;
