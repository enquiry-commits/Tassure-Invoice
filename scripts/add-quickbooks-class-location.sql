-- Captures QuickBooks' own Class (per invoice line) and Location (per
-- invoice) fields, so the app can compute a real, no-manual-backfill
-- collections owner instead of relying on Vincent's Google Sheet.
--
-- Chelsea, 2026-09-07 (relayed by Vincent): "PIC不是说谁开单的 location那边，
-- 一般是服务的 class 那边的备注人员，如果class 没有才是看location的" — Class
-- (set per line, e.g. via lib/qb-invoice-conventions.ts's findPicClass/
-- ClassRef, already used when THIS app generates a TAB Secretary/XBRL line)
-- is the real "who owns this service" signal; Location (DepartmentRef, set
-- once per whole invoice — see lib/approved-accounts.ts's qbLocations, which
-- staff use as a per-person tag inside a shared QB login) is only a
-- fallback for invoices that never got a Class. Both fields already exist on
-- every real QuickBooks invoice; this app's own sync just never stored them.
--
-- Safe to run more than once in the Supabase SQL Editor.

ALTER TABLE public.quickbooks_invoices
  ADD COLUMN IF NOT EXISTS location_name text;

ALTER TABLE public.quickbooks_invoice_items
  ADD COLUMN IF NOT EXISTS class_name text;

-- Backfill is automatic, not a one-off script: app/api/quickbooks/sync/
-- route.ts already re-fetches the full Invoice object (SELECT *) for the
-- current year + previous 2 years on every run, so the very next sync
-- (manual or the daily cron) populates both new columns for free — no
-- extra QuickBooks API calls, no separate backfill job needed here.
