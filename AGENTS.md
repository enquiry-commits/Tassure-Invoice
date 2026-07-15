# Codex repository guidance

Before changing this repository:

1. Read `PROJECT_STATUS.md`.
2. Run `git status --short --branch` and `git log -5 --oneline`.
3. Inspect and preserve all pre-existing changes.

After a meaningful unit of work, verify the result, update
`PROJECT_STATUS.md`, and make a focused local commit. Do not push to GitHub,
change external services, or deploy to Vercel unless Vincent explicitly asks.

Never expose or commit values from `.env.local`.

