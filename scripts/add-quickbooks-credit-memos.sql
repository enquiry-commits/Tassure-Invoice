-- QuickBooks CreditMemo (Credit Note) sync table.
--
-- Root cause this fixes: the daily QuickBooks sync (app/api/quickbooks/sync/
-- route.ts) has only ever pulled `Invoice` objects, never `CreditMemo`. A
-- CreditMemo left "Unapplied" in QuickBooks does NOT reduce the linked
-- Invoice's own Balance field (applying is a separate manual step), but
-- QuickBooks' own official Aged Receivables report DOES net an unapplied
-- CreditMemo's balance into that customer's total. Because this app only
-- mirrored Invoice.Balance, its own "outstanding balance" numbers drifted
-- from QuickBooks' own truth -- confirmed 2026-09-15 via QuickBooks' own
-- report API (/v3/company/{realmId}/reports/AgedReceivables) against a real
-- Excel export Vincent pulled directly from QuickBooks: this system was
-- overstating total receivables by $185,722.57 (~42%) across TAB/TAC/TAO
-- combined (TAB alone: $278,650.17 shown vs $165,771.50 actual). Real
-- example: Ligang Limited (TAC) showed $790 owed -- QuickBooks' own report
-- nets it to -$970 once its $1,760 unapplied CreditMemo (CN268021, memo
-- explicitly "CN TAC 02680170") is counted.
--
-- Unlike quickbooks_invoices, this does NOT need a header+items split --
-- CreditMemo's only role here is netting against a customer's balance, not
-- revenue-recognition/period classification (that logic is Invoice-specific,
-- see classify()/parsePeriod() in app/api/quickbooks/sync/route.ts).
--
-- No CHECK constraint on qb_company, matching quickbooks_invoices' own
-- existing precedent (not invoice_creation_reservations' CHECK, which needed
-- a follow-up migration to hunt down and widen an auto-named constraint when
-- TAO was added -- see scripts/add-tao-invoice-reservations-support.sql).
-- Company validity is enforced app-side via the QbCompany TypeScript union
-- (see docs/INVARIANTS.md's INV-QB-011).
--
-- Safe to run more than once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.quickbooks_credit_memos (
  id bigserial PRIMARY KEY,
  qb_credit_memo_id text NOT NULL,
  doc_number text,
  qb_company text NOT NULL DEFAULT 'TAB',
  qb_customer_id text,
  customer_name text,
  txn_date date,
  total_amt numeric,
  -- Remaining unapplied balance. 0 (or null) means fully applied/voided --
  -- contributes nothing to netting. Non-zero is what still needs netting
  -- against the customer's outstanding balance.
  balance numeric,
  -- QuickBooks' own LinkedTxn, once this CreditMemo is formally "Applied" to
  -- an invoice inside QuickBooks -- empty for all currently-unapplied ones,
  -- but captured from day one so a future application is visible without a
  -- schema change. No existing code references LinkedTxn anywhere yet.
  linked_invoice_qb_id text,
  private_note text,
  status text,
  scraped_at timestamptz,
  last_seen_sync_run uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (qb_company, qb_credit_memo_id)
);

-- Mirrors quickbooks_invoices_sync_reconcile_idx -- backs the "anything not
-- touched by this sync run, within this run's date window, has been deleted
-- in QuickBooks" cleanup step in syncCreditMemoYear().
CREATE INDEX IF NOT EXISTS quickbooks_credit_memos_sync_reconcile_idx
  ON public.quickbooks_credit_memos (qb_company, txn_date, last_seen_sync_run);

-- Backs computeSoaRows()'s per-customer netting lookup.
CREATE INDEX IF NOT EXISTS quickbooks_credit_memos_customer_idx
  ON public.quickbooks_credit_memos (qb_company, customer_name);

ALTER TABLE public.quickbooks_credit_memos ENABLE ROW LEVEL SECURITY;

-- Same as quickbooks_invoices/quickbooks_webhook_events: sync and reads use
-- the server-only Supabase secret key. No browser policy is intentionally
-- created here.
