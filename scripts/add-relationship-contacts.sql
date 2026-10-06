-- Client relationship fields (2026-10-06) — Cindy/Esther's request: record
-- WHO referred each company, WHO its RM (relationship manager) is, and
-- WHEN it became our client, so Esther can pull "everything new since
-- Jan 2026 and who introduced it" without a spreadsheet.
--
-- One shared people/party list (`relationship_contacts`) feeds BOTH the
-- referrer and RM pickers — the same person (e.g. an external partner who
-- refers clients AND acts as their RM) is one row, picked by id, so renames
-- and "everything for X" queries never drift across two free-text copies
-- (the exact failure master_list.referral had — see lib/customer-source.ts).
-- `kind`: 'internal' = Tassure staff (synced from lib/staff-directory.ts on
-- demand), 'external' = partners/introducers added by staff in Company 360.
-- Commission is deliberately NOT stored here (Esther computes it herself).
--
-- Run this ONCE in the Supabase SQL editor BEFORE deploying the code that
-- reads these columns. Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS relationship_contacts (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'external' CHECK (kind IN ('internal', 'external')),
  email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_email TEXT
);

-- name_key = lower(trim(name)) computed by the app — the uniqueness guard
-- so "samuell ng" and "Samuell Ng" can never become two rows.
CREATE UNIQUE INDEX IF NOT EXISTS relationship_contacts_name_key_uidx ON relationship_contacts (name_key);

ALTER TABLE companies ADD COLUMN IF NOT EXISTS client_since DATE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS referrer_contact_id BIGINT REFERENCES relationship_contacts(id) ON DELETE SET NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS rm_contact_id BIGINT REFERENCES relationship_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS companies_client_since_idx ON companies (client_since);
CREATE INDEX IF NOT EXISTS companies_rm_contact_id_idx ON companies (rm_contact_id);
CREATE INDEX IF NOT EXISTS companies_referrer_contact_id_idx ON companies (referrer_contact_id);
