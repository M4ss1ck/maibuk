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
#
# A request to .../models is the Zen free-model listing: it records to
# $CURL_MODELS_ARGS_FILE and replays $CURL_MODELS_BODY_FILE with
# CURL_MODELS_STATUS instead, so it never clobbers the chat call's args.
cat > "$WORK/bin/curl" <<'FAKE'
#!/usr/bin/env bash
for arg in "$@"; do
    case "$arg" in
        */models)
            printf '%s\n' "$@" > "$CURL_MODELS_ARGS_FILE"
            [ "${CURL_MODELS_EXIT:-0}" != "0" ] && { echo "curl: (6) Could not resolve host"; exit "$CURL_MODELS_EXIT"; }
            cat "$CURL_MODELS_BODY_FILE"
            printf '\n%s' "${CURL_MODELS_STATUS:-200}"
            exit 0
            ;;
    esac
done
printf '%s\n' "$@" > "$CURL_ARGS_FILE"
cat > "$CURL_PAYLOAD_FILE"
[ "${CURL_EXIT:-0}" != "0" ] && { echo "curl: (7) Failed to connect"; exit "$CURL_EXIT"; }
cat "$CURL_BODY_FILE"
printf '\n%s' "${CURL_STATUS:-200}"
FAKE
chmod +x "$WORK/bin/curl"
export PATH="$WORK/bin:$PATH"
export CURL_ARGS_FILE="$WORK/args.txt"
export CURL_BODY_FILE="$WORK/body.json"
export CURL_PAYLOAD_FILE="$WORK/payload.json"
# Read by the fake curl. Exported up front and assigned per-test, because a
# `CURL_STATUS=200 out="$(...)"` prefix would set it in this shell anyway
# (an assignment-only command has no command to scope the prefix to).
export CURL_STATUS=200
export CURL_EXIT=0
export CURL_MODELS_ARGS_FILE="$WORK/models-args.txt"
export CURL_MODELS_BODY_FILE="$WORK/models.json"
export CURL_MODELS_STATUS=200
export CURL_MODELS_EXIT=0
# Six "-free" ids plus two that must be filtered out (no suffix).
printf '%s' '{"data":[{"id":"big-pickle"},{"id":"a-free"},{"id":"b-free"},{"id":"m-free"},{"id":"c-free"},{"id":"d-free"},{"id":"e-free"},{"id":"gpt-x"}]}' \
    > "$CURL_MODELS_BODY_FILE"

# --- Fake opencode CLI -----------------------------------------------------
# Appends the model id (without the opencode/ prefix) to $OPENCODE_CALLS_FILE
# and its cwd to $OPENCODE_CWD_FILE, then replies like `opencode run --format
# json`: an error event and exit 1 for ids in OPENCODE_FAIL ("*" fails all), a
# section-less reply for ids in OPENCODE_NOSECTION, otherwise a real section.
# Like the real CLI it reads the prompt from stdin (into $OPENCODE_STDIN_FILE).
# The caller loops over a here-string, so a CLI that inherited that stdin
# would swallow the model list and end the loop after one attempt.
mkdir -p "$WORK/oc-bin"
cat > "$WORK/oc-bin/opencode" <<'FAKE'
#!/usr/bin/env bash
cat > "$OPENCODE_STDIN_FILE"
printf '%s\n' "$*" > "$OPENCODE_ARGS_FILE"
printf '%s\n' "${OPENCODE_CONFIG_CONTENT:-}" > "$OPENCODE_CONFIG_FILE"
ls -A | wc -l | tr -d ' ' > "$OPENCODE_CWD_ENTRIES_FILE"
printf '%s %s\n' "$$" "$PPID" > "$OPENCODE_PIDS_FILE"
model=""
while [ $# -gt 0 ]; do
    case "$1" in -m) model="${2#opencode/}"; shift ;; esac
    shift
done
printf '%s\n' "$model" >> "$OPENCODE_CALLS_FILE"
# The real CLI uses an inherited OPENCODE_API_KEY over its own login, and a
# bad one fails every free model (seen live with a revoked key).
if [ -n "${OPENCODE_API_KEY+set}" ] || [ -n "${OPENCODE_BASE_URL+set}" ]; then
    printf '{"type":"error","error":{"type":"auth","message":"Reconnect OpenCode Console to continue."}}\n'
    exit 1
fi
pwd >> "$OPENCODE_CWD_FILE"
echo "some log line on stderr" >&2
case " ${OPENCODE_FAIL:-} " in
    *" $model "*|*" * "*)
        printf '{"type":"error","error":{"type":"provider.no-route","message":"Model unavailable: opencode/%s"}}\n' "$model"
        exit 1 ;;
esac
case " ${OPENCODE_NOSECTION:-} " in
    *" $model "*)
        printf '{"type":"text","part":{"type":"text","text":"Sure! Here is your changelog."}}\n'
        exit 0 ;;
