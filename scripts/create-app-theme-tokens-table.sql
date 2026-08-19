-- Appearance Settings: sparse override store for the app's color/font tokens.
-- Empty table = every token falls back to its default in lib/theme-tokens.ts,
-- i.e. today's exact look. Only rows a user has actually changed exist here.
CREATE TABLE IF NOT EXISTS app_theme_tokens (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  TEXT
);
