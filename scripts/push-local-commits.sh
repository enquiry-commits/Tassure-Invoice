#!/bin/bash
# Replays the given LOCAL commits onto the latest origin/main in a throwaway worktree and (only with --push) pushes them.
#
# Why not a plain `git push` from the shared checkout: other Claude sessions commit there too, and their commits are
# already on origin under different hashes (rebased copies), so local main and origin/main have DIVERGED and a plain
# push is rejected; `git pull --rebase` needs a clean tree, which that checkout never has. A worktree built from
# origin/main touches nothing there (no stash, no index, no working tree).
#
# Usage (from the repository):
#   bash scripts/push-local-commits.sh <commit> [<commit> ...]            rehearsal: replay + show what would be pushed
#   bash scripts/push-local-commits.sh --push <commit> [<commit> ...]     replay, then push to origin main
# Give the commits oldest first. `git cherry origin/main HEAD` lists the local commits origin does not have yet ("+").
#
# A conflict ONLY in PROJECT_STATUS.md (every session adds a newest-first entry at the top) is merged ENTRY BY ENTRY
# (scripts/merge-project-status.js: new entries go in above the entry that follows them, an entry the replayed commit changed
# replaces origin's copy, nothing is duplicated). Any other conflict stops everything and pushes nothing. After the replay it
# prints PROJECT_STATUS.md's newest entries and whether any conflict marker is left.
set -e
PUSH=0
if [ "$1" = "--push" ]; then PUSH=1; shift; fi
if [ "$#" -lt 1 ]; then echo "give at least one commit hash"; exit 1; fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="${REPO}-push-wt"
TMP="$(mktemp -d)"
cd "$REPO"
git fetch origin
if [ -e "$WT" ]; then git worktree remove --force "$WT"; fi
git worktree add --detach "$WT" origin/main
cleanup() { cd "$REPO"; git worktree remove --force "$WT" 2>/dev/null || true; git worktree prune; rm -rf "$TMP"; }
trap cleanup EXIT

cd "$WT"
for c in "$@"; do
  echo "== replaying $(git -C "$REPO" log -1 --format='%h %s' "$c")"
  if ! git cherry-pick "$c" > "$TMP/pick.log" 2>&1; then
    conflicted="$(git diff --name-only --diff-filter=U)"
    if [ "$conflicted" = "PROJECT_STATUS.md" ]; then
      echo "   conflict in PROJECT_STATUS.md only - merging it entry by entry (scripts/merge-project-status.js; the replayed entries win)"
      git show ":1:PROJECT_STATUS.md" > "$TMP/base" 2>/dev/null || : > "$TMP/base"
      git show ":2:PROJECT_STATUS.md" > "$TMP/ours"      # what origin already has
      git show ":3:PROJECT_STATUS.md" > "$TMP/theirs"    # the commit being replayed
      node "$REPO/scripts/merge-project-status.js" "$TMP/base" "$TMP/ours" "$TMP/theirs" PROJECT_STATUS.md
      if grep -q '^<<<<<<<\|^>>>>>>>' PROJECT_STATUS.md; then echo "conflict markers left - stopping, nothing pushed"; exit 1; fi
      git add PROJECT_STATUS.md
      GIT_EDITOR=true git cherry-pick --continue > /dev/null
    else
      cat "$TMP/pick.log"
      echo "conflict in: $conflicted - stopping, nothing pushed"
      git cherry-pick --abort || true
      exit 1
    fi
  fi
done
echo
echo "== these commits would sit on top of origin/main:"
git log --oneline origin/main..HEAD
echo
git diff --stat origin/main HEAD | tail -25
echo
echo "== PROJECT_STATUS.md: lines added/removed vs origin, and its newest entries (the replayed one should be first, nobody else's lost):"
git diff --numstat origin/main HEAD -- PROJECT_STATUS.md
grep -n "^Last updated:" PROJECT_STATUS.md | head -3 | cut -c1-140
NEWEST="$(git -C "$REPO" log -1 --format=%s "${@: -1}")"
echo "conflict markers left anywhere in the changed files (must be 0): $(git diff --name-only origin/main HEAD | xargs grep -l '^<<<<<<<\|^>>>>>>>' 2>/dev/null | wc -l)"
echo "last commit replayed: ${NEWEST}"

if [ "$PUSH" = "1" ]; then
  echo
  echo "== pushing to origin main"
  git push origin HEAD:main
  echo "== pushed"
else
  echo
  echo "(rehearsal only - nothing was pushed; add --push to push)"
fi
