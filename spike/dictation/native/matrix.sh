#!/bin/bash
# PROTOTYPE. Runs the native spike over a WAV for each model / threading /
# transcription_interval combination and prints one row each, with the
# onset-based first-partial lag from onsets.py.
#   native/matrix.sh <model> <wav> [interval ...]
set -e
here="$(cd "$(dirname "$0")/.." && pwd)"
bin="$here/native/target/release/dictation-spike"
model=$1; wav=$2; shift 2
arch=tiny; [[ $model == small* ]] && arch=small
for st in ${SPIKE_ST:-0 1}; do for iv in "${@:-0.5}"; do
  out="$here/results/native-$model-st$st-iv$iv.json"
  MOONSHINE_ORT_SINGLE_THREAD=$st "$bin" "$here/public/models/$model" $arch "$wav" transcription_interval=$iv 2>/dev/null > "$out"
  python3 - "$out" "$wav" "$st" "$iv" <<'PY'
import json, subprocess, sys
out, wav, st, iv = sys.argv[1:]
s = json.load(open(out))["summary"]
o = json.loads(subprocess.check_output(["python3", sys.path[0] + "/../onsets.py" if False else out.rsplit("/results/",1)[0] + "/onsets.py", wav, out]))
print(f"single_thread={st} interval={iv}: cpu={s['cpuPctOfOneCore']}% passP95={s['passMs']['p95']}ms "
      f"firstPartialFromOnset={o['firstPartialFromTrueOnsetSec']} final={s['finalMs']} engine={s['engineFinalMs']} rssPeak={s['rssMB']['peak']}MB lines={s['lines']}")
PY
done; done
