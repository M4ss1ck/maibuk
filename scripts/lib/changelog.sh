#!/usr/bin/env bash
# Changelog generation for scripts/release.sh.
#
# Sourced, not executed, so the functions can be exercised directly by
# scripts/test-changelog.sh without running a real release.
#
# Callers must provide: VERSION, print_status, print_warning.
#
# Collects commits since the last tag and turns them into a markdown changelog
# section. When CHANGELOG_AI_PROVIDER is configured the section is written by an
# AI model; otherwise (or on any failure) it falls back to a grouped commit list.
# For the opencode provider, a failed Go call first retries on OpenCode Zen's
# free models through the opencode CLI (see generate_with_free_models).
#
# Also reads and writes the changelog file itself: changelog_latest_release_body
# feeds the GitHub Release body (.github/workflows/release.yml) and
# changelog_insert_release adds a new Release section to a file.

# Group raw commits by Conventional Commit prefix. Used as the AI input and as
# the no-AI fallback output.
generate_fallback_changelog() {
    local range="$1"
    local added="" changed="" fixed="" other=""
    local line type subject

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        # Strip an optional "type(scope): " or "type: " prefix.
        if [[ "$line" =~ ^([a-z]+)(\([^\)]*\))?!?:\ (.*)$ ]]; then
            type="${BASH_REMATCH[1]}"
            subject="${BASH_REMATCH[3]}"
        else
            type="other"
            subject="$line"
        fi
        case "$type" in
            feat)            added+="- ${subject}"$'\n' ;;
            fix)             fixed+="- ${subject}"$'\n' ;;
            perf|refactor)   changed+="- ${subject}"$'\n' ;;
            chore|docs|test|build|ci|style) ;; # noise, skip
            *)               other+="- ${subject}"$'\n' ;;
        esac
    done < <(git log --no-merges --pretty=tformat:'%s' "$range")

    local out=""
    [ -n "$added" ]   && out+="### Added"$'\n'"$added"$'\n'
    [ -n "$changed" ] && out+="### Changed"$'\n'"$changed"$'\n'
    [ -n "$fixed" ]   && out+="### Fixed"$'\n'"$fixed"$'\n'
    [ -n "$other" ]   && out+="### Other"$'\n'"$other"$'\n'
    [ -z "$out" ]     && out="### Changed"$'\n'"- Maintenance release."$'\n'

    printf '%s' "$out"
}

# Build the instruction shared by every AI provider.
build_ai_prompt() {
    local range="$1"
    local commits
    commits="$(git log --no-merges --pretty=format:'- %s%n%b' "$range")"
    cat <<EOF
You are writing the changelog for version $VERSION of "Maibuk", a desktop notes app.
Below is the raw git commit log since the previous release. Produce a concise,
professional changelog section in Markdown following the "Keep a Changelog" style.

Rules:
- Output ONLY the category sections, each starting with "### " (e.g. "### Added",
  "### Changed", "### Fixed", "### Removed"). Do NOT include a version header.
- Group related commits, rewrite messages into clear user-facing notes, and drop
  pure noise (version bumps, CI tweaks, formatting-only changes).
- One bullet per change, present tense, no commit hashes, no trailing period needed.
- If nothing user-facing changed, output a single "### Changed" with one bullet.
- Do not add any prose before or after the sections.

Commit log:
$commits
EOF
}

# Call any OpenAI-compatible /chat/completions endpoint.
# Args: base_url, api_key, model, prompt, [extra curl args...].
# Prints the assistant message text.
#
# Deliberately does NOT use curl --fail: --fail discards the response body, and
# the body is where providers explain the rejection. A silent "request failed"
# is how the missing x-opencode-session header went unnoticed for four releases.
# Instead capture the body plus the status code and report both.
call_chat_completions() {
    local base_url="$1" api_key="$2" model="$3" prompt="$4"
    shift 4
    local payload response status body started=$SECONDS
    # The prompt and payload travel on stdin, never argv: a release with a few
    # hundred commits makes a ~300 KB prompt, past Linux's 128 KB per-argument
    # cap, and exec then fails with "Argument list too long".
    payload="$(printf '%s' "$prompt" | jq -Rs --arg model "$model" \
        '{model: $model, temperature: 0.3, messages: [{role: "user", content: .}]}')"
    response="$(printf '%s' "$payload" | curl -sS -w $'\n%{http_code}' "$base_url/chat/completions" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        "$@" \
        --data-binary @- 2>&1)" || {
        print_warning "Could not reach $base_url after $((SECONDS - started))s: $response" >&2
        return 1
    }
    status="${response##*$'\n'}"
    body="${response%$'\n'*}"
    if [ "$status" != "200" ]; then
        print_warning "$base_url returned HTTP $status after $((SECONDS - started))s: $(printf '%s' "$body" | head -c 500)" >&2
        return 1
    fi
    printf '%s' "$body" | jq -r '.choices[0].message.content // empty'
}

