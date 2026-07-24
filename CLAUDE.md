# Claude Code repository guidance

Before changing this repository:

1. Read `PROJECT_STATUS.md`.
2. Run `git status --short --branch` and `git log -5 --oneline`.
3. Inspect and preserve all pre-existing changes.

After a meaningful unit of work, verify the result, update
`PROJECT_STATUS.md`, and make a focused local commit. Pushing to GitHub
(origin main) is pre-authorized — this repo only ever pushes to one fixed
account/remote, so no need to ask each time; push once the commit is ready.
Do not change external services or deploy to Vercel directly (Vercel
deploys automatically on push) unless Vincent explicitly asks.

Never expose or commit values from `.env.local`.

