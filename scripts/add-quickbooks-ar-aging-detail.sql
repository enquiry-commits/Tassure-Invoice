-- QuickBooks Aged Receivable Detail report snapshot.
--
-- Root cause this fixes: even after netting CreditMemo (scripts/add-
-- quickbooks-credit-memos.sql, 2026-09-15), computeSoaRows() still only
-- ever summed 2 QuickBooks entity types (Invoice, CreditMemo). Live
-- verification against QuickBooks' own AgedReceivableDetail report
-- (/v3/company/{realmId}/reports/AgedReceivableDetail) found a real,
-- confirmed ~$90K remaining gap driven by entity types this app had never
-- synced -- Journal Entry and Payment (all 3 books), and Deposit (TAB) --
-- plus unconverted multi-currency balances the report already SGD-converts
-- for us. See docs/INVARIANTS.md INV-QB-017 for the full incident (a
-- Journal Entry dated 2023-12-31, "Opening journal" -- an opening-balance
-- entry from when this QuickBooks file was first set up, entirely outside
-- this app's 3-year sync window -- explained a single $38,171.37 customer
-- discrepancy that had zero Invoice/CreditMemo/Payment records of any kind).
--
-- This table is a REPLACED SNAPSHOT, not a reconciled entity mirror --
-- unlike quickbooks_invoices/quickbooks_credit_memos (each row keyed by an
-- immutable QuickBooks Id, upserted and reconciled), a report row has no
-- stable identity across two different days' runs. Every sync run INSERTS
-- an entirely new set of rows tagged with that run's sync_run_id, THEN
-- deletes the previous run's rows for that qb_company -- insert-new-then-
-- delete-old, never delete-then-insert, so a concurrent read never sees a
-- company with zero rows mid-sync. See syncAgedReceivableDetail()
-- (app/api/quickbooks/sync/route.ts).
--
-- No CHECK constraint on qb_company/aging_bucket, matching
-- quickbooks_invoices/quickbooks_credit_memos' own existing precedent --
-- validity enforced app-side via TypeScript unions (QbCompany, AgingBucket).
--
-- Safe to run more than once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.quickbooks_ar_aging_detail (
  id bigserial PRIMARY KEY,
  qb_company text NOT NULL,
  report_date date NOT NULL,
  -- One of lib/soa.ts's own AgingBucket keys ('current'/'d1_30'/'d31_60'/
  -- 'd61_90'/'d91_plus') -- mapped ONCE at sync time from the report's own
  -- Section header, so every reader shares one translation instead of
  -- re-deriving it from wording.
  aging_bucket text NOT NULL,
  -- Raw QuickBooks "Transaction Type" column value, captured verbatim
  -- (e.g. 'Invoice', 'Credit Note', 'Payment', 'Journal Entry', 'Deposit')
  -- -- deliberately NOT constrained to a known list. The whole point of
  -- reading this report instead of syncing entities one at a time is that
  -- QuickBooks enumerates every type that affects AR for us; a 6th type
  -- this business's data has never produced yet must still land here as a
  -- normal row, not be silently dropped by an allowlist.
  txn_type text NOT NULL,
  -- The Transaction Type column's own `id` attribute -- QuickBooks' internal
  -- Id for the underlying transaction (confirmed live for Invoice rows,
  -- e.g. {"value":"Invoice","id":"1394"} -- same shape as qb_invoice_id).
  -- Not guaranteed present for every txn_type; nullable.
  qb_txn_id text,
  doc_number text,
  qb_customer_id text,
  -- Corrected via correctedCustomerName() at sync time, same as
  -- quickbooks_invoices/quickbooks_credit_memos (INV-QB-012) -- never the
  -- report's raw Customer column value directly.
  customer_name text NOT NULL,
  txn_date date,
  due_date date,
  amount numeric,
  -- The netting number. SUM(open_balance) per customer is that customer's
  -- real outstanding balance -- QuickBooks' own report already signs this
  -- correctly per txn_type (Invoice positive; Credit Note/Payment/Journal
  -- Entry that reduces AR already negative). Sum as-is; never re-derive a
  -- sign from txn_type.
  open_balance numeric NOT NULL,
  location_name text,
  sync_run_id uuid NOT NULL,
  scraped_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quickbooks_ar_aging_detail_customer_idx
  ON public.quickbooks_ar_aging_detail (qb_company, customer_name);

-- Backs the insert-new-then-delete-old reconcile step.
CREATE INDEX IF NOT EXISTS quickbooks_ar_aging_detail_sync_run_idx
  ON public.quickbooks_ar_aging_detail (qb_company, sync_run_id);

ALTER TABLE public.quickbooks_ar_aging_detail ENABLE ROW LEVEL SECURITY;

-- One row per qb_company -- tracks whether the LATEST
-- syncAgedReceivableDetail() run actually succeeded, so computeSoaRows()
-- can tell "genuinely zero outstanding" (a real, common state for a
-- paid-up client -- row count alone can't distinguish this from "never
-- synced") apart from "never synced / last attempt failed", and fall back
-- to the pre-report Invoice+CreditMemo computation (legacyComputeSoaRows())
-- rather than silently showing $0 for an entire book. See
-- docs/INVARIANTS.md INV-QB-017.
CREATE TABLE IF NOT EXISTS public.quickbooks_ar_aging_sync_state (
  qb_company text PRIMARY KEY,
  last_status text NOT NULL, -- 'success' | 'error'
  last_synced_at timestamptz NOT NULL,
  last_row_count integer,
  last_error text,
  -- |parsed row sum - report's own printed Grand Total| from the same run --
  -- large means a parsing bug or truncation, caught immediately rather than
  -- silently trusted. See syncAgedReceivableDetail()'s own self-check.
  last_grand_total_check numeric
);

ALTER TABLE public.quickbooks_ar_aging_sync_state ENABLE ROW LEVEL SECURITY;

-- Same as quickbooks_invoices/quickbooks_credit_memos: sync and reads use
-- the server-only Supabase secret key. No browser policy intentionally
-- created here.