# opencode Go (https://opencode.ai/docs/go) — an OpenAI-compatible API at
# https://opencode.ai/zen/go/v1. Model id is plain, e.g. "deepseek-v4.1-flash".
generate_with_opencode() {
    local prompt="$1"
    if [ -z "${OPENCODE_API_KEY:-}" ]; then
        print_warning "CHANGELOG_AI_PROVIDER=opencode but OPENCODE_API_KEY is not set." >&2
        return 1
    fi
    if [ -z "${CHANGELOG_AI_MODEL:-}" ]; then
        print_warning "CHANGELOG_AI_MODEL is not set (e.g. deepseek-v4.1-flash)." >&2
        return 1
    fi
    local base_url="${OPENCODE_BASE_URL:-https://opencode.ai/zen/go/v1}"
    # opencode Go rejects requests without x-opencode-session (HTTP 400
    # MissingSessionID). The docs ask for "a stable session ID for each
    # conversation"; one changelog is one conversation, so key it on the version
    # being released. Stable across retries of the same release, which also lets
    # their prompt cache hit on a second attempt.
    print_status "AI changelog: trying $CHANGELOG_AI_MODEL on OpenCode Go..." >&2
    local started=$SECONDS result
    # On failure call_chat_completions has already logged why and how long.
    result="$(call_chat_completions "$base_url" "$OPENCODE_API_KEY" "$CHANGELOG_AI_MODEL" "$prompt" \
        -H "x-opencode-session: maibuk-changelog-${VERSION:-dev}")" || return 1
    print_status "AI changelog: OpenCode Go answered in $((SECONDS - started))s." >&2
    printf '%s' "$result"
}

# True when $1 holds at least one "### " category section.
is_changelog_section() {
    printf '%s' "$1" | grep -q '^### '
}

# Keeps the reply from its first "### " line on, so a model's preamble ("Here
# is your changelog:") or an opening code fence never reaches CHANGELOG.md, and
# drops bare ``` fence lines and trailing whitespace. (Trailing blank lines go
# when the caller captures the output with $(...).)
extract_changelog_section() {
    printf '%s\n' "$1" | awk 'found || /^### /{found=1; print}' | grep -v '^```[a-z]*[[:space:]]*$' |
        sed -e 's/[[:space:]]*$//'
}

# OpenCode Zen lists its models at /models without auth. There is no price
# field, so a free model is recognised by its "-free" id suffix alone (which
# leaves out free models without the suffix, e.g. big-pickle). Prints one id
# per line, in the order the API lists them.
fetch_free_models() {
    local response status body
    response="$(curl -sS -w $'\n%{http_code}' "https://opencode.ai/zen/v1/models" 2>&1)" || {
        print_warning "AI changelog: could not reach OpenCode Zen: $response" >&2
        return 1
    }
    status="${response##*$'\n'}"
    body="${response%$'\n'*}"
    if [ "$status" != "200" ]; then
        print_warning "AI changelog: OpenCode Zen /models returned HTTP $status: $(printf '%s' "$body" | head -c 500)" >&2
        return 1
    fi
    printf '%s' "$body" | jq -r '.data[]?.id | select(endswith("-free"))'
}

# Reads free model ids on stdin and prints the ones to try, in order: the free
# variant of the configured model first (when listed), then the rest in list
# order, capped at FREE_MODEL_ATTEMPTS. A model id that already ends in "-free"
# is its own free variant.
FREE_MODEL_ATTEMPTS=5
order_free_models() {
    local base="${1%-free}" preferred="" models
    [ -n "$base" ] && preferred="$base-free"
    models="$(cat)"
    {
        if [ -n "$preferred" ]; then
            printf '%s\n' "$models" | grep -Fx -- "$preferred" || true
        fi
        printf '%s\n' "$models" | grep -Fvx -- "$preferred" || true
    } | grep -v '^$' | head -n "$FREE_MODEL_ATTEMPTS"
}

# opencode config for the free-model runs. `opencode run` is a full agent, and
# a non-interactive run auto-approves every tool the config allows (a global
# "permission": "allow" allows all of them). The prompt carries commit
# messages, which are untrusted text, so every tool that can run commands or
# code, write, fetch, ask, or leave the working directory is denied (checked
# live: a prompt-injected "touch" ran under the default config). Denying "*"
# instead is rejected by the free tier (HTTP 403 FreeTierError), so glob, grep
# and read stay, confined to an empty directory by external_directory.
CHANGELOG_OPENCODE_CONFIG='{"permission":{"bash":"deny","edit":"deny","webfetch":"deny","websearch":"deny","external_directory":"deny","task":"deny","skill":"deny","execute":"deny","question":"deny"}}'

