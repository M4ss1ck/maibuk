# PROTOTYPE. Builds the README's results tables from results/*.json, with the
# onset-based first-partial lag from onsets.py, so no number is copied by hand.
import glob, json, os, subprocess, sys, tempfile

AUDIO = {"en": "public/audio/two_cities_16k.wav", "es": "public/audio/quijote_es_16k.wav"}

def onset(trace_doc, lang):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(trace_doc, f)
    out = json.loads(subprocess.check_output([sys.executable, "onsets.py", AUDIO[lang], f.name]))
    os.unlink(f.name)
    return out["firstPartialFromTrueOnsetSec"]

def model_of(path):
    for m in ("tiny-streaming-en", "small-streaming-en", "tiny-streaming-es", "small-streaming-es"):
        if m in path:
            return m

rows = []
for path in sorted(glob.glob("results/web-*-i0.2-ti0.2.json")):
    d = json.load(open(path)); s = d["summary"]; m = model_of(path)
    fp = onset(d, m[-2:])
    rows.append(("Web (Chromium, WASM worker)", m, fp["p50"], fp["p95"], s["finalMs"]["p50"], s["finalMs"]["p95"],
                 f'{s["workerComputePct"]}% (worker pass time)', f'+{s["chromiumRssMB"]["delta"]} MB (browser total)',
                 s["loadMs"], s["longTasks"]["over50"], s["typing"]["durationMax"]))
for path in sorted(glob.glob("results/native-*-st1-iv0.2.json")):
    d = json.load(open(path)); s = d["summary"]; m = model_of(path)
    fp = onset(d, m[-2:])
    rows.append(("Linux native CLI (release)", m, fp["p50"], fp["p95"], s["finalMs"]["p50"], s["finalMs"]["p95"],
                 f'{s["cpuPctOfOneCore"]}% of one core', f'{s["rssMB"]["peak"]} MB peak RSS', s["loadMs"], "n/a", "n/a"))
for path in sorted(glob.glob("results/tauri-*-st1.json")):
    d = json.load(open(path)); s = d["native"]["summary"]; m = model_of(path)
    fp = onset(d["native"], m[-2:])
    rows.append(("Tauri shell, Linux (debug build)", m, fp["p50"], fp["p95"], s["finalMs"]["p50"], s["finalMs"]["p95"],
                 f'{s["cpuPctOfOneCore"]}% of one core (whole app)', f'{s["rssMB"]["peak"]} MB peak RSS (whole app)', s["loadMs"],
                 d["page"]["longTasks"]["over50"] if d["env"]["longtaskSupported"] else "API absent", "not driven"))

print("| Path | Model | First partial from onset p50 / p95 (s) | Final line p50 / p95 (ms) | Compute | Memory | Load (ms) | Long tasks > 50 ms | Typing event max (ms) |")
print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
for r in rows:
    print(f"| {r[0]} | {r[1]} | {r[2]} / {r[3]} | {r[4]} / {r[5]} | {r[6]} | {r[7]} | {r[8]} | {r[9]} | {r[10]} |")

print()
print("| Linux native, Tiny en | CPU (% of one core) | Pass p95 (ms) | First partial from onset p50 (s) | Final p50 / p95 (ms) |")
print("| --- | --- | --- | --- | --- |")
for st in (0, 1):
    for iv in ("0.5", "0.2"):
        path = f"results/native-tiny-streaming-en-st{st}-iv{iv}.json"
        if not os.path.exists(path):
            continue
        d = json.load(open(path)); s = d["summary"]
        fp = onset(d, "en")
        label = f'{"MOONSHINE_ORT_SINGLE_THREAD=1" if st else "default ORT threads"}, transcription_interval={iv}'
        print(f'| {label} | {s["cpuPctOfOneCore"]} | {s["passMs"]["p95"]} | {fp["p50"]} | {s["finalMs"]["p50"]} / {s["finalMs"]["p95"]} |')
