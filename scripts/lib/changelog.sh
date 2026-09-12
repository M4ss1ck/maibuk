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
    local payload response status body
    payload="$(jq -n --arg model "$model" --arg content "$prompt" \
        '{model: $model, temperature: 0.3, messages: [{role: "user", content: $content}]}')"
    response="$(curl -sS -w $'\n%{http_code}' "$base_url/chat/completions" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        "$@" \
        -d "$payload" 2>&1)" || {
        print_warning "Could not reach $base_url: $response" >&2
        return 1
    }
    status="${response##*$'\n'}"
    body="${response%$'\n'*}"
    if [ "$status" != "200" ]; then
        print_warning "$base_url returned HTTP $status: $(printf '%s' "$body" | head -c 500)" >&2
        return 1
    fi
    printf '%s' "$body" | jq -r '.choices[0].message.content // empty'
}

# opencode Go (https://opencode.ai/docs/go) — an OpenAI-compatible API at
# https://opencode.ai/zen/go/v1. Model id is plain, e.g. "deepseek-v4-pro".
generate_with_opencode() {
    local prompt="$1"
    if [ -z "${OPENCODE_API_KEY:-}" ]; then
        print_warning "CHANGELOG_AI_PROVIDER=opencode but OPENCODE_API_KEY is not set." >&2
        return 1
    fi
    if [ -z "${CHANGELOG_AI_MODEL:-}" ]; then
        print_warning "CHANGELOG_AI_MODEL is not set (e.g. deepseek-v4-pro)." >&2
        return 1
    fi
    local base_url="${OPENCODE_BASE_URL:-https://opencode.ai/zen/go/v1}"
    # opencode Go rejects requests without x-opencode-session (HTTP 400
    # MissingSessionID). The docs ask for "a stable session ID for each
    # conversation"; one changelog is one conversation, so key it on the version
    # being released. Stable across retries of the same release, which also lets
    # their prompt cache hit on a second attempt.
    call_chat_completions "$base_url" "$OPENCODE_API_KEY" "$CHANGELOG_AI_MODEL" "$prompt" \
        -H "x-opencode-session: maibuk-changelog-${VERSION:-dev}"
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
    local prompt result

    if [ -n "$provider" ]; then
        prompt="$(build_ai_prompt "$range")"
        case "$provider" in
            opencode) result="$(generate_with_opencode "$prompt")" || result="" ;;
            openai)   result="$(generate_with_openai "$prompt")" || result="" ;;
            *)
                print_warning "Unknown CHANGELOG_AI_PROVIDER '$provider'; using fallback." >&2
                result=""
                ;;
        esac
        # Trim whitespace; require a real section ("### ") in the output.
        result="$(printf '%s' "$result" | sed -e 's/[[:space:]]*$//')"
        if [ -n "$result" ] && printf '%s' "$result" | grep -q '^### '; then
            print_status "Changelog generated with AI provider '$provider'." >&2
            printf '%s\n' "$result"
            return 0
        fi
        print_warning "AI changelog unavailable; falling back to a grouped commit list." >&2
    fi

    generate_fallback_changelog "$range"
}