# Zen's free tier rejects direct API calls (HTTP 403 FreeTierError: "can only
# be used from within OpenCode"), so the free models go through the opencode
# CLI, with CHANGELOG_OPENCODE_CONFIG, from an empty working directory.
# The prompt goes on stdin (too big for argv, see call_chat_completions), which
# also keeps the CLI off the model list the caller loops over on its stdin.
# release.sh exports .env, and the CLI reads OPENCODE_API_KEY and
# OPENCODE_BASE_URL from the environment; a bad key there (the same one that
# just failed on Go) fails every free call with "Reconnect OpenCode Console to
# continue." So the CLI runs without them, on its own stored login.
# Args: model id (no provider prefix), prompt. Prints the reply text, one text
# part per line group. On failure logs one warning with the reason.
call_opencode_cli() {
    local model="$1" prompt="$2"
    (
        started=$SECONDS
        tmp="$(mktemp -d)" || exit 1
        # The temp dir goes even on Ctrl-C, likely here since there is no time
        # limit: bash runs the EXIT trap when a signal ends the subshell.
        trap 'rm -rf "$tmp"' EXIT
        mkdir "$tmp/cwd" && cd "$tmp/cwd" || exit 1
        # stdout and stderr stay apart: stderr lines interleaved into the JSON
        # stream could split a large event and silently drop it.
        env -u OPENCODE_API_KEY -u OPENCODE_BASE_URL OPENCODE_CONFIG_CONTENT="$CHANGELOG_OPENCODE_CONFIG" \
            opencode run --standalone -m "opencode/$model" --format json \
            <<< "$prompt" > "$tmp/out" 2> "$tmp/err"
        status=$?
        error="$(jq -Rr 'fromjson? | objects | select(.type == "error") | .error.message // .error.type // "error"' \
            < "$tmp/out" 2>/dev/null | head -n 1)"
        if [ "$status" -ne 0 ] || [ -n "$error" ]; then
            print_warning "AI changelog: $model failed after $((SECONDS - started))s (exit $status): ${error:-$(tail -c 500 "$tmp/err")}" >&2
            exit 1
        fi
        # An agent run can emit several text parts (narration, then the answer);
        # keep them apart so extract_changelog_section can find the "### " line.
        jq -Rrn '[inputs | fromjson? | objects | select(.type == "text") | .part.text // empty] | join("\n")' \
            < "$tmp/out" 2>/dev/null
    )
}

# Fallback for when OpenCode Go fails (quota, outage, bad reply): try Zen's free
# models one by one until one returns a real changelog section. No time limit:
# free models can be slow, so every attempt logs before and after instead.
generate_with_free_models() {
    local prompt="$1" models model result started attempt=0 total found
    if ! command -v opencode >/dev/null 2>&1; then
        print_warning "AI changelog: opencode CLI not found; cannot try the free models." >&2
        return 1
    fi
    print_status "AI changelog: fetching free models from OpenCode Zen..." >&2
    models="$(fetch_free_models)" || return 1
    found="$(printf '%s' "$models" | grep -c . || true)"
    models="$(printf '%s\n' "$models" | order_free_models "${CHANGELOG_AI_MODEL:-}")"
    if [ -z "$models" ]; then
        print_warning "AI changelog: OpenCode Zen lists no free models." >&2
        return 1
    fi
    total="$(printf '%s\n' "$models" | wc -l | tr -d ' ')"
    print_status "AI changelog: $found free models found; trying up to $total: $(printf '%s' "$models" | paste -sd ' ' -)" >&2
    while IFS= read -r model; do
        attempt=$((attempt + 1))
        print_status "AI changelog: attempt $attempt/$total, $model (free, may be slow)..." >&2
        started=$SECONDS
        # On failure call_opencode_cli has already logged why and how long.
        result="$(call_opencode_cli "$model" "$prompt")" || continue
        if is_changelog_section "$result"; then
            print_status "AI changelog: written by $model (OpenCode Zen, free) in $((SECONDS - started))s." >&2
            printf '%s' "$result"
            return 0
        fi
        print_warning "AI changelog: $model replied without a '### ' section after $((SECONDS - started))s." >&2
    done <<< "$models"
    return 1
}

# Any other OpenAI-compatible /chat/completions endpoint (OpenAI, OpenRouter, ...).
generate_with_openai() {
    local prompt="$1"
    if [ -z "${OPENAI_API_KEY:-}" ]; then
        print_warning "CHANGELOG_AI_PROVIDER=openai but OPENAI_API_KEY is not set." >&2
        return 1
    fi
    local base_url="${OPENAI_BASE_URL:-https://api.openai.com/v1}"
    local model="${CHANGELOG_AI_MODEL:-gpt-4o-mini}"
    call_chat_completions "$base_url" "$OPENAI_API_KEY" "$model" "$prompt"
}

