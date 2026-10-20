#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   - $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; echo "         $2"; }

assert_eq() {
    if [ "$2" = "$3" ]; then ok "$1"; else
        no "$1" "expected: $3"$'\n'"         actual:   $2"
    fi
}

# shellcheck source=scripts/lib/release.sh
source "$REPO_ROOT/scripts/lib/release.sh"

assert_eq "release_pr_command 0.13.2 main" \
    "$(release_pr_command 0.13.2 main)" \
    'gh pr create --base main --head release/v0.13.2 --title "chore: bump version to 0.13.2" --body ""'

assert_eq "release_pr_command 1.0.0 develop" \
    "$(release_pr_command 1.0.0 develop)" \
    'gh pr create --base develop --head release/v1.0.0 --title "chore: bump version to 1.0.0" --body ""'

echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then exit 1; else exit 0; fi
