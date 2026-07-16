-- Durable QuickBooks webhook queue.
-- Safe to run more than once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.quickbooks_webhook_events (
  event_id text PRIMARY KEY,
  realm_id text NOT NULL,
  entity_name text NOT NULL,
  entity_id text NOT NULL,
  operation text NOT NULL,
  changed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  attempts smallint NOT NULL DEFAULT 0,
  last_error text,
  processing_started_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.quickbooks_webhook_events
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

CREATE INDEX IF NOT EXISTS quickbooks_webhook_events_pending_idx
  ON public.quickbooks_webhook_events (status, changed_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS quickbooks_webhook_events_realm_time_idx
  ON public.quickbooks_webhook_events (realm_id, changed_at DESC);

ALTER TABLE public.quickbooks_webhook_events ENABLE ROW LEVEL SECURITY;

-- Webhook ingestion and processing use the server-only Supabase secret key.
-- No browser policy is intentionally created for this operational queue.
