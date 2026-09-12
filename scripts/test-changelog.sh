#!/usr/bin/env bash
# Gate tests for scripts/lib/changelog.sh. Deterministic, offline, <2s.
#
# Network is stubbed by putting a fake `curl` on PATH that records the headers
# it was called with and replays a canned response, so the provider contract
# (including the x-opencode-session header) is asserted without a real request.
#
# Run: ./scripts/test-changelog.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

print_status()  { echo "[INFO] $1"; }
print_warning() { echo "[WARNING] $1"; }

ok() { PASS=$((PASS + 1)); echo "  ok   - $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; echo "         $2"; }

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

assert_eq() {
    if [ "$2" = "$3" ]; then ok "$1"; else
        no "$1" "expected: $3"$'\n'"         actual:   $2"
    fi
}

# --- Fake curl -------------------------------------------------------------
# Writes every argument to $CURL_ARGS_FILE, then prints $CURL_BODY_FILE
# followed by CURL_STATUS, matching the -w $'\n%{http_code}' contract.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CURL_ARGS_FILE"
[ "${CURL_EXIT:-0}" != "0" ] && { echo "curl: (7) Failed to connect"; exit "$CURL_EXIT"; }
cat "$CURL_BODY_FILE"
printf '\n%s' "${CURL_STATUS:-200}"
FAKE
chmod +x "$WORK/bin/curl"
export PATH="$WORK/bin:$PATH"
export CURL_ARGS_FILE="$WORK/args.txt"
export CURL_BODY_FILE="$WORK/body.json"
# Read by the fake curl. Exported up front and assigned per-test, because a
# `CURL_STATUS=200 out="$(...)"` prefix would set it in this shell anyway
# (an assignment-only command has no command to scope the prefix to).
export CURL_STATUS=200
export CURL_EXIT=0

ai_ok_body() {
    printf '%s' '{"choices":[{"message":{"content":"### Fixed\n- stop the crash"}}]}' \
        > "$CURL_BODY_FILE"
}

# --- Git fixture -----------------------------------------------------------
# A throwaway repo whose log drives generate_fallback_changelog.
FIXTURE="$WORK/repo"
git init -q "$FIXTURE"
(
    cd "$FIXTURE" || exit 1
    git config user.email t@t.t; git config user.name t
    git commit -q --allow-empty -m "chore: seed"
    git tag v0.0.1
    git commit -q --allow-empty -m "feat(editor): add a thing"
    git commit -q --allow-empty -m "fix(sync): stop the crash"
    git commit -q --allow-empty -m "perf: make it fast"
    git commit -q --allow-empty -m "chore: bump version to 9.9.9"
    git commit -q --allow-empty -m "docs: tweak readme"
    git commit -q --allow-empty -m "unprefixed subject"
)
RANGE="v0.0.1..HEAD"

VERSION="9.9.9"
# shellcheck source=scripts/lib/changelog.sh
source "$REPO_ROOT/scripts/lib/changelog.sh"
cd "$FIXTURE" || exit 1

echo "scripts/lib/changelog.sh"

# --- generate_fallback_changelog ------------------------------------------
echo "generate_fallback_changelog"
out="$(generate_fallback_changelog "$RANGE")"
assert_contains "groups feat under Added"   "$out" "### Added"$'\n'"- add a thing"
assert_contains "groups fix under Fixed"    "$out" "### Fixed"$'\n'"- stop the crash"
assert_contains "groups perf under Changed" "$out" "### Changed"$'\n'"- make it fast"
assert_contains "keeps unprefixed as Other" "$out" "### Other"$'\n'"- unprefixed subject"
assert_not_contains "drops chore noise" "$out" "bump version"
assert_not_contains "drops docs noise"  "$out" "tweak readme"

out="$(generate_fallback_changelog "HEAD..HEAD")"
# Note: $() strips trailing newlines, so the expected value has none either.
assert_eq "empty range yields the maintenance placeholder" \
    "$out" "### Changed"$'\n'"- Maintenance release."

# --- call_chat_completions -------------------------------------------------
echo "call_chat_completions"
ai_ok_body
CURL_STATUS=200
out="$(call_chat_completions "http://x/v1" "key" "m" "p" 2>/dev/null)"
assert_eq "extracts the assistant message" "$out" "### Fixed"$'\n'"- stop the crash"

call_chat_completions "http://x/v1" "key" "m" "p" -H "x-custom: yes" >/dev/null 2>&1
assert_contains "forwards extra header args to curl" \
    "$(cat "$CURL_ARGS_FILE")" "x-custom: yes"

printf '%s' '{"type":"error","error":{"message":"Request is missing x-opencode-session"}}' \
    > "$CURL_BODY_FILE"
CURL_STATUS=400
err="$(call_chat_completions "http://x/v1" "key" "m" "p" 2>&1 >/dev/null)"
assert_contains "surfaces the HTTP status on failure" "$err" "HTTP 400"
assert_contains "surfaces the provider error body, not a bare 'failed'" \
    "$err" "missing x-opencode-session"

call_chat_completions "http://x/v1" "key" "m" "p" >/dev/null 2>&1
assert_eq "non-200 returns non-zero" "$?" "1"
CURL_STATUS=200

CURL_EXIT=7
err="$(call_chat_completions "http://x/v1" "key" "m" "p" 2>&1 >/dev/null)"
assert_contains "surfaces transport errors too" "$err" "Could not reach"
CURL_EXIT=0

# --- generate_with_opencode: the regression -------------------------------
echo "generate_with_opencode"
ai_ok_body
# Each provider case runs in its own subshell so the env it needs cannot leak
# into the next test. shellcheck's SC2030/SC2031 warn about exactly that
# isolation, which is the intent here.
# shellcheck disable=SC2030,SC2031
(
    export OPENCODE_API_KEY=k CHANGELOG_AI_MODEL=some-model
    generate_with_opencode "prompt" >/dev/null 2>&1
)
args="$(cat "$CURL_ARGS_FILE")"
assert_contains "sends x-opencode-session (regression: HTTP 400 MissingSessionID)" \
    "$args" "x-opencode-session: maibuk-changelog-9.9.9"
assert_contains "posts to the opencode Go base url" \
    "$args" "https://opencode.ai/zen/go/v1/chat/completions"

# An empty x-opencode-session value is rejected with the same HTTP 400 as a
# missing one (verified against the live API), so the ${VERSION:-dev} default
# is load-bearing rather than cosmetic.
: > "$CURL_ARGS_FILE"
# shellcheck disable=SC2030,SC2031
(
    unset VERSION
    export OPENCODE_API_KEY=k CHANGELOG_AI_MODEL=some-model
    generate_with_opencode "prompt" >/dev/null 2>&1
)
assert_contains "session id is never empty when VERSION is unset" \
    "$(cat "$CURL_ARGS_FILE")" "x-opencode-session: maibuk-changelog-dev"

: > "$CURL_ARGS_FILE"
# shellcheck disable=SC2030,SC2031
(
    export OPENCODE_API_KEY="" CHANGELOG_AI_MODEL=some-model
    generate_with_opencode "prompt" >/dev/null 2>&1
)
assert_eq "missing api key short-circuits before any request" \
    "$(cat "$CURL_ARGS_FILE")" ""

: > "$CURL_ARGS_FILE"
# shellcheck disable=SC2030,SC2031
(
    export OPENCODE_API_KEY=k CHANGELOG_AI_MODEL=""
    generate_with_opencode "prompt" >/dev/null 2>&1
)
assert_eq "missing model short-circuits before any request" \
    "$(cat "$CURL_ARGS_FILE")" ""

# --- generate_changelog: provider selection and fallback -------------------
echo "generate_changelog"
ai_ok_body
CURL_STATUS=200
out="$(CHANGELOG_AI_PROVIDER=opencode OPENCODE_API_KEY=k CHANGELOG_AI_MODEL=m \
    generate_changelog "$RANGE" 2>/dev/null)"
assert_eq "uses the AI section when the provider succeeds" \
    "$out" "### Fixed"$'\n'"- stop the crash"

CURL_STATUS=400
out="$(CHANGELOG_AI_PROVIDER=opencode OPENCODE_API_KEY=k CHANGELOG_AI_MODEL=m \
    generate_changelog "$RANGE" 2>/dev/null)"
assert_contains "falls back to the commit list when the provider 400s" \
    "$out" "- stop the crash"
assert_contains "fallback keeps every category" "$out" "### Added"

printf '%s' '{"choices":[{"message":{"content":"Sure! Here is your changelog."}}]}' \
    > "$CURL_BODY_FILE"
CURL_STATUS=200
out="$(CHANGELOG_AI_PROVIDER=opencode OPENCODE_API_KEY=k CHANGELOG_AI_MODEL=m \
    generate_changelog "$RANGE" 2>/dev/null)"
assert_contains "rejects AI output with no '### ' section and falls back" \
    "$out" "### Added"

out="$(CHANGELOG_AI_PROVIDER=nonsense generate_changelog "$RANGE" 2>/dev/null)"
assert_contains "unknown provider falls back" "$out" "### Added"

: > "$CURL_ARGS_FILE"
out="$(CHANGELOG_AI_PROVIDER="" generate_changelog "$RANGE" 2>/dev/null)"
assert_eq "no provider makes no request" "$(cat "$CURL_ARGS_FILE")" ""
assert_contains "no provider still produces a changelog" "$out" "### Added"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
