# PROTOTYPE. Ground-truth speech onsets for a 16 kHz mono WAV, by frame energy:
# 20 ms frames, speech = frame RMS above 10% of the file's 95th percentile RMS,
# an onset = speech after at least 300 ms of non-speech. Then, for a
# results/web-*.json trace, reports the engine's first-partial lag measured from
# the true onset rather than from line.startTime (which includes VAD look-behind).
import json, sys, wave, struct, statistics

wav, result = sys.argv[1], sys.argv[2]
w = wave.open(wav)
rate, n = w.getframerate(), w.getnframes()
pcm = struct.unpack(f"<{n}h", w.readframes(n))
frame = rate // 50
rms = [(sum(x * x for x in pcm[i:i + frame]) / frame) ** 0.5 for i in range(0, n - frame, frame)]
thr = 0.10 * sorted(rms)[int(0.95 * len(rms))]
onsets, quiet = [], 99
for i, r in enumerate(rms):
    if r > thr:
        if quiet >= 15:
            onsets.append(i * 0.02)
        quiet = 0
    else:
        quiet += 1

trace = json.load(open(result))["trace"]
lags, look = [], []
for t in trace:
    if t.get("firstTextAudio") is None:
        continue
    # Only lines that begin at a true onset (within 0.8 s of the engine's start,
    # which sits up to the VAD look-behind before it). Lines the engine split
    # mid-speech, with no silence before them, have no onset to measure from.
    cands = [o for o in onsets if t["start"] - 0.3 <= o <= t["start"] + 0.8]
    if not cands:
        continue
    onset = cands[-1]
    lags.append(t["firstTextAudio"] - onset)
    look.append(onset - t["start"])
q = lambda xs, p: round(sorted(xs)[min(len(xs) - 1, int(p * len(xs)))], 2)
print(json.dumps({
    "file": wav.split("/")[-1], "onsets": len(onsets), "linesAtOnset": len(lags), "linesTotal": len(trace),
    "firstPartialFromTrueOnsetSec": {"p50": q(lags, 0.5), "p95": q(lags, 0.95), "min": q(lags, 0)},
    "trueOnsetMinusLineStartSec": {"p50": q(look, 0.5)},
}))
