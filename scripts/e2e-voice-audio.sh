#!/usr/bin/env bash
# Synthesizes the E2E Voice Command audio (vendor/moonshine/e2e-voice/<name>.wav):
# a tiny phrase list spoken by Piper, so the Chromium fake microphone can drive
# the Voice Command spec. This is text to speech, not the author's voice.
#
#   pnpm e2e:voice-audio
#
# Then run `pnpm test:e2e specs/voice-commands-app.spec.ts`. Idempotent: existing
# files are left alone, so only the phrases that are missing get synthesized.
set -euo pipefail

cd "$(dirname "$0")/.."

VENV_DIR=".cache/piper-venv"
VOICES_DIR=".cache/piper-voices"
OUT_DIR="vendor/moonshine/e2e-voice"

# The fake microphone plays one WAV per browser launch; the spec swaps in
# dark-theme.wav to speak a Voice Command. `name|voice|text|pre_seconds|post_seconds`
# (silence paddings default to 0.5|3 for existing entries). Focus-key entries
# carry a long pre-padding so the keyboard setup finishes before the first
# phrase, and a long post-padding so the looping fake mic never repeats a
# phrase inside a test.
PHRASES=(
  "dark-theme|en_US-lessac-medium|Dark theme."
  "go-to-notes|en_US-lessac-medium|Go to Notes.|45|30"
  "focus-next|en_US-lessac-medium|Press the tab key.|45|30"
  "focus-previous|en_US-lessac-medium|Press shift tab key.|45|30"
  "focus-up|en_US-lessac-medium|Press Up.|45|30"
  "focus-down|en_US-lessac-medium|Press Down.|45|30"
  "focus-left|en_US-lessac-medium|Press Left.|45|30"
  "focus-right|en_US-lessac-medium|Press Right.|45|30"
  "focus-first|en_US-lessac-medium|Press Home.|45|30"
  "focus-last|en_US-lessac-medium|Press End.|45|30"
  "focus-activate|en_US-lessac-medium|Press enter key.|45|30"
  "focus-toggle|en_US-lessac-medium|Press Space.|45|30"
  "focus-escape|en_US-lessac-medium|Press Escape.|45|30"
  "go-to-settings|en_US-lessac-medium|Go to Settings.|45|30"
  "show-voice-commands|en_US-lessac-medium|Show voice commands.|45|30"
  "click-book-settings|en_US-lessac-medium|Click Book Settings.|70|30"
  "click-cancel|en_US-lessac-medium|Click Cancel.|70|30"
)

# Compound phrases for the navigation hand-off spec (issue #320): a Voice
# Command, a spoken gap, then a dictated sentence, played once per browser
# launch. `name|voice|command_text|gap_seconds|sentence_text|pre|post` (the
# silence paddings default to 45|30 like the focus-key entries, so the model
# download and keyboard setup finish before the command speaks). A three-part
# entry appends a second gap and a closing command:
# `name|voice|command_text|gap_seconds|sentence_text|gap2_seconds|third_text|pre|post`
# (issue #313: the dictated sentence lands in a plain text field, then a focus
# Voice Command submits its dialog).
COMPOUND_PHRASES=(
  "go-to-ephemeral-handoff|en_US-lessac-medium|Go to Ephemeral.|2|The sea was calm.|45|30"
  "click-bold-then-one|en_US-lessac-medium|Click Bold.|3|Click one.|70|30"
  "go-to-projects-new-book|en_US-lessac-medium|Go to Books.|5|The silent harbor.|4|Press enter key.|45|30"
)

# The voices the phrase list references.
VOICES=(
  "en_US-lessac-medium"
  "es_ES-davefx-medium"
)

python_bin="$VENV_DIR/bin/python"

if [ ! -x "$python_bin" ]; then
  echo "Creating the Piper virtualenv at $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi

if ! "$python_bin" -c "import piper" >/dev/null 2>&1; then
  echo "Installing piper-tts"
  "$python_bin" -m pip install --quiet --upgrade pip
  "$python_bin" -m pip install --quiet piper-tts
fi

mkdir -p "$VOICES_DIR"
for voice in "${VOICES[@]}"; do
  if [ ! -f "$VOICES_DIR/$voice.onnx" ]; then
    echo "Downloading the $voice voice"
    "$python_bin" -m piper.download_voices --data-dir "$VOICES_DIR" "$voice"
  fi
done

mkdir -p "$OUT_DIR"
for entry in "${PHRASES[@]}"; do
  IFS='|' read -r name voice text pre_seconds post_seconds <<<"$entry"
  pre_seconds="${pre_seconds:-0.5}"
  post_seconds="${post_seconds:-3}"
  out="$OUT_DIR/$name.wav"
  if [ -f "$out" ]; then
    echo "Keeping $out"
    continue
  fi
  echo "Synthesizing $out (\"$text\", +${pre_seconds}s/+${post_seconds}s)"
  raw="$(mktemp --suffix=.wav)"
  printf '%s\n' "$text" |
    "$python_bin" -m piper -m "$voice" --data-dir "$VOICES_DIR" -f "$raw"
  # 16 kHz mono s16, silence before and after: the Dictation Session needs a
  # moment to start listening, and a trailing pause closes the line.
  pre_ms="$(python3 -c "print(int(float('$pre_seconds') * 1000))")"
  ffmpeg -y -loglevel error -i "$raw" -af "adelay=${pre_ms},apad=pad_dur=${post_seconds}" -ar 16000 -ac 1 "$out"
  rm -f "$raw"