esac
if [ -n "${OPENCODE_SLEEP:-}" ]; then sleep "$OPENCODE_SLEEP"; fi
printf '{"type":"step_start","part":{"type":"step-start"}}\n'
echo "a stderr line mid-stream" >&2
printf '"a bare JSON string, not an event"\n'
case " ${OPENCODE_NARRATE:-} " in
    *" $model "*)
        printf '{"type":"text","part":{"type":"text","text":"I will summarise the commits."}}\n'
        printf '{"type":"tool_use","part":{"type":"tool","tool":"read"}}\n'
        printf '{"type":"text","part":{"type":"text","text":"```markdown\\n### Added\\n- thing\\n\\n### Fixed\\n- bug\\n```"}}\n'
        exit 0 ;;
esac
# One event written in two chunks with a stderr line between them, as a large
# event can be: only a parser that reads stdout alone sees a whole JSON line.
printf '{"type":"text","part":{"type":"text",'
echo "permission requested: read; auto-rejecting" >&2
printf '"text":"### Fixed\\n- free %s"}}\n' "$model"
FAKE
chmod +x "$WORK/oc-bin/opencode"
export PATH="$WORK/oc-bin:$PATH"
export OPENCODE_CALLS_FILE="$WORK/opencode-calls.txt"
export OPENCODE_CWD_FILE="$WORK/opencode-cwd.txt"
export OPENCODE_STDIN_FILE="$WORK/opencode-stdin.txt"
export OPENCODE_ARGS_FILE="$WORK/opencode-args.txt"
export OPENCODE_CONFIG_FILE="$WORK/opencode-config.txt"
export OPENCODE_CWD_ENTRIES_FILE="$WORK/opencode-cwd-entries.txt"
export OPENCODE_PIDS_FILE="$WORK/opencode-pids.txt"
export OPENCODE_NARRATE=""
export OPENCODE_FAIL=""
export OPENCODE_NOSECTION=""
reset_free() { : > "$OPENCODE_CALLS_FILE"; : > "$OPENCODE_CWD_FILE"; : > "$CURL_MODELS_ARGS_FILE"; }
calls() { paste -sd ' ' - < "$OPENCODE_CALLS_FILE"; }

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

# Regression: a 235-commit release made a 319 KB prompt. Passed through argv
# (jq --arg, curl -d) it hit Linux's 128 KB per-argument cap and exec failed
# with "Argument list too long", so the Go call 400'd with an empty body.
big_prompt="BIG-PROMPT-START $(head -c 200000 /dev/zero | tr '\0' 'x') BIG-PROMPT-END"
out="$(call_chat_completions "http://x/v1" "key" "m" "$big_prompt" 2>&1)"
assert_eq "a 200 KB prompt still goes through (regression: Argument list too long)" \
    "$out" "### Fixed"$'\n'"- stop the crash"
assert_contains "the prompt travels in the stdin payload" \
    "$(cat "$CURL_PAYLOAD_FILE")" "BIG-PROMPT-END"
assert_not_contains "the prompt is not in curl's argv" "$(cat "$CURL_ARGS_FILE")" "BIG-PROMPT"

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
echo "extract_changelog_section"
assert_eq "drops a preamble before the first section" \
    "$(extract_changelog_section $'Here is your changelog:\n\n### Added\n- a')" $'### Added\n- a'
assert_eq "drops code fence lines" \
    "$(extract_changelog_section $'```markdown\n### Added\n- a\n```')" $'### Added\n- a'
assert_eq "keeps blank lines between sections, trims trailing spaces" \
    "$(extract_changelog_section $'### Added\n- a   \n\n### Fixed\n- b\n\n')" $'### Added\n- a\n\n### Fixed\n- b'

echo "generate_changelog"
ai_ok_body
CURL_STATUS=200
out="$(CHANGELOG_AI_PROVIDER=opencode OPENCODE_API_KEY=k CHANGELOG_AI_MODEL=m \
    generate_changelog "$RANGE" 2>/dev/null)"
assert_eq "uses the AI section when the provider succeeds" \
    "$out" "### Fixed"$'\n'"- stop the crash"

CURL_STATUS=400
OPENCODE_FAIL="*"
out="$(CHANGELOG_AI_PROVIDER=opencode OPENCODE_API_KEY=k CHANGELOG_AI_MODEL=m \
    generate_changelog "$RANGE" 2>/dev/null)"
assert_contains "falls back to the commit list when Go 400s and every free model fails" \
    "$out" "- stop the crash"
assert_contains "fallback keeps every category" "$out" "### Added"

printf '%s' '{"choices":[{"message":{"content":"Sure! Here is your changelog."}}]}' \
    > "$CURL_BODY_FILE"
CURL_STATUS=200
out="$(CHANGELOG_AI_PROVIDER=opencode OPENCODE_API_KEY=k CHANGELOG_AI_MODEL=m \
    generate_changelog "$RANGE" 2>/dev/null)"
assert_contains "rejects AI output with no '### ' section and falls back" \
    "$out" "### Added"
OPENCODE_FAIL=""

