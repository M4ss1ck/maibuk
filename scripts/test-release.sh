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

assert_contains() {
    case "$2" in
        *"$3"*) ok "$1" ;;
        *) no "$1" "expected to contain: $3"$'\n'"         actual: $2" ;;
    esac
}

assert_not_contains() {
    case "$2" in
        *"$3"*) no "$1" "expected NOT to contain: $3"$'\n'"         actual: $2" ;;
        *) ok "$1" ;;
    esac
}

# shellcheck source=scripts/lib/release.sh
source "$REPO_ROOT/scripts/lib/release.sh"

assert_eq "release_pr_command 0.13.2 main" \
    "$(release_pr_command 0.13.2 main)" \
    'gh pr create --base main --head release/v0.13.2 --title "chore: bump version to 0.13.2" --body ""'

assert_eq "release_pr_command 1.0.0 develop" \
    "$(release_pr_command 1.0.0 develop)" \
    'gh pr create --base develop --head release/v1.0.0 --title "chore: bump version to 1.0.0" --body ""'

# The Release body comes from the tested function, not from inline workflow awk.
workflow="$(cat "$REPO_ROOT/.github/workflows/release.yml")"
assert_contains "the release workflow sources the changelog library" \
    "$workflow" "source ./scripts/lib/changelog.sh"
assert_contains "the release workflow calls changelog_latest_release_body" \
    "$workflow" 'NOTES="$(changelog_latest_release_body CHANGELOG.md)"'
assert_not_contains "the release workflow has no inline changelog awk" \
    "$workflow" "awk '/^## "

echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then exit 1; else exit 0; fi
