# Ground-truth speech onsets for the dictation conformance lane. Given a
# 16 kHz mono WAV, the onset detector is a direct port of the spike's:
# 20 ms frames, a frame is speech when its RMS is above 10% of the file's
# 95th-percentile frame RMS, and an onset is speech that follows at least
# 300 ms of non-speech.
#
# The matching rule to a trace is DIFFERENT from the spike's, because our trace
# entries carry no line `start`: for every entry with `firstTextAudio` not null,
# the candidate onsets are those in `(prevCompleted, firstTextAudio]`, where
# `prevCompleted` is the previous entry's `completedAudio` (`-inf` for the
# first entry); the LAST candidate is the onset and the lag is
# `firstTextAudio - onset`. Entries with no candidate began mid-speech and are
# skipped.
#
# Importable module + CLI:
#   python3 onsets.py <wav> <trace.json>
import json
import struct
import sys
import wave


def _frame_rms(wav_path):
    with wave.open(wav_path, "rb") as w:
        rate, n = w.getframerate(), w.getnframes()
        pcm = struct.unpack(f"<{n}h", w.readframes(n))
    frame = rate // 50
    return [
        (sum(x * x for x in pcm[i : i + frame]) / frame) ** 0.5
        for i in range(0, n - frame, frame)
    ]


def onsets(wav_path):
    """Speech onset times, in seconds, for a 16 kHz mono WAV."""
    rms = _frame_rms(wav_path)
    threshold = 0.10 * sorted(rms)[int(0.95 * len(rms))]
    found, quiet = [], 99
    for i, value in enumerate(rms):
        if value > threshold:
            if quiet >= 15:
                found.append(i * 0.02)
            quiet = 0
        else:
            quiet += 1
    return found


def first_partial_lags(wav_path, trace):
    """First-partial lags, in seconds, measured from the true speech onset.

    See the matching rule in the module comment: candidate onsets for an entry
    are those in ``(prevCompleted, firstTextAudio]`` and the last one wins.
    """
    known = onsets(wav_path)
    lags = []
    prev_completed = float("-inf")
    for entry in trace:
        first_text = entry.get("firstTextAudio")
        if first_text is not None:
            candidates = [o for o in known if prev_completed < o <= first_text]
            if candidates:
                lags.append(first_text - candidates[-1])
        completed = entry.get("completedAudio")
        if completed is not None:
            prev_completed = completed
    return lags


def quantile(xs, p):
    if not xs:
        return None
    ordered = sorted(xs)
    return ordered[min(len(ordered) - 1, int(p * len(ordered)))]


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        print("usage: onsets.py <wav> <trace.json>", file=sys.stderr)
        return 2
    wav_path, trace_path = argv
    with open(trace_path, encoding="utf-8") as f:
        doc = json.load(f)
    trace = doc.get("trace", []) if isinstance(doc, dict) else doc
    lags = first_partial_lags(wav_path, trace)
    print(
        json.dumps(
            {
                "file": wav_path.replace("\\", "/").split("/")[-1],
                "linesAtOnset": len(lags),
                "linesTotal": len(trace),
                "firstPartialFromTrueOnsetSec": {
                    "p50": None if not lags else round(quantile(lags, 0.5), 2),
                    "p95": None if not lags else round(quantile(lags, 0.95), 2),
                },
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
