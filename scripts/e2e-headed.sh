#!/usr/bin/env bash
# Personal watch loop for the keyboard E2E suite: one headed browser window,
# one test at a time, slowed down enough to follow. This is not the shared
# command and never runs in CI; `pnpm test:e2e` (see e2e/README.md) stays the
# source of truth for the suite.
#
#   pnpm test:e2e:headed                              # whole suite, chromium
#   pnpm test:e2e:headed specs/books-create.spec.ts   # one file
#   pnpm test:e2e:headed -g "Esc cancels"             # one test by title
#   pnpm test:e2e:headed --project=webkit             # another engine
#   E2E_SLOW_MO=0     pnpm test:e2e:headed ...        # full speed
#   E2E_REUSE_BUILD=1 pnpm test:e2e:headed ...        # skip the web build
#
# Extra arguments pass straight to `playwright test`; --headed, --workers=1,
# --max-failures=1 and --project=chromium are only added when you did not set
# them yourself, so the run stops at the first failure instead of carrying on.
# `--project=webkit` works too, but headed WebKit on Linux needs its GTK
# libraries first (`pnpm exec playwright install-deps webkit`, asks for sudo).

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

has() {
  local flag=$1 arg
  shift
  for arg in "$@"; do
    [[ $arg == "$flag" || $arg == "$flag="* ]] && return 0
  done
  return 1
}

injected=()
has --headed "$@" || injected+=(--headed)
has --workers "$@" || has -j "$@" || injected+=(--workers=1)
has --max-failures "$@" || has -x "$@" || injected+=(--max-failures=1)
has --project "$@" || injected+=(--project=chromium)

export E2E_SLOW_MO=${E2E_SLOW_MO:-250}

exec node e2e/run.mjs ${injected[@]+"${injected[@]}"} "$@"
