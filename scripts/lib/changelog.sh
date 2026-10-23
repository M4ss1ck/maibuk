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
#
# Finally it translates a finished English section into every other app
# language (ADR 0034), one changelog file per language. A translation that
# cannot be produced fails the release before anything is written: there is no
# English-only release.

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
# models one by one until one returns a reply the caller accepts. No time limit:
# free models can be slow, so every attempt logs before and after.
# Args: prompt, [accept function]. The accept function gets the raw reply and
# decides whether it is usable; it defaults to is_changelog_section, and the
# translation path passes one that also compares the structure with English.
generate_with_free_models() {
    local prompt="$1" accept="${2:-is_changelog_section}"
    local models model result started attempt=0 total found
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
        if "$accept" "$result"; then
            print_status "AI changelog: written by $model (OpenCode Zen, free) in $((SECONDS - started))s." >&2
            printf '%s' "$result"
            return 0
        fi
        print_warning "AI changelog: $model replied with an unusable section after $((SECONDS - started))s." >&2
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

# --- Localized Release Notes (ADR 0034) ------------------------------------
#
# Every Release ships every app language: the finished English section is
# translated one to one into each other language, and each language keeps its
# own changelog file after its own preamble. The translated files are never
# created here; a missing one is an error, since its header is hand-written.

# The app languages live where the app's translations do; UI term pairs come
# from the glossary's `_UI_` lines.
CHANGELOG_LOCALES_DIR="${CHANGELOG_LOCALES_DIR:-src/locales}"
CHANGELOG_GLOSSARY="${CHANGELOG_GLOSSARY:-GLOSSARY.md}"

# Every app language that is not English, one per line, in file order.
changelog_languages() {
    local dir="${1:-$CHANGELOG_LOCALES_DIR}" file
    for file in "$dir"/*.json; do
        [ -f "$file" ] || continue
        file="${file##*/}"
        file="${file%.json}"
        [ "$file" = "en" ] && continue
        printf '%s\n' "$file"
    done | sort
}

# The changelog file a language ships: CHANGELOG.md for English.
changelog_file() {
    if [ "$1" = "en" ]; then
        printf 'CHANGELOG.md\n'
    else
        printf 'CHANGELOG.%s.md\n' "$1"
    fi
}

# Every changelog file a Release touches: English first, then each language.
changelog_files() {
    local locale
    changelog_file en
    for locale in $(changelog_languages); do
        changelog_file "$locale"
    done
}

# Human-readable language name for the prompt. Node's Intl knows every code
# the app ships; without node, or for a code it rejects, the code stands for
# itself, which still names the target language unambiguously.
changelog_language_name() {
    local code="$1" name=""
    if command -v node >/dev/null 2>&1; then
        name="$(node -e '
            try {
                const name = new Intl.DisplayNames(["en"], { type: "language" }).of(process.argv[1]);
                if (name) process.stdout.write(name);
            } catch {
                process.exit(1);
            }
        ' "$code" 2>/dev/null)" || name=""
    fi
    if [ -n "$name" ]; then
        printf '%s\n' "$name"
    else
        printf '%s\n' "$code"
    fi
}

# Prints "English<TAB>translation" for every UI term pair the glossary pins for
# this language, in file order. A `_UI_` line holds one or more
# "en \"...\" / es \"...\"" groups separated by ";"; a group missing either
# side is skipped, and lists are paired by position. Nothing else on the line
# (a note after the labels, a "(known mismatch)" marker) is read.
changelog_glossary_pairs() {
    local glossary="${1:-$CHANGELOG_GLOSSARY}" locale="$2"
    [ -f "$glossary" ] || return 0
    awk -v lang="$locale" '
        function strings(text,    out, s) {
            out = ""
            while (match(text, /"[^"]*"/)) {
                s = substr(text, RSTART + 1, RLENGTH - 2)
                out = out (out == "" ? "" : "\001") s
                text = substr(text, RSTART + RLENGTH)
            }
            return out
        }
        /^_UI_: / {
            groups = split(substr($0, 7), parts, ";")
            for (g = 1; g <= groups; g++) {
                group = parts[g]
                en_at = index(group, "en \"")
                lg_at = index(group, lang " \"")
                if (en_at == 0 || lg_at == 0) continue
                # Each side stops where the other starts, so quoted labels
                # never leak into the other language list.
                if (en_at < lg_at) {
                    en_text = substr(group, en_at, lg_at - en_at)
                    lg_text = substr(group, lg_at)
                } else {
                    lg_text = substr(group, lg_at, en_at - lg_at)
                    en_text = substr(group, en_at)
                }
                en_list = strings(en_text)
                lg_list = strings(lg_text)
                if (en_list == "" || lg_list == "") continue
                n_en = split(en_list, ens, "\001")
                n_lg = split(lg_list, lgs, "\001")
                for (i = 1; i <= n_en && i <= n_lg; i++)
                    printf "%s\t%s\n", ens[i], lgs[i]
            }
        }
    ' "$glossary"
}

# The shape the parity guard compares: every "### Kind" with its item count, in
# order. Two sections of the same kind stay separate, so a repetition cannot
# cancel out.
changelog_structure_signature() {
    printf '%s\n' "$1" | awk '
        /^### / {
            if (seen) print kind "\t" count
            kind = substr($0, 5); count = 0; seen = 1; next
        }
        /^- / { count++ }
        END { if (seen) print kind "\t" count }
    '
}

