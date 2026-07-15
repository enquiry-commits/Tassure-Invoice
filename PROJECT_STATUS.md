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

- Established shared Codex / Claude Code collaboration files.
- No application source code was changed.
- Confirmed the repository was clean before creating the handoff files.

