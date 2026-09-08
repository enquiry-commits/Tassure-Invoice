-- 2026-09-08 — Vincent: "现在每个用户进入系统后的点击操作路径...为什么这个
-- 用户每天会打开这个页面，为什么会时常在这个页面操作，为什么每次关注某些
-- 特定的更新" — real behavioral tracking, which this app has never recorded
-- (every existing table logs business state or single-action audit trails
-- like created_by_email, never "who visited what page when"). This table
-- starts empty and only accumulates from the moment it's deployed — there
-- is no historical click data to backfill.
--
-- Written by GET-free, fire-and-forget POST /api/activity/log:
--   - a page_view row on every route change (components/AppShell.tsx)
--   - a handful of named key actions (generate_invoice, ar_delete,
--     late_filing_resolve, create_outlook_drafts — see lib/activity-client.ts's
--     own call sites) — more can be added incrementally over time, each one
--     just a 1-line logActivity() call once this table exists.
CREATE TABLE IF NOT EXISTS user_activity_events (
  id bigserial PRIMARY KEY,
  account_email text NOT NULL,
  pathname text NOT NULL,
  event_type text NOT NULL, -- 'page_view' or a specific action name
  detail jsonb,             -- action-specific extra context (e.g. company name); null for page_view
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Per-person time-range queries ("what has this person been doing lately")
CREATE INDEX IF NOT EXISTS idx_user_activity_events_account_time
  ON user_activity_events (account_email, created_at DESC);

-- Company-wide / aggregate queries ("how often does anyone do X")
CREATE INDEX IF NOT EXISTS idx_user_activity_events_type_time
  ON user_activity_events (event_type, created_at DESC);
