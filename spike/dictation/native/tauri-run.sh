#!/bin/bash
# PROTOTYPE. One unattended run of the native engine inside the Maibuk Tauri
# shell (built with --features dictation-spike and a separate identifier, so
# an installed Maibuk's single-instance lock and app data are untouched).
#   native/tauri-run.sh "auto=1&model=tiny-streaming-en&source=two_cities_16k.wav&opt.transcription_interval=0.2"
# Writes results/tauri-<model>-<source>-st<0|1>.json via dictation_spike_report.
set -e
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/../.." && pwd)"
log="${TMPDIR:-/tmp}/dictation-spike"; mkdir -p "$log"
eval "$("$here/native/alsa-shim.sh")"
( cd "$repo/src-tauri" && TAURI_CONFIG='{"identifier":"com.massick.maibuk.spike","productName":"Maibuk Spike","build":{"devUrl":"http://localhost:5199"}}' \
  cargo build --features dictation-spike 2>&1 | tail -1 )
VITE_SPIKE_AUTO="$1" VITE_BUILD_TARGET=web setsid npx --prefix "$repo" vite --config "$here/vite.config.ts" > "$log/vite.log" 2>&1 &
vite=$!
# setsid gives Vite its own process group; kill the group so the node child
# does not keep port 5199.
trap 'kill -- -$vite $app 2>/dev/null || true' EXIT
for _ in $(seq 20); do curl -sf -o /dev/null http://localhost:5199/ && break; sleep 0.5; done
before=$(ls "$here"/results/tauri-*.json 2>/dev/null | xargs -r stat -c %Y | sort -n | tail -1)
LD_LIBRARY_PATH="$here/vendor/moonshine-linux/lib" "$repo/src-tauri/target/debug/maibuk" > "$log/tauri.log" 2>&1 &
app=$!
for _ in $(seq 120); do
  sleep 2
  latest=$(ls "$here"/results/tauri-*.json 2>/dev/null | xargs -r stat -c %Y | sort -n | tail -1)
  [ -n "$latest" ] && [ "$latest" != "$before" ] && break
  kill -0 $app 2>/dev/null || { echo "app exited:"; tail -20 "$log/tauri.log"; exit 1; }
done
ls -t "$here"/results/tauri-*.json | head -1
