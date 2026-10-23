#!/usr/bin/env bash
# Release helpers for scripts/release.sh. Sourced, not executed, so scripts/test-release.sh can exercise them directly.
# Callers must provide the changelog library (scripts/lib/changelog.sh).

release_pr_command() {
    local version="$1"
    local base="$2"
    printf 'gh pr create --base %s --head release/v%s --title "chore: bump version to %s" --body ""\n' "$base" "$version" "$version"
}

# Stages every changelog file the Release touched: the English file and one per
# app language. Without this the translated files would stay out of the release
# commit and fail the parity guard on main.
release_stage_changelogs() {
    # shellcheck disable=SC2046 # one path per changelog file, none contains spaces
    git add $(changelog_files)
}
