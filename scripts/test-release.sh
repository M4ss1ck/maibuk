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

# --- Localized Release Notes (ADR 0034) ------------------------------------
# The release script translates before it writes anything, so a failed language
# stops it before the dry-run summary and before the repo changes.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

RELEASE_SCRIPT="$REPO_ROOT/scripts/release.sh"
translate_line="$(grep -n 'translate_changelog_all "$CHANGELOG_SECTION"' "$RELEASE_SCRIPT" | head -n 1 | cut -d: -f1)"
summary_line="$(grep -n 'Dry run summary' "$RELEASE_SCRIPT" | head -n 1 | cut -d: -f1)"
insert_line="$(grep -n 'changelog_insert_releases' "$RELEASE_SCRIPT" | head -n 1 | cut -d: -f1)"
with_file_line="$(grep -n 'changelog_insert_release "CHANGELOG.md"' "$RELEASE_SCRIPT" | head -n 1 | cut -d: -f1)"

if [ -n "$translate_line" ] && [ -n "$summary_line" ] && [ "$translate_line" -lt "$summary_line" ]; then
    ok "translates every language before the dry-run summary"
else
    no "translates every language before the dry-run summary" \
        "translate=$translate_line summary=$summary_line"
fi
if [ -n "$translate_line" ] && [ -n "$insert_line" ] && [ "$translate_line" -lt "$insert_line" ]; then
    ok "translates every language before touching the changelog files"
else
    no "translates every language before touching the changelog files" \
        "translate=$translate_line insert=$insert_line"
fi
assert_eq "the release script no longer writes only CHANGELOG.md" "$with_file_line" ""
assert_contains "the release script inserts the English and translated entries" \
    "$(cat "$RELEASE_SCRIPT")" 'changelog_insert_releases "$TRANSLATIONS_DIR" "$VERSION" "$TODAY" "$CHANGELOG_SECTION"'
assert_contains "the dry run prints each translated entry" \
    "$(cat "$RELEASE_SCRIPT")" 'changelog_print_translations "$TRANSLATIONS_DIR" "$VERSION" "$TODAY"'

# Staging is the acceptance that the release commit carries every language.
# shellcheck source=scripts/lib/changelog.sh
source "$REPO_ROOT/scripts/lib/changelog.sh"
STAGE="$WORK/stage"
mkdir -p "$STAGE/src/locales"
printf '{}\n' > "$STAGE/src/locales/en.json"
printf '{}\n' > "$STAGE/src/locales/es.json"
printf '{}\n' > "$STAGE/src/locales/fr.json"
printf '# Changelog\n' > "$STAGE/CHANGELOG.md"
printf '# Registro de cambios\n' > "$STAGE/CHANGELOG.es.md"
printf '# Journal\n' > "$STAGE/CHANGELOG.fr.md"
(
    cd "$STAGE" || exit 1
    git init -q .
    git config user.email t@t.t; git config user.name t
    git add -A
    git commit -q -m seed
)
(
    cd "$STAGE" || exit 1
    printf '## [0.2.0] - 2026-02-02\n' >> CHANGELOG.md
    printf '## [0.2.0] - 2026-02-02\n' >> CHANGELOG.es.md
    printf '## [0.2.0] - 2026-02-02\n' >> CHANGELOG.fr.md
    release_stage_changelogs
)
assert_eq "the release commit stages every changelog file" \
    "$(cd "$STAGE" && git diff --cached --name-only | sort | paste -sd ' ' -)" \
    "CHANGELOG.es.md CHANGELOG.fr.md CHANGELOG.md"

echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then exit 1; else exit 0; fi
