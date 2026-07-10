-- AR Reminder table — one row per company per FYE month/year
CREATE TABLE IF NOT EXISTS ar_reminder (
  id               BIGSERIAL PRIMARY KEY,
  entity_name      TEXT        NOT NULL,
  uen              TEXT        DEFAULT '',
  fye_month        TEXT        NOT NULL,
  fye_year         INTEGER     NOT NULL,
  fye_date         DATE,
  due_date         DATE,
  pic              TEXT        DEFAULT '',
  status           TEXT        DEFAULT 'Pending',
  event_id         TEXT,
  -- Teamwork edit form fields
  xbrl             TEXT,
  accounts_status  TEXT,
  fin_stmt_status  TEXT,
  audited_fs       TEXT,
  agm_documents    TEXT,
  dormant          TEXT,
  prepared_date    DATE,
  sent_date        DATE,
  received_date    DATE,
  date_of_agm      DATE,
  agm_held_date    DATE,
  filling_date     DATE,
  remarks          TEXT,
  scraped_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ar_reminder_entity_month_year_uniq UNIQUE (entity_name, fye_month, fye_year)
);

-- Enable RLS (optional — service role bypasses it anyway)
ALTER TABLE ar_reminder ENABLE ROW LEVEL SECURITY;
