-- "SG Latest News" — daily monitoring of ACRA/IRAS/MOM/ICA/ISCA/CSIS
-- (policy) and Straits Times/Business Times/Zaobao (news), per Vincent's
-- spec 2026-09-23. Vincent-only page while in development (lib/approved-
-- accounts.ts's new canViewSgNews flag) — this table set has no browser
-- RLS policies for the same reason every other automation table in this
-- app has none: only the service-role API routes read/write it.
-- Safe to run more than once.

-- Every real item ever seen, across every daily run — the durable "have we
-- shown this one before" record a daily digest is diffed against. Kept
-- indefinitely (not pruned) since the table is small (a handful of items
-- per source per day) and the history itself has value (a searchable
-- archive of "when did ACRA first announce X").
CREATE TABLE IF NOT EXISTS sg_news_items (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  category text NOT NULL CHECK (category IN ('policy', 'news')),
  title text NOT NULL,
  url text,
  -- Raw date/label exactly as shown on the source site ("21 September
  -- 2026", "53 mins ago", ...) — deliberately NOT normalized to a real
  -- date column: the 9 sources use mutually incompatible formats (see
  -- lib/sg-news-sources.ts) and a wrong guessed parse would be worse than
  -- an honest opaque string.
  published_label text,
  teaser text,
  -- normalize(source + '|' + title) — the de-dup key. Title-based, not
  -- URL-based: several of these sites revise a URL's query string/slug on
  -- re-publish without the story being new, which would otherwise create a
  -- false "new item" every run.
  item_hash text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, item_hash)
);
CREATE INDEX IF NOT EXISTS idx_sg_news_items_first_seen ON sg_news_items (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sg_news_items_source ON sg_news_items (source, first_seen_at DESC);
ALTER TABLE sg_news_items ENABLE ROW LEVEL SECURITY;

-- One row per calendar day (SGT) — the actual AI-written report the page
-- shows. `report` is the full structured ReportsNarrative-style JSON (see
-- lib/sg-news-digest.ts), not prose, for the same "guaranteed visual
-- hierarchy" reason app/reports/page.tsx's own AI card was rebuilt for
-- 2026-09-22 (docs/PROJECT_STATUS.md, same day).
CREATE TABLE IF NOT EXISTS sg_news_daily_reports (
  id bigserial PRIMARY KEY,
  report_date date NOT NULL UNIQUE,
  report jsonb NOT NULL,
  new_items_count integer NOT NULL DEFAULT 0,
  sources_checked jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources_failed jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sg_news_daily_reports_date ON sg_news_daily_reports (report_date DESC);
ALTER TABLE sg_news_daily_reports ENABLE ROW LEVEL SECURITY;

-- Per-source last-check status, same "one row per entity" convention as
-- quickbooks_ar_aging_sync_state (scripts/add-quickbooks-ar-aging-detail.sql)
-- — this job has 9 independent sources to track, not one, so this table
-- exists ALONGSIDE (not instead of) the generic automation_sync_runs
-- history withAutomationRun() already writes for the job as a whole.
CREATE TABLE IF NOT EXISTS sg_news_sync_state (
  source text PRIMARY KEY,
  last_status text NOT NULL CHECK (last_status IN ('success', 'error')),
  last_synced_at timestamptz,
  last_item_count integer,
  last_error text
);
ALTER TABLE sg_news_sync_state ENABLE ROW LEVEL SECURITY;