out="$(CHANGELOG_AI_PROVIDER=nonsense generate_changelog "$RANGE" 2>/dev/null)"
assert_contains "unknown provider falls back" "$out" "### Added"

: > "$CURL_ARGS_FILE"
out="$(CHANGELOG_AI_PROVIDER="" generate_changelog "$RANGE" 2>/dev/null)"
assert_eq "no provider makes no request" "$(cat "$CURL_ARGS_FILE")" ""
assert_contains "no provider still produces a changelog" "$out" "### Added"

# --- Free-model fallback (OpenCode Go out of quota) ------------------------
echo "fetch_free_models"
reset_free
out="$(fetch_free_models 2>/dev/null)"
assert_eq "keeps only -free ids, in API order (drops big-pickle, gpt-x)" \
    "$(printf '%s' "$out" | paste -sd ' ' -)" "a-free b-free m-free c-free d-free e-free"
assert_contains "lists from the Zen /models endpoint" \
    "$(cat "$CURL_MODELS_ARGS_FILE")" "https://opencode.ai/zen/v1/models"
assert_not_contains "sends no API key to the unauthenticated listing" \
    "$(cat "$CURL_MODELS_ARGS_FILE")" "Authorization"

CURL_MODELS_STATUS=503
err="$(fetch_free_models 2>&1 >/dev/null)"; rc=$?
assert_eq "non-200 listing returns non-zero" "$rc" "1"
assert_contains "surfaces the listing's HTTP status" "$err" "HTTP 503"
CURL_MODELS_STATUS=200

echo "order_free_models"
list=$'a-free\nb-free\nm-free\nc-free\nd-free\ne-free'
assert_eq "configured model's free variant goes first, capped at 5" \
    "$(printf '%s\n' "$list" | order_free_models m | paste -sd ' ' -)" "m-free a-free b-free c-free d-free"
assert_eq "unlisted preferred model keeps API order" \
    "$(printf '%s\n' "$list" | order_free_models zz | paste -sd ' ' -)" "a-free b-free m-free c-free d-free"
assert_eq "no configured model keeps API order" \
    "$(printf '%s\n' "$list" | order_free_models "" | paste -sd ' ' -)" "a-free b-free m-free c-free d-free"
assert_eq "an empty list stays empty" "$(printf '' | order_free_models m)" ""
assert_eq "a configured id that already ends in -free is its own free variant" \
    "$(printf '%s\n' "$list" | order_free_models m-free | head -n 1)" "m-free"
assert_eq "works under set -e when the preferred model is not listed" \
    "$(set -e; printf '%s\n' "$list" | order_free_models zz | paste -sd ' ' -)" "a-free b-free m-free c-free d-free"

echo "call_opencode_cli"
reset_free
out="$(call_opencode_cli "m-free" "prompt" 2>/dev/null)"
assert_eq "returns the text parts of the JSON event stream" "$out" "### Fixed"$'\n'"- free m-free"
assert_eq "asks for opencode/<model>" "$(calls)" "m-free"
assert_eq "runs the exact non-interactive JSON command" \
    "$(cat "$OPENCODE_ARGS_FILE")" "run --standalone -m opencode/m-free --format json"
config="$(cat "$OPENCODE_CONFIG_FILE")"
for perm in bash edit webfetch websearch external_directory task skill execute question; do
    assert_eq "denies the $perm tool (commit messages are untrusted)" \
        "$(printf '%s' "$config" | jq -r ".permission.$perm")" "deny"
