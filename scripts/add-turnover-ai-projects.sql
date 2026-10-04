-- 2026-10-04 — Vincent, on the Inbox screenshot: "summary 就不需要了...
-- 员工可以先开一个项目，点击项目后，再导入PDF...如果超过100个PDF，员工可以
-- 在同一个项目内进行导入其他的PDF...要有一个Total总数的显示...由于这些PDF
-- 的量非常大...这些数据和PDF只保留3天，3天后就清除，文件夹可以继续保留...
-- 也要设置给员工可以自己删除文件夹的功能". Then, on whether a project's
-- Total should survive the 3-day purge (answered via AskUserQuestion):
-- "保留总数，只清原始文件/明细" — keep the number, only the raw files/
-- per-receipt detail are deleted.
--
-- Also adds the optional per-project GST breakout — Vincent: "有一些公司
-- 是需要额外计算出GST的...设置多一个选择功能给员工自己选择是否要额外计算出
-- GST". Literal, not invented: when on, the AI extraction (lib/turnover-
-- ai.ts) additionally looks for an EXPLICIT GST amount already printed on
-- the receipt (most SG receipts already show one) and records it alongside
-- the line item — never a back-calculated/derived split, since that would
-- be inventing a number no one actually printed.
--
-- Safe to run more than once: the backfill below only ever touches
-- documents whose project_id is still NULL.

CREATE TABLE IF NOT EXISTS turnover_projects (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  client_company_id bigint REFERENCES companies(id),
  gst_enabled boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- [{ "currency": "SGD", "total": 1234.56, "count": 7 }, ...] — folded in
  -- by the cleanup job (app/api/turnover-ai/cleanup/route.ts) from each
  -- expiring document's CONFIRMED line items just before deleting them.
  -- Never read/written by anything else; the live summary always prefers
  -- actually-present line items over this snapshot (see
  -- app/api/turnover-ai/projects/[id]/route.ts).
  confirmed_totals jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_purged_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_turnover_projects_created_at
  ON turnover_projects (created_at DESC);

ALTER TABLE turnover_documents
  ADD COLUMN IF NOT EXISTS project_id bigint REFERENCES turnover_projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_turnover_documents_project
  ON turnover_documents (project_id);

ALTER TABLE turnover_line_items
  ADD COLUMN IF NOT EXISTS gst_amount numeric(14, 2),
  ADD COLUMN IF NOT EXISTS edited_gst_amount numeric(14, 2);

-- Backfill: one project per distinct client_name already in
-- turnover_documents (only ever 2 test rows — "AAA"/"AAAAAA" — from
-- trying the very first version of this feature on 2026-09-28, before
-- Projects existed).
INSERT INTO turnover_projects (name, created_by, created_at)
SELECT DISTINCT d.client_name, 'system:migration', now()
FROM turnover_documents d
WHERE d.project_id IS NULL AND d.client_name IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM turnover_projects p WHERE p.name = d.client_name);

UPDATE turnover_documents d
SET project_id = p.id
FROM turnover_projects p
WHERE d.project_id IS NULL AND d.client_name = p.name;