# Whether a provider's reply is the English section's translation: after the
# same extraction the generated section goes through, its kinds and item counts
# must equal the English ones. Reads CHANGELOG_ENGLISH_STRUCTURE, set by
# translate_changelog so the accept callback can compare across the provider
# chain's subshells.
changelog_translation_ok() {
    local cleaned
    [ -n "${CHANGELOG_ENGLISH_STRUCTURE:-}" ] || return 1
    cleaned="$(extract_changelog_section "$1")"
    [ -n "$cleaned" ] || return 1
    [ "$(changelog_structure_signature "$cleaned")" = "$CHANGELOG_ENGLISH_STRUCTURE" ]
}

# Build the prompt that translates one Release section into one language. The
# glossary pairs carry the shipped UI labels, so a translated bullet uses the
# same words as the screen it describes.
build_translation_prompt() {
    local english="$1" locale="$2" language pairs
    language="$(changelog_language_name "$locale")"
    pairs="$(changelog_glossary_pairs "$CHANGELOG_GLOSSARY" "$locale" |
        awk -F '\t' 'NF >= 2 { printf "- \"%s\" -> \"%s\"\n", $1, $2 }')"
    [ -z "$pairs" ] && pairs="- (none recorded)"
    cat <<EOF
You are translating the Release Notes for version $VERSION of "Maibuk", a desktop
writing app, from English into $language. Translate the section below and
nothing else.

Rules:
- Keep every "### Kind" line unchanged; do not translate the section headings.
- Keep backticked code and every link target unchanged.
- Output exactly one translated bullet for every English bullet, in the same order.
- Keep the same sections in the same order as the English section.
- Do not add prose, notes or code fences before or after the sections.

UI term pairs (English -> target language), use the translated term:
$pairs

English section:
$english
EOF
}

# Tries the configured provider chain in order — OpenCode Go, then OpenCode
# Zen's free models (or the single `openai` provider) — until the accept
# function takes a reply. Args: prompt, accept function. Prints the accepted
# reply. The accept function only sees the reply; translators set
# CHANGELOG_ENGLISH_STRUCTURE before calling.
generate_with_provider_chain() {
    local prompt="$1" accept="$2" provider="${CHANGELOG_AI_PROVIDER:-}" result
    case "$provider" in
        opencode)
            result="$(generate_with_opencode "$prompt")" || result=""
            if "$accept" "$result"; then
                printf '%s' "$result"
                return 0
            fi
            [ -n "$result" ] &&
                print_warning "AI changelog: OpenCode Go replied with a section that does not match; trying the free models." >&2
            result="$(generate_with_free_models "$prompt" "$accept")" || result=""
            if "$accept" "$result"; then
                printf '%s' "$result"
                return 0
            fi
            ;;
        openai)
            result="$(generate_with_openai "$prompt")" || result=""
            if "$accept" "$result"; then
                printf '%s' "$result"
                return 0
            fi
            ;;
        "")
            print_warning "AI changelog: no CHANGELOG_AI_PROVIDER is configured; cannot translate." >&2
            ;;
        *)
            print_warning "Unknown CHANGELOG_AI_PROVIDER '$provider'; cannot translate." >&2
            ;;
    esac
    return 1
}

# Translates one English section into one language. Prints the cleaned
# translated section, or returns non-zero when no provider produced a reply
# with the English structure.
translate_changelog() {
    local english="$1" locale="$2" prompt reply
    prompt="$(build_translation_prompt "$english" "$locale")"
    CHANGELOG_ENGLISH_STRUCTURE="$(changelog_structure_signature "$english")"
    print_status "AI changelog: translating into '$locale'..." >&2
    reply="$(generate_with_provider_chain "$prompt" changelog_translation_ok)" || return 1
    extract_changelog_section "$reply"
}

# Translates the English section into every other app language and writes each
# translated body to <dir>/<locale>. Nothing is written to the repo, so a
# failure leaves it untouched. Fails, naming the language, when that language's
# changelog file is missing (checked before any AI call) or when every provider
# failed for it.
# Args: English section, output dir.
translate_changelog_all() {
    local english="$1" dir="$2" locale languages translated
    languages="$(changelog_languages)"
    if [ -z "$languages" ]; then
        print_warning "No app language other than English; nothing to translate." >&2
        return 0
    fi
    for locale in $languages; do
        if [ ! -f "$(changelog_file "$locale")" ]; then
            print_warning "Missing changelog file $(changelog_file "$locale") for language '$locale'. A translated changelog is never created; add it (or remove the locale) first." >&2
            return 1
        fi
    done
    for locale in $languages; do
        if ! translated="$(translate_changelog "$english" "$locale")"; then
            print_warning "Could not translate the Release Notes into '$locale': every AI provider failed or replied with a different structure." >&2
            return 1
        fi
        printf '%s\n' "$translated" > "$dir/$locale"
    done
}

# Prints the translated entries for the dry run, each under its language code.
# Args: translations dir, version, date.
changelog_print_translations() {
    local dir="$1" version="$2" date="$3" locale
    for locale in $(changelog_languages); do
        printf '\n[%s]\n\n%s\n' "$locale" \
            "## [$version] - $date"$'\n\n'"$(cat "$dir/$locale")"
    done
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

# Inserts the English Release and every translated one into its language's
# changelog file, after each file's own preamble. Translated files never get the
# default header: they must already exist.
# Args: translations dir, version, date, English section.
changelog_insert_releases() {
    local dir="$1" version="$2" date="$3" english="$4" locale entry
    changelog_insert_release "$(changelog_file en)" "## [$version] - $date"$'\n\n'"$english"
    for locale in $(changelog_languages); do
        entry="$(cat "$dir/$locale")"
        changelog_insert_release "$(changelog_file "$locale")" "## [$version] - $date"$'\n\n'"$entry"
    done
}
