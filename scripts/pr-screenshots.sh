#!/usr/bin/env bash
# Before/after screenshots for a PR that changes what the app looks like
# (AGENTS.md "Visual changes ship screenshots"). Runs the E2E specs you select
# twice, on the base and on this branch, with E2E_CAPTURE_DIR set, so every
# `capture(page, name)` call in them (e2e/support/capture.ts) saves a light and
# a dark shot. Then writes a Markdown body block and the matching `gh --attach`
# arguments; nothing is committed and nothing leaves the machine until you run gh.
#
#   pnpm screenshots -g "hue thumb"                     # chromium, merge-base with the base
#   pnpm screenshots --grep @wf:settings-primary-color --project=webkit
#   SCREENSHOTS_OUT=/tmp/x pnpm screenshots -g "..."    # choose the output folder
#   SCREENSHOTS_BASE=origin/release pnpm screenshots -g "..."
#
# The "before" run uses the base's app code with this branch's e2e/ folder laid
# over it, so a capture point added by this branch exists on both sides. Its
# test failures are reported, not fatal: a fix's new assertions are expected to
# fail on the base. The "after" run goes through `pnpm test:e2e` and must pass.
#
# Output: $OUT/before/*.png, $OUT/after/*.png, $OUT/screenshots.md (paste into
# the PR body) and $OUT/attach-args.txt. Attach with:
#   gh pr create --body-file body.md $(cat "$OUT/attach-args.txt")
# gh rewrites the body's ![...](path) references to the uploaded images.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT=$PWD

if [[ $# -eq 0 ]]; then
  echo "usage: pnpm screenshots <playwright filter args, e.g. -g \"hue thumb\">" >&2
  exit 2
fi

# Same base ladder as the branching setup: the remote default branch, never
# local HEAD.
BASE=${SCREENSHOTS_BASE:-}
if [[ -z $BASE ]]; then
  git fetch -q origin 2>/dev/null || true
  BASE=$(git symbolic-ref -q --short refs/remotes/origin/HEAD || true)
  for c in origin/main origin/master main master; do
    [[ -n $BASE ]] && break
    git rev-parse -q --verify "$c" >/dev/null && BASE=$c
  done
fi
[[ -n $BASE ]] || { echo "pr-screenshots: cannot find a base branch" >&2; exit 1; }
BEFORE_REF=$(git merge-base HEAD "$BASE")

BRANCH=$(git rev-parse --abbrev-ref HEAD)
OUT=${SCREENSHOTS_OUT:-/tmp/${BRANCH//\//-}/screenshots}
rm -rf "$OUT/before" "$OUT/after"
mkdir -p "$OUT"

args=("$@")
has_project=0
for a in "$@"; do [[ $a == --project* ]] && has_project=1; done
((has_project)) || args+=(--project=chromium)

WORKTREE=$(mktemp -d "${TMPDIR:-/tmp}/pr-screenshots-base.XXXXXX")
cleanup() { git -C "$ROOT" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "[screenshots] before: $BASE at $(git rev-parse --short "$BEFORE_REF") (merge-base)"
git worktree add -q --detach "$WORKTREE" "$BEFORE_REF"
rm -rf "$WORKTREE/e2e"
cp -R "$ROOT/e2e" "$WORKTREE/e2e"
rm -rf "$WORKTREE/e2e/.output"
ln -s "$ROOT/node_modules" "$WORKTREE/node_modules"
# Dictation's downloaded runtime, models and fake-microphone audio are ignored
# by git, just like node_modules. Both builds must use the same local assets.
if [[ -d "$ROOT/vendor" ]]; then
  ln -s "$ROOT/vendor" "$WORKTREE/vendor"
fi

(
  cd "$WORKTREE"
  VITE_BUILD_TARGET=web pnpm exec vite build --outDir e2e/.output/web-dist --emptyOutDir --logLevel warn
  # No coverage guard here (--no-preflight): it checks the branch's matrix
  # against the base's app, which is not the question. The after run below runs it.
  E2E_CAPTURE_DIR="$OUT/before" E2E_REUSE_BUILD=1 node e2e/run.mjs --no-preflight --reporter=line "${args[@]}"
) || echo "[screenshots] before run had failing tests (expected when the branch fixes them)"

echo "[screenshots] after: $BRANCH"
E2E_CAPTURE_DIR="$OUT/after" node e2e/run.mjs "${args[@]}"

shopt -s nullglob
shots=("$OUT"/after/*.png "$OUT"/before/*.png)
if ((${#shots[@]} == 0)); then
  echo "pr-screenshots: no screenshots; do the selected specs call capture()?" >&2
  exit 1
fi

# One table row per capture name, project and theme: before | after.
{
  echo "## Screenshots"
  echo
  echo "| | Before | After |"
  echo "| --- | --- | --- |"
  for after in "$OUT"/after/*.png; do
    file=$(basename "$after")
    stem=${file%.png}
    before="$OUT/before/$file"
    cell_before="_not captured_"
    [[ -f $before ]] && cell_before="![Before: $stem]($before)"
    echo "| \`$stem\` | $cell_before | ![After: $stem]($after) |"
  done
} >"$OUT/screenshots.md"

: >"$OUT/attach-args.txt"
for f in "$OUT"/before/*.png "$OUT"/after/*.png; do
  printf -- "--attach %s " "$f" >>"$OUT/attach-args.txt"
done

echo
echo "[screenshots] ${#shots[@]} images in $OUT"
echo "[screenshots] body block: $OUT/screenshots.md"
echo "[screenshots] attach:     gh pr edit --body-file <body.md> \$(cat $OUT/attach-args.txt)"
