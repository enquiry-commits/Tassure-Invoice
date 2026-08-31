# Claude Code repository guidance

Before changing this repository:

1. Read `PROJECT_STATUS.md`.
2. Run `git status --short --branch` and `git log -5 --oneline`.
3. Inspect and preserve all pre-existing changes.
4. If the change touches TeamWork parsing/scraping, AR/AGM cycle logic,
   PIC/staff assignment, recipient/CC resolution, document generation, cron
   automation, QuickBooks/invoicing, or shared table/data-integrity code,
   read `docs/INVARIANTS.md` first — every rule in it is a real production
   bug that already shipped once in this exact shape.

After a meaningful unit of work, verify the result, update
`PROJECT_STATUS.md`, and make a focused local commit. Pushing to GitHub
(origin main) is pre-authorized — this repo only ever pushes to one fixed
account/remote, so no need to ask each time; push once the commit is ready.
Do not change external services or deploy to Vercel directly (Vercel
deploys automatically on push) unless Vincent explicitly asks.

Never expose or commit values from `.env.local`.

## Non-negotiable rules

These come up often enough, with high enough cost when skipped, to state
directly rather than leave implicit in `docs/INVARIANTS.md`:

- Never change pricing, fee, or billing-calculation logic without Vincent
  explicitly stating the new rule — do not infer a pricing rule from UI
  behavior or "what seems right."
- Never let new logic silently rewrite or reinterpret historical data
  (past `ar_reminder` rows, past invoices, past generated documents) —
  historical records must keep the business values that were valid when
  created unless Vincent explicitly asks for a backfill/migration.
- Never remove or narrow an existing feature/behavior as a side effect of
  an unrelated change — if a requested change genuinely requires it, say so
  and confirm before implementing, don't do it silently.
- When a real bug is found and fixed, add the lesson to
  `docs/INVARIANTS.md` in the same change (see that file's own header for
  the bar: a durable, checkable domain fact — not "I fixed a typo").