# Returns the changelog section body (the "### ..." blocks, no version header).
generate_changelog() {
    local range="$1"
    local provider="${CHANGELOG_AI_PROVIDER:-}"
    # author: who wrote the section, for the closing log line. Left empty when
    # generate_with_free_models already logged it (it runs in a subshell, so it
    # cannot hand the winning model back any other way).
    local prompt result author=""

    if [ -n "$provider" ]; then
        prompt="$(build_ai_prompt "$range")"
        case "$provider" in
            opencode)
                result="$(generate_with_opencode "$prompt")" || result=""
                author="${CHANGELOG_AI_MODEL:-} on OpenCode Go"
                if ! is_changelog_section "$result"; then
                    [ -n "$result" ] &&
                        print_warning "AI changelog: OpenCode Go replied without a '### ' section." >&2
                    result="$(generate_with_free_models "$prompt")" || result=""
                    author=""
                fi
                ;;
            openai)
                result="$(generate_with_openai "$prompt")" || result=""
                author="${CHANGELOG_AI_MODEL:-gpt-4o-mini} via provider 'openai'"
                ;;
            *)
                print_warning "Unknown CHANGELOG_AI_PROVIDER '$provider'; using fallback." >&2
                result=""
                ;;
        esac
        # Require a real section ("### ") and drop anything the model put
        # around it.
        if is_changelog_section "$result"; then
            [ -n "$author" ] && print_status "AI changelog: written by $author." >&2
            extract_changelog_section "$result"
            return 0
        fi
        print_warning "AI changelog unavailable; falling back to a grouped commit list." >&2
    fi

    generate_fallback_changelog "$range"
}

# --- The changelog file ----------------------------------------------------
#
# Preamble written when the changelog file does not exist yet. It is the only
# hardcoded preamble: an existing file keeps its own, so a translated header is
# never overwritten when a new Release is inserted.
CHANGELOG_DEFAULT_HEADER="# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
"

# Prints the latest Release section of a changelog file without its "## ["
# heading line, as the GitHub Release body. Stops at the next "## [" heading and
# keeps the blank lines before it, so the body stays byte-identical to
# `awk '/^## \[/{c++} c==1' file | tail -n +2`; stops at the closing
# "> Older releases are listed ..." blockquote too, dropping the blank lines
# before it. Prints nothing when the file is missing, which leaves the release
# on GitHub's generated notes.
changelog_latest_release_body() {
    local file="$1"
    [ -f "$file" ] || return 0
    # Blank lines are buffered instead of printed: only the ones before the
    # closing note must go, while a section that ends at the next heading keeps
    # its trailing blank line. END flushes them unless the note stopped us.
    awk '
        /^## \[/ { if (seen) exit; seen = 1; next }
        !seen { next }
        /^> Older releases are listed/ { at_note = 1; exit }
        /^[[:space:]]*$/ { blank = blank "\n"; next }
        { if (blank != "") { printf "%s", blank; blank = "" } print }
        END { if (!at_note) printf "%s", blank }
    ' "$file"
}

# Inserts a Release section at the top of a changelog file, right after its
# existing preamble (everything before the first "## [" heading), and keeps the
# rest of the file byte-for-byte, closing note included. The header is used only
# to create the file when it is missing.
# Args: file, new entry ("## [version] - date" plus its body), [header].
changelog_insert_release() {
    local file="$1" entry="$2"
    local header="${3:-$CHANGELOG_DEFAULT_HEADER}"
    local first tmp

    if [ ! -f "$file" ]; then
        {
            printf '%s\n' "$header"
            printf '%s\n' "$entry"
        } > "$file"
        return 0
    fi

    first="$(grep -n -m1 '^## \[' "$file" | cut -d: -f1 || true)"
    tmp="$(mktemp)"

    if [ -n "$first" ]; then
        head -n "$((first - 1))" "$file" > "$tmp"
    else
        cat "$file" > "$tmp"
    fi

    # One blank line between the preamble and the new heading: add the missing
    # part. (A last line without a trailing newline gets one first.)
    if [ -s "$tmp" ]; then
        [ -n "$(tail -c 1 "$tmp")" ] && printf '\n' >> "$tmp"
        [ -n "$(tail -n 1 "$tmp")" ] && printf '\n' >> "$tmp"
    fi

    {
        printf '%s\n\n' "$entry"
        if [ -n "$first" ]; then
            tail -n +"$first" "$file"
        fi
    } >> "$tmp"

    mv "$tmp" "$file"
}
