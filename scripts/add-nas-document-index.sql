-- Internal-network NAS document index, for the AI assistant's search_documents
-- tool.
--
-- Context: Vincent wants files on the office's internal-network NAS
-- (\\Rainbow -- "All Clients Profile"/"Finance"/"Marketing"/etc top-level
-- folders, SMB share) searchable by content, not just filename, from the
-- existing AI assistant (app/api/assistant). tassure-invoice runs on Vercel,
-- which cannot reach into the office LAN -- the NAS is only reachable from
-- inside the office network/VPN, the opposite direction of how this app
-- syncs QuickBooks/TeamWork (this app pulls from the public internet; a NAS
-- push is the only direction that works here). An indexing script running
-- on the NAS device itself (it must already be on 24/7 to serve files to
-- staff day-to-day, so this adds no new always-on dependency) POSTs batches
-- of extracted file content to a new authenticated route
-- (app/api/nas-index/ingest/route.ts), which upserts into this table.
--
-- This is an upsert-by-file_path table, NOT a replaced-snapshot table like
-- quickbooks_ar_aging_detail -- NAS files change far less often than a daily
-- financial report, so "update only what actually changed" (via
-- content_hash) fits better than "rebuild the whole set every sync".
--
-- No CHECK constraint on top_folder/file_type, matching quickbooks_invoices'
-- existing precedent -- validity enforced app-side via TypeScript unions.
--
-- Safe to run more than once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.nas_documents (
  id bigserial PRIMARY KEY,
  -- The real UNC path on the NAS (e.g. "\\Rainbow\Finance\...\invoice.pdf")
  -- -- the natural key. Never a URL the cloud can open; see company_id below
  -- for how a search result becomes something clickable.
  file_path text UNIQUE NOT NULL,
  file_name text NOT NULL,
  -- Which top-level share folder this came from ("All Clients Profile",
  -- "Finance", "Marketing", ...) -- lets search scope/label results even
  -- before company_id resolution.
  top_folder text,
  -- Resolved at INDEX time (not query time) via lib/company-name.ts's
  -- normalize()/resolveCompany() against the real companies table, from
  -- whatever folder name the file sits under. Left null when nothing
  -- resolves cleanly -- see raw_folder_name below; never guessed.
  company_id bigint REFERENCES public.companies(id),
  -- The literal folder name the resolver saw, kept even when company_id
  -- resolved successfully (cheap, and useful when auditing a bad match) --
  -- and the only trace left behind when it did NOT resolve, so a human can
  -- go fix the mismatch instead of the file silently vanishing from search.
  raw_folder_name text,
  content_text text,
  -- Auto-derived from content_text -- every full-text search query and its
  -- GIN index target this column, never content_text directly.
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(content_text, ''))) STORED,
  file_type text,
  file_size_bytes bigint,
  -- Content hash (e.g. sha256 of the extracted text) -- lets the NAS-side
  -- script skip re-uploading/re-processing a file that has not actually
  -- changed since the last run.
  content_hash text,
  -- The NAS filesystem's own last-modified time for this file, distinct
  -- from indexed_at below (when WE last processed it).
  file_modified_at timestamptz,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  sync_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nas_documents_content_tsv_idx
  ON public.nas_documents USING gin (content_tsv);

CREATE INDEX IF NOT EXISTS nas_documents_company_id_idx
  ON public.nas_documents (company_id);

ALTER TABLE public.nas_documents ENABLE ROW LEVEL SECURITY;

-- Same as quickbooks_invoices/quickbooks_ar_aging_detail: the ingest route
-- and the search tool both use the server-only Supabase secret key. No
-- browser policy intentionally created here.
