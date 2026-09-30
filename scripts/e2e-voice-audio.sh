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
# dark-theme.wav to speak a Voice Command. `name|voice|text`.
PHRASES=(
  "dark-theme|en_US-lessac-medium|Dark theme."
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
  IFS='|' read -r name voice text <<<"$entry"
  out="$OUT_DIR/$name.wav"
  if [ -f "$out" ]; then
    echo "Keeping $out"
    continue
  fi
  echo "Synthesizing $out (\"$text\")"
  raw="$(mktemp --suffix=.wav)"
  printf '%s\n' "$text" |
    "$python_bin" -m piper -m "$voice" --data-dir "$VOICES_DIR" -f "$raw"
  # 16 kHz mono s16, half a second of silence before, three seconds after: the
  # Dictation Session needs a moment to start listening, and a trailing pause
  # closes the line.
  ffmpeg -y -loglevel error -i "$raw" -af "adelay=500,apad=pad_dur=3" -ar 16000 -ac 1 "$out"
  rm -f "$raw"
done

echo "E2E voice audio ready in $OUT_DIR"