done

for entry in "${COMPOUND_PHRASES[@]}"; do
  # Three-part entries carry a second gap and a closing command; two-part
  # entries keep their exact parsing and synthesis below.
  IFS='|' read -ra compound_parts <<<"$entry"
  if [ "${#compound_parts[@]}" -eq 9 ]; then
    IFS='|' read -r name voice command_text gap_seconds sentence_text gap2_seconds third_text pre_seconds post_seconds <<<"$entry"
    pre_seconds="${pre_seconds:-45}"
    post_seconds="${post_seconds:-30}"
    out="$OUT_DIR/$name.wav"
    if [ -f "$out" ]; then
      echo "Keeping $out"
      continue
    fi
    echo "Synthesizing $out (\"$command_text\" +${gap_seconds}s \"$sentence_text\" +${gap2_seconds}s \"$third_text\", +${pre_seconds}s/+${post_seconds}s)"
    raw_command="$(mktemp --suffix=.wav)"
    raw_sentence="$(mktemp --suffix=.wav)"
    raw_third="$(mktemp --suffix=.wav)"
    printf '%s\n' "$command_text" |
      "$python_bin" -m piper -m "$voice" --data-dir "$VOICES_DIR" -f "$raw_command"
    printf '%s\n' "$sentence_text" |
      "$python_bin" -m piper -m "$voice" --data-dir "$VOICES_DIR" -f "$raw_sentence"
    printf '%s\n' "$third_text" |
      "$python_bin" -m piper -m "$voice" --data-dir "$VOICES_DIR" -f "$raw_third"
    # One take: the command, a spoken gap of silence (the recognizer closes
    # the command's line in it), then the sentence, another gap, then the
    # closing command, with leading silence for the setup and trailing
    # silence so the looping fake mic never repeats a phrase inside a test.
    pre_ms="$(python3 -c "print(int(float('$pre_seconds') * 1000))")"
    ffmpeg -y -loglevel error -i "$raw_command" -i "$raw_sentence" -i "$raw_third" \
      -f lavfi -i "anullsrc=r=16000:cl=mono:d=${gap_seconds}" \
      -f lavfi -i "anullsrc=r=16000:cl=mono:d=${gap2_seconds}" \
      -filter_complex "[0:a]aresample=16000[a0];[1:a]aresample=16000[a1];[2:a]aresample=16000[a2];[3:a]aresample=16000[g1];[4:a]aresample=16000[g2];[a0][g1][a1][g2][a2]concat=n=5:v=0:a=1,adelay=${pre_ms},apad=pad_dur=${post_seconds}[out]" \
      -map "[out]" -ar 16000 -ac 1 "$out"
    rm -f "$raw_command" "$raw_sentence" "$raw_third"
    continue
  fi
  IFS='|' read -r name voice command_text gap_seconds sentence_text pre_seconds post_seconds <<<"$entry"
  pre_seconds="${pre_seconds:-45}"
  post_seconds="${post_seconds:-30}"
  out="$OUT_DIR/$name.wav"
  if [ -f "$out" ]; then
    echo "Keeping $out"
    continue
  fi
  echo "Synthesizing $out (\"$command_text\" +${gap_seconds}s \"$sentence_text\", +${pre_seconds}s/+${post_seconds}s)"
  raw_command="$(mktemp --suffix=.wav)"
  raw_sentence="$(mktemp --suffix=.wav)"
  printf '%s\n' "$command_text" |
    "$python_bin" -m piper -m "$voice" --data-dir "$VOICES_DIR" -f "$raw_command"
  printf '%s\n' "$sentence_text" |
    "$python_bin" -m piper -m "$voice" --data-dir "$VOICES_DIR" -f "$raw_sentence"
  # One take: the command, a spoken gap of silence (the recognizer closes the
  # command's line in it), then the sentence, with leading silence for the
  # setup and trailing silence so the looping fake mic never repeats a phrase
  # inside a test.
  pre_ms="$(python3 -c "print(int(float('$pre_seconds') * 1000))")"
  ffmpeg -y -loglevel error -i "$raw_command" -i "$raw_sentence" \
    -f lavfi -i "anullsrc=r=16000:cl=mono:d=${gap_seconds}" \
    -filter_complex "[0:a]aresample=16000[a0];[1:a]aresample=16000[a1];[2:a]aresample=16000[a2];[a0][a2][a1]concat=n=3:v=0:a=1,adelay=${pre_ms},apad=pad_dur=${post_seconds}[out]" \
    -map "[out]" -ar 16000 -ac 1 "$out"
  rm -f "$raw_command" "$raw_sentence"
done

echo "E2E voice audio ready in $OUT_DIR"