done
cwd="$(cat "$OPENCODE_CWD_FILE")"
assert_not_contains "runs outside the repo" "$cwd" "$FIXTURE"
case "$cwd" in /*) ok "records a real cwd" ;; *) no "records a real cwd" "got '$cwd'" ;; esac
assert_eq "its working directory is empty" "$(cat "$OPENCODE_CWD_ENTRIES_FILE")" "0"
if [ -d "$cwd" ]; then no "removes its sandbox dir" "$cwd still exists"; else ok "removes its sandbox dir"; fi

reset_free; OPENCODE_NARRATE="m-free"
out="$(call_opencode_cli "m-free" "prompt" 2>&1)"
assert_contains "keeps text parts apart (regression: 'commits.### Added')" \
    "$out" "I will summarise the commits."$'\n'"\`\`\`markdown"
OPENCODE_NARRATE=""

reset_free; mkdir -p "$WORK/no-mktemp"
printf '#!/usr/bin/env bash\nexit 1\n' > "$WORK/no-mktemp/mktemp"; chmod +x "$WORK/no-mktemp/mktemp"
PATH="$WORK/no-mktemp:$PATH" call_opencode_cli "m-free" "prompt" >/dev/null 2>&1; rc=$?
assert_eq "a mktemp failure returns non-zero" "$rc" "1"
assert_eq "a mktemp failure never runs the CLI (it would run in the repo)" "$(calls)" ""

# Ctrl-C reaches the whole process group: the CLI and the subshell around it.
reset_free; : > "$OPENCODE_PIDS_FILE"
OPENCODE_SLEEP=5 call_opencode_cli "m-free" "prompt" >/dev/null 2>&1 &
bg=$!
for _ in $(seq 50); do [ -s "$OPENCODE_PIDS_FILE" ] && break; sleep 0.05; done
read -r fake_pid sub_pid < "$OPENCODE_PIDS_FILE"
cwd="$(cat "$OPENCODE_CWD_FILE")"
kill -TERM "$sub_pid" 2>/dev/null; pkill -TERM -P "$fake_pid" 2>/dev/null; kill -TERM "$fake_pid" 2>/dev/null
wait "$bg" 2>/dev/null
if [ -n "$cwd" ] && [ ! -d "$(dirname "$cwd")" ]; then ok "removes its temp dir when interrupted"
else no "removes its temp dir when interrupted" "left behind: $(dirname "$cwd")"; fi

reset_free
out="$(OPENCODE_API_KEY=revoked OPENCODE_BASE_URL=http://x call_opencode_cli "m-free" "prompt" 2>&1)"
assert_eq "the CLI never sees the exported Go key or base url (regression: Reconnect OpenCode Console)" \
    "$out" "### Fixed"$'\n'"- free m-free"

reset_free
out="$(call_opencode_cli "m-free" "$big_prompt" 2>&1)"
assert_eq "a 200 KB prompt still reaches the CLI (regression: Argument list too long)" \
    "$out" "### Fixed"$'\n'"- free m-free"
assert_contains "the prompt travels on the CLI's stdin" "$(cat "$OPENCODE_STDIN_FILE")" "BIG-PROMPT-END"
assert_not_contains "the prompt is not in the CLI's argv" "$(cat "$OPENCODE_ARGS_FILE")" "BIG-PROMPT"

OPENCODE_FAIL="m-free"
err="$(call_opencode_cli "m-free" "prompt" 2>&1 >/dev/null)"; rc=$?
assert_eq "an error event returns non-zero" "$rc" "1"
assert_contains "surfaces the CLI's error message" "$err" "Model unavailable: opencode/m-free"
OPENCODE_FAIL=""

echo "generate_changelog: free fallback"
# shellcheck disable=SC2030,SC2031
go_changelog() {
    (
        export CHANGELOG_AI_PROVIDER=opencode OPENCODE_API_KEY=k CHANGELOG_AI_MODEL=m
        generate_changelog "$RANGE"
    )
}

reset_free; CURL_STATUS=429
printf '%s' '{"error":{"message":"weekly usage limit reached"}}' > "$CURL_BODY_FILE"
err="$(go_changelog 2>&1 >"$WORK/out.txt")"
out="$(cat "$WORK/out.txt")"
assert_eq "Go 429 -> the configured model's free variant writes it" "$out" "### Fixed"$'\n'"- free m-free"
assert_eq "stops at the first free model that works" "$(calls)" "m-free"
assert_contains "logs the Go attempt" "$err" "trying m on OpenCode Go..."
assert_contains "logs the Go failure with its elapsed time" "$err" "returned HTTP 429 after"
assert_contains "logs the Go error body" "$err" "weekly usage limit reached"
assert_contains "logs how many free models it found" "$err" "6 free models found; trying up to 5"
assert_contains "logs each attempt before it runs" "$err" "attempt 1/5, m-free (free, may be slow)..."
assert_eq "the last line names the model that wrote it and how long it took" \
    "$(printf '%s\n' "$err" | tail -n 1 | sed 's/in [0-9]*s/in Ns/')" \
    "[INFO] AI changelog: written by m-free (OpenCode Zen, free) in Ns."

reset_free; CURL_STATUS=200; CURL_EXIT=7
out="$(go_changelog 2>/dev/null)"
assert_eq "Go unreachable -> free model writes it" "$out" "### Fixed"$'\n'"- free m-free"
CURL_EXIT=0

reset_free
printf '%s' '{"choices":[{"message":{"content":"Sure! Here is your changelog."}}]}' > "$CURL_BODY_FILE"
out="$(go_changelog 2>/dev/null)"
assert_eq "Go reply without a section -> free model writes it" "$out" "### Fixed"$'\n'"- free m-free"

reset_free; CURL_STATUS=429; OPENCODE_FAIL="m-free"; OPENCODE_NOSECTION="a-free"
out="$(go_changelog 2>/dev/null)"
assert_eq "skips a failing and a section-less free model, keeps going" "$out" "### Fixed"$'\n'"- free b-free"
assert_eq "tries them in order, and the CLI cannot eat the loop's stdin" "$(calls)" "m-free a-free b-free"
OPENCODE_NOSECTION=""

reset_free; OPENCODE_FAIL="*"
err="$(go_changelog 2>&1 >"$WORK/out.txt")"
out="$(cat "$WORK/out.txt")"
assert_eq "gives up after exactly 5 free attempts" "$(calls)" "m-free a-free b-free c-free d-free"
assert_contains "all free attempts failing -> grouped commit list" "$out" "### Added"$'\n'"- add a thing"
assert_contains "logs why an attempt failed and how long it took" "$err" "d-free failed after"
# One per failed call (Go + 5 free) plus the final "falling back" line.
assert_eq "exactly one warning per failed attempt" "$(printf '%s\n' "$err" | grep -c '^\[WARNING\]')" "7"
OPENCODE_FAIL=""

reset_free; CURL_MODELS_STATUS=500
out="$(go_changelog 2>/dev/null)"
assert_eq "listing failure makes no CLI call" "$(calls)" ""
assert_contains "listing failure -> grouped commit list" "$out" "### Added"
CURL_MODELS_STATUS=200

reset_free
# A PATH of symlinks to just the tools the lib needs, so neither the fake nor a
# real opencode (which may sit next to jq, e.g. in /opt/homebrew/bin) is found.
mkdir -p "$WORK/min-bin"
for tool in jq git awk sed grep head tail cat wc tr paste mktemp rm mkdir env; do
    ln -sf "$(command -v "$tool")" "$WORK/min-bin/$tool"
done
ln -sf "$WORK/bin/curl" "$WORK/min-bin/curl"
err="$(PATH="$WORK/min-bin" go_changelog 2>&1 >"$WORK/out.txt")"
assert_contains "no opencode CLI -> grouped commit list" "$(cat "$WORK/out.txt")" "### Added"
assert_contains "no opencode CLI is reported" "$err" "opencode CLI not found"

reset_free; CURL_STATUS=200
printf '%s' '{"choices":[{"message":{"content":null}}]}' > "$CURL_BODY_FILE"
out="$(go_changelog 2>/dev/null)"
assert_eq "an empty Go reply -> free model writes it" "$out" "### Fixed"$'\n'"- free m-free"

reset_free; CURL_STATUS=429; OPENCODE_NARRATE="m-free"
out="$(go_changelog 2>/dev/null)"
assert_eq "drops the model's narration and code fence from CHANGELOG output" \
    "$out" "### Added"$'\n'"- thing"$'\n\n'"### Fixed"$'\n'"- bug"
OPENCODE_NARRATE=""

# release.sh runs under set -e and captures the section with $(...).
reset_free; CURL_STATUS=429; OPENCODE_FAIL="*"
out="$(set -e; section="$(go_changelog 2>/dev/null)"; printf '%s' "$section")"; rc=$?
assert_eq "everything failing never aborts a set -e release" "$rc" "0"
assert_contains "everything failing under set -e still yields the grouped list" "$out" "### Added"
OPENCODE_FAIL=""

reset_free; ai_ok_body; CURL_STATUS=200
err="$(go_changelog 2>&1 >/dev/null)"
assert_eq "a Go success ends by naming the Go model" \
    "$(printf '%s\n' "$err" | tail -n 1)" "[INFO] AI changelog: written by m on OpenCode Go."
out="$(go_changelog 2>/dev/null)"
assert_eq "Go success never lists or calls free models" \
    "$(calls)$(cat "$CURL_MODELS_ARGS_FILE")" ""

reset_free; CURL_STATUS=429
out="$(CHANGELOG_AI_PROVIDER=openai OPENAI_API_KEY=k generate_changelog "$RANGE" 2>/dev/null)"
assert_eq "openai provider failing never tries the free models" \
    "$(calls)$(cat "$CURL_MODELS_ARGS_FILE")" ""
assert_contains "openai provider failing -> grouped commit list" "$out" "### Added"
CURL_STATUS=200

# --- The changelog file ----------------------------------------------------
echo "changelog_latest_release_body"

# The awk it replaced, kept as the reference for the latest Release body.
awk '/^## \[/{c++} c==1' "$REPO_ROOT/CHANGELOG.md" | tail -n +2 > "$WORK/awk-body.txt"
changelog_latest_release_body "$REPO_ROOT/CHANGELOG.md" > "$WORK/body.txt"
if cmp -s "$WORK/body.txt" "$WORK/awk-body.txt"; then
    ok "the real CHANGELOG.md gives a body byte-identical to the awk it replaced"
else
    no "the real CHANGELOG.md gives a body byte-identical to the awk it replaced" \
        "$(diff -u "$WORK/awk-body.txt" "$WORK/body.txt" | head -n 20)"
fi
assert_eq "drops the '## [' heading line" "$(head -n 1 "$WORK/body.txt")" ""
assert_not_contains "stops at the next Release heading" "$(cat "$WORK/body.txt")" "## ["
assert_not_contains "never includes the closing note" "$(cat "$WORK/body.txt")" "Older releases"

# A file whose only Release is followed by the closing note: the note and the
# blank lines before it must not reach the body. (The body keeps the blank line
# after its heading, exactly like the awk that emptied the heading line.)
printf '%s\n' '# Changelog' '' 'Preamble.' '' \
    '## [1.0.0] - 2026-01-01' '' '### Added' '- one thing' '' \
    '> Older releases are listed on the [GitHub Releases](https://example.com) page.' \
    > "$WORK/one-release.md"
assert_eq "a one-Release file yields just its body" \
    "$(changelog_latest_release_body "$WORK/one-release.md")" $'\n### Added\n- one thing'

printf '%s\n' '# Changelog' '' 'Preamble only, no Release yet.' > "$WORK/no-release.md"
assert_eq "a file without a Release heading prints nothing" \
    "$(changelog_latest_release_body "$WORK/no-release.md")" ""

out="$(changelog_latest_release_body "$WORK/does-not-exist.md")"; rc=$?
assert_eq "a missing file prints nothing" "$out" ""
assert_eq "a missing file exits 0, so the release falls back to generated notes" "$rc" "0"

echo "changelog_insert_release"
entry="## [0.2.0] - 2026-01-02"$'\n\n'"### Added"$'\n'"- new thing"

# A translated changelog: its preamble differs from CHANGELOG_DEFAULT_HEADER.
printf '%s\n' '# Registro de cambios' '' \
    'Todos los cambios notables de este proyecto se documentan aquí.' '' \
    '## [0.1.0] - 2026-01-01' '' '### Añadido' '- algo' '' \
    '> Las versiones anteriores están en la página de Releases.' > "$WORK/own.md"
changelog_insert_release "$WORK/own.md" "$entry"
printf '%s\n' '# Registro de cambios' '' \
    'Todos los cambios notables de este proyecto se documentan aquí.' '' \
    '## [0.2.0] - 2026-01-02' '' '### Added' '- new thing' '' \
    '## [0.1.0] - 2026-01-01' '' '### Añadido' '- algo' '' \
    '> Las versiones anteriores están en la página de Releases.' > "$WORK/own-expected.md"
if cmp -s "$WORK/own.md" "$WORK/own-expected.md"; then
    ok "inserts after the file's own preamble and keeps the closing note verbatim"
else
    no "inserts after the file's own preamble and keeps the closing note verbatim" \
        "$(diff -u "$WORK/own-expected.md" "$WORK/own.md" | head -n 20)"
fi
assert_not_contains "never writes the default preamble over an existing one" \
    "$(cat "$WORK/own.md")" "All notable changes"

# Removing the latest Release from the real file and inserting it back must
# reproduce the file byte for byte: no visible change.
first="$(grep -n -m1 '^## \[' "$REPO_ROOT/CHANGELOG.md" | cut -d: -f1)"
second="$(grep -n '^## \[' "$REPO_ROOT/CHANGELOG.md" | sed -n 2p | cut -d: -f1)"
sed "${first},$((second - 1))d" "$REPO_ROOT/CHANGELOG.md" > "$WORK/roundtrip.md"
changelog_insert_release "$WORK/roundtrip.md" \
    "$(sed -n "${first},$((second - 2))p" "$REPO_ROOT/CHANGELOG.md")"
if cmp -s "$WORK/roundtrip.md" "$REPO_ROOT/CHANGELOG.md"; then
    ok "re-inserting the real latest Release reproduces CHANGELOG.md byte for byte"
else
    no "re-inserting the real latest Release reproduces CHANGELOG.md byte for byte" \
        "$(diff -u "$REPO_ROOT/CHANGELOG.md" "$WORK/roundtrip.md" | head -n 20)"
fi

changelog_insert_release "$WORK/created.md" "$entry"
assert_eq "a missing file is created from the default header" \
    "$(cat "$WORK/created.md")" \
    "$CHANGELOG_DEFAULT_HEADER"$'\n'"## [0.2.0] - 2026-01-02"$'\n\n'"### Added"$'\n'"- new thing"

# --- Localized Release Notes (ADR 0034) ------------------------------------
#
# A fixture repo with two app languages besides English drives the whole path:
# languages from src/locales, term pairs from GLOSSARY.md, one changelog file per
# language. It is a real git repo so "the repo was left unchanged" is checked
# with git, not with a copy.
REL="$WORK/relrepo"
mkdir -p "$REL/src/locales"
printf '{}\n' > "$REL/src/locales/en.json"
printf '{}\n' > "$REL/src/locales/es.json"
printf '{}\n' > "$REL/src/locales/fr.json"
cat > "$REL/GLOSSARY.md" <<'EOF'
# Glossary

**What's new**:
The dialog listing a Release's notes.
_UI_: en "What's new" / es "Novedades"

**Sync log**:
The record of sync runs.
_UI_: en "Sync log" / es "Registro de sincronización"; en "Templates" / es "Plantillas"
_UI_: es "Lanzamientos" for Releases
_UI_: en "Stopped"
EOF
printf '# Changelog\n\nEnglish preamble.\n\n## [0.0.1] - 2026-01-01\n\n### Added\n- old\n' \
    > "$REL/CHANGELOG.md"
printf '# Registro de cambios\n\nPreámbulo español.\n\n## [0.0.1] - 2026-01-01\n\n### Added\n- viejo\n' \
    > "$REL/CHANGELOG.es.md"
printf '# Journal\n\nPréambule français.\n\n## [0.0.1] - 2026-01-01\n\n### Added\n- ancien\n' \
    > "$REL/CHANGELOG.fr.md"
(
    cd "$REL" || exit 1
    git init -q .
    git config user.email t@t.t; git config user.name t
    git add -A
    git commit -q -m "seed"
)

echo "changelog_languages / changelog_file"
assert_eq "every locale file but English is a language" \
    "$(changelog_languages "$REL/src/locales" | paste -sd ' ' -)" "es fr"
assert_eq "English ships CHANGELOG.md" "$(changelog_file en)" "CHANGELOG.md"
assert_eq "a language ships its own changelog" "$(changelog_file es)" "CHANGELOG.es.md"

echo "changelog_glossary_pairs"
PAIRS_GLOSSARY="$REL/GLOSSARY.md"
assert_eq "reads every en/es pair in file order, skipping lines without one" \
    "$(changelog_glossary_pairs "$PAIRS_GLOSSARY" es | tr '\t' '=' | paste -sd '|' -)" \
    "What's new=Novedades|Sync log=Registro de sincronización|Templates=Plantillas"
assert_eq "a language with no pairs yields nothing" \
    "$(changelog_glossary_pairs "$PAIRS_GLOSSARY" fr)" ""
assert_eq "a missing glossary yields nothing" \
    "$(changelog_glossary_pairs "$WORK/no-glossary.md" es)" ""

echo "changelog_language_name"
assert_contains "es is named in English" "$(changelog_language_name es)" "Spanish"
assert_eq "an unknown code stands for itself" "$(changelog_language_name zz)" "zz"
assert_eq "an invalid code stands for itself" "$(changelog_language_name 'not a code')" "not a code"

echo "changelog_structure_signature"
EN_SECTION="$(cat <<'EOF'
### Added
- Add a What's new dialog

### Fixed
- Stop the crash
EOF
)"
assert_eq "names each kind with its item count, in order" \
    "$(changelog_structure_signature "$EN_SECTION")" $'Added\t1\nFixed\t1'
assert_eq "a missing bullet changes the count" \
    "$(changelog_structure_signature $'### Added\n- one\n\n### Fixed')" \
    $'Added\t1\nFixed\t0'
assert_eq "two sections of one kind stay apart" \
    "$(changelog_structure_signature $'### Added\n- one\n\n### Added\n- two')" \
    $'Added\t1\nAdded\t1'

echo "translate_changelog"
cd "$REL" || exit 1
export CHANGELOG_AI_PROVIDER=opencode OPENCODE_API_KEY=k CHANGELOG_AI_MODEL=m
export CHANGELOG_LOCALES_DIR=src/locales CHANGELOG_GLOSSARY=GLOSSARY.md

translate_body() {
    jq -Rs '{choices: [{message: {content: .}}]}' > "$CURL_BODY_FILE"
}

# A preamble and code fences around the translation. (The existing section
# extraction drops what precedes the first "### " line, not prose after it.)
reset_free; : > "$CURL_ARGS_FILE"; CURL_STATUS=200
translated_section=$'Here is your translation:\n\n```markdown\n### Added\n- Añade un diálogo de Novedades\n\n### Fixed\n- Detén el fallo\n```\n'
printf '%s' "$translated_section" | translate_body
out="$(translate_changelog "$EN_SECTION" es 2>/dev/null)"; rc=$?
assert_eq "the stubbed translation is accepted" "$rc" "0"
assert_eq "a preamble and code fences are cleaned before the structure check" \
    "$out" $'### Added\n- Añade un diálogo de Novedades\n\n### Fixed\n- Detén el fallo'
payload="$(jq -r '.messages[0].content' "$CURL_PAYLOAD_FILE")"
assert_contains "the prompt carries the English section" "$payload" "Add a What's new dialog"
assert_contains "the prompt carries the target language" "$payload" "Spanish"
assert_contains "the prompt carries the glossary term pairs" \
    "$payload" '"What'\''s new" -> "Novedades"'
assert_contains "the prompt pins the section headings" "$payload" "### Kind"

# A one-section English text, so the fake CLI's matching reply can win.
EN_FIXED=$'### Fixed\n- Stop the crash'

# Same kind, one bullet too many: rejected, so the next provider is tried.
reset_free; CURL_STATUS=200
printf '%s' $'### Fixed\n- one bullet too many\n- and another' | translate_body
out="$(translate_changelog "$EN_FIXED" es 2>/dev/null)"; rc=$?
assert_eq "a reply whose item counts differ from English is rejected" "$rc" "0"
assert_eq "the next provider in the chain wrote the accepted section" \
    "$out" $'### Fixed\n- free m-free'
assert_eq "the free models are tried after Go" "$(calls)" "m-free"

# Same item count, different kind: rejected for the kinds alone.
reset_free; CURL_STATUS=200
printf '%s' $'### Changed\n- Detén el fallo' | translate_body
out="$(translate_changelog "$EN_FIXED" es 2>/dev/null)"; rc=$?
assert_eq "a reply whose kinds differ from English is rejected" "$rc" "0"
assert_eq "the matching free-model reply wins instead" "$out" $'### Fixed\n- free m-free'

echo "translate_changelog_all"
# Every provider failing for one language: non-zero, names the language, and
# nothing in the repo changes.
reset_free; : > "$CURL_ARGS_FILE"; CURL_STATUS=200
printf '%s' $'### Changed\n- wrong structure' | translate_body
OPENCODE_FAIL="*"
mkdir -p "$WORK/translations"
repo_before="$(git status --porcelain; cat CHANGELOG*.md | sha1sum)"
err="$(translate_changelog_all "$EN_SECTION" "$WORK/translations" 2>&1 >/dev/null)"; rc=$?
assert_eq "every provider failing stops with a non-zero exit" "$rc" "1"
assert_contains "the error names the language" "$err" "'es'"
assert_eq "no translation is written" "$(ls "$WORK/translations")" ""
assert_eq "the repo is unchanged" \
    "$(git status --porcelain; cat CHANGELOG*.md | sha1sum)" "$repo_before"
OPENCODE_FAIL=""

# A missing translated changelog is an error, checked before any AI call.
reset_free; : > "$CURL_ARGS_FILE"; CURL_STATUS=200
mv "$REL/CHANGELOG.fr.md" "$WORK/CHANGELOG.fr.md.bak"
err="$(translate_changelog_all "$EN_SECTION" "$WORK/translations" 2>&1 >/dev/null)"; rc=$?
assert_eq "a missing translated changelog fails the release" "$rc" "1"
assert_contains "the error names the missing file" "$err" "CHANGELOG.fr.md"
assert_contains "the error names the language" "$err" "'fr'"
assert_eq "no AI call is made when a file is missing" \
    "$(cat "$CURL_ARGS_FILE")$(calls)" ""
if [ -f "$REL/CHANGELOG.fr.md" ]; then
    no "the missing file is never created" "CHANGELOG.fr.md was created"
else
    ok "the missing file is never created"
fi
mv "$WORK/CHANGELOG.fr.md.bak" "$REL/CHANGELOG.fr.md"

echo "changelog_print_translations"
mkdir -p "$WORK/printed"
printf '### Added\n- Hola\n' > "$WORK/printed/es"
printf '### Added\n- Bonjour\n' > "$WORK/printed/fr"
out="$(changelog_print_translations "$WORK/printed" 9.9.9 2026-01-01)"
assert_contains "the dry run prints the Spanish entry under [es]" "$out" "[es]"
assert_contains "the dry run prints the French entry under [fr]" "$out" "[fr]"
assert_contains "the Spanish entry carries its version heading" \
    "$out" "## [9.9.9] - 2026-01-01"$'\n\n'"### Added"$'\n'"- Hola"
assert_contains "the French entry is printed too" "$out" "- Bonjour"

echo "changelog_insert_releases"
# A real run: translate every language, then insert the English entry and every
# translation into its own file, after that file's preamble.
reset_free; CURL_STATUS=200
printf '%s' $'### Added\n- Añade un diálogo de Novedades\n\n### Fixed\n- Detén el fallo' | translate_body
mkdir -p "$WORK/translated"
translate_changelog_all "$EN_SECTION" "$WORK/translated" >/dev/null 2>&1; rc=$?
assert_eq "translates every language before the insertion" "$rc" "0"
assert_eq "one translated body per language" \
    "$(ls "$WORK/translated" | paste -sd ' ' -)" "es fr"
assert_eq "every changelog file the release touches" \
    "$(changelog_files | paste -sd ' ' -)" "CHANGELOG.md CHANGELOG.es.md CHANGELOG.fr.md"

changelog_insert_releases "$WORK/translated" "0.2.0" "2026-02-02" "$EN_SECTION"
for file in CHANGELOG.md CHANGELOG.es.md CHANGELOG.fr.md; do
    assert_contains "$file gets the new Release heading" \
        "$(cat "$file")" "## [0.2.0] - 2026-02-02"
    assert_contains "$file keeps its previous Release" \
        "$(cat "$file")" "## [0.0.1] - 2026-01-01"
done
assert_contains "English keeps its own preamble" "$(head -n 1 CHANGELOG.md)" "# Changelog"
assert_contains "Spanish keeps its own preamble" \
    "$(head -n 1 CHANGELOG.es.md)" "# Registro de cambios"
assert_contains "French keeps its own preamble" "$(head -n 1 CHANGELOG.fr.md)" "# Journal"
assert_not_contains "the default header is never written into a translation" \
    "$(cat CHANGELOG.es.md CHANGELOG.fr.md)" "All notable changes"

# The result is the parity guard's contract: same kinds, same item counts.
en_signature="$(changelog_structure_signature "$(changelog_latest_release_body CHANGELOG.md)")"
for file in CHANGELOG.es.md CHANGELOG.fr.md; do
    assert_eq "$file keeps parity with English" \
        "$(changelog_structure_signature "$(changelog_latest_release_body "$file")")" \
        "$en_signature"
done

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
