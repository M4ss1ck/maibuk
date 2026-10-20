#!/usr/bin/env bash
# Release helpers for scripts/release.sh. Sourced, not executed, so scripts/test-release.sh can exercise them directly.

release_pr_command() {
    local version="$1"
    local base="$2"
    printf 'gh pr create --base %s --head release/v%s --title "chore: bump version to %s" --body ""\n' "$base" "$version" "$version"
}
