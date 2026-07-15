# TASSURE Invoice - Shared Project Status

Last updated: 2026-07-15

## Purpose

This file is the shared handoff record for Codex and Claude Code. Before making
changes, read this file together with `git status`, `git log -5`, and the diff.
After completing a meaningful unit of work, update the sections below and make
one focused Git commit.

## Current state

- Application: TASSURE Invoice / Billing Automation Dashboard
- Location: `C:\Users\vincent\tassure-invoice`
- Stack: Next.js 16.2.9, React 19, TypeScript, Supabase, Playwright
- Branch: `main`
- Git remote: `https://github.com/enquiry-commits/Tassure-Invoice.git`
- Working tree at handoff creation: clean and aligned with `origin/main`
- Vercel project name recorded locally: `tassure-invoice`
- Vercel note: the local `.vercel` link currently cannot retrieve project
  settings with the active Vercel account. Confirm the correct Vercel team and
  relink before using `vercel --prod`.

## Latest completed work

- Added a Resolved archive to Late Filing. Under Review rows now use a teal
  check action that retains the record instead of deleting it.
- Added independently collapsible SEC/ACC/TAX PIC columns to AR Reminder; SEC
  defaults open while ACC and TAX default collapsed.
- Tightened AR Reminder workflow columns: UEN is 70px; Reminder through ROND
  RONS are 90px; renamed SW Update to TW Update.
- Reduced the Active and FYE columns to 60px on Active Client only; shared
  Master List pages retain their default 220px and 180px widths.
- Made the AR Reminder table header stay fixed while table rows scroll.
- Fixed editable-column type checking for `in_teamwork`.
- Tightened the Non-TeamWork filter to match by UEN.
- Added the Master List Non-TeamWork filter card.
- Added TAC Invoice fallback to the latest historical ND invoice.

## Work in progress

- None at the time this handoff file was created.

## Next actions

1. Confirm the correct Vercel account/team for the existing project.
2. Relink the local directory only after confirming the target project.
3. Run `npm run build` before any production deployment.
4. Record the deployment URL and verification result here.

## Collaboration rules

1. Only one agent edits this repository at a time.
2. Before editing, run `git status --short --branch` and inspect existing diffs.
3. Never overwrite or discard changes whose owner or purpose is unclear.
4. Keep secrets in `.env.local`; never copy secret values into this file,
   commits, chat messages, or logs.
5. Make focused commits after verified units of work. Do not push or deploy
   unless Vincent explicitly requests it.
6. After each unit of work, update this file with:
   - completed changes;
   - files or modules affected;
   - verification performed;
   - remaining work or known risks;
   - deployment status, if applicable.

## Handoff log

### 2026-07-15 - Codex

- Added the Late Filing Resolved category. Resolving an Under Review row changes
  its persisted remark from `Review:` to `Resolved:` and retains it for history;
  other manual rows keep their existing delete action.
- Added PIC column collapse controls to AR Reminder. Expanded columns are 100px;
  collapsed columns remain as identifiable 34px tabs. SEC defaults expanded,
  ACC and TAX default collapsed.
- Updated AR Reminder table column widths and renamed the SW Update header to
  TW Update; underlying `software_update` data behavior is unchanged.
- Added per-page Master List column-width overrides and set Active Client's
  `status` column to 60px without changing the shared default.
- Set Active Client's `fye` column to 60px without changing the shared 180px
  default used by other Master List pages.
- Added a bounded vertical scroll area to the AR Reminder table so its sticky
  header remains visible; preserved the existing horizontal scrollbar and
  sticky identity columns.
- Verification: `npm run build`.
- Established shared Codex / Claude Code collaboration files.
- No application source code was changed.
- Confirmed the repository was clean before creating the handoff files.
