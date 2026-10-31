#!/usr/bin/env python3
"""Phrase lane and simulated real-time control run for one sherpa-onnx candidate and language.

Usage (one candidate and one language per process, so peak memory is per model):

  <vendor>/.venv-sherpa/bin/python -I scripts/dictation-conformance/sherpa_phrases.py \
      <candidate id> <lang> [--threads N] [--vendor DIR] [--skip-control]

Writes VENDOR/conformance/phrases-<id>-<lang>.json and, unless --skip-control,
VENDOR/conformance/native-<id>-<lang>.json.
"""

import argparse
import json
import resource
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import sherpa_onnx

SAMPLE_RATE = 16000
CHUNK = 2560  # 160 ms at 16 kHz
TAIL_SILENCE_S = 1.0
VAD_FRAME = 320  # 20 ms at 16 kHz
VAD_MIN_SILENCE_S = 0.5  # non-speech that ends a line; main() sets it from --min-silence
OFFLINE_HANGOVER_S = 0.5
CONTROL_CLIPS = {"en": "two_cities_16k.wav", "es": "quijote_es_16k.wav"}

SCRIPT_DIR = Path(__file__).resolve().parent
REPO = Path(__file__).resolve().parents[2]
REPO_VENDOR = REPO / "vendor" / "moonshine"
FALLBACK_VENDOR = Path("/mnt/Data/Trabajo/native/maibuk/vendor/moonshine")
DEFAULT_VENDOR = REPO_VENDOR if REPO_VENDOR.is_dir() else FALLBACK_VENDOR


def load_candidate(candidate_id):
    data = json.loads((SCRIPT_DIR / "candidates.json").read_text(encoding="utf-8"))
    for cand in data["candidates"]:
        if cand["id"] == candidate_id:
            return cand
    known = ", ".join(c["id"] for c in data["candidates"])
    sys.exit(f"unknown candidate {candidate_id!r}; known: {known}")


def model_files(cand):
    if cand["kind"] == "offline-canary":
        return ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"]
    if cand["kind"] == "online-transducer":
        return ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]
    sys.exit(f"unsupported kind {cand['kind']!r} for {cand['id']}")


def build_recognizer(cand, lang, model_dir, threads):
    files = {name: str(model_dir / name) for name in model_files(cand)}
    if cand["kind"] == "offline-canary":
        return sherpa_onnx.OfflineRecognizer.from_nemo_canary(
            encoder=files["encoder.int8.onnx"],
            decoder=files["decoder.int8.onnx"],
            tokens=files["tokens.txt"],
            src_lang=lang,
            tgt_lang=lang,
            num_threads=threads,
        )
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=files["tokens.txt"],
        encoder=files["encoder.int8.onnx"],
        decoder=files["decoder.int8.onnx"],
        joiner=files["joiner.int8.onnx"],
        num_threads=threads,
        sample_rate=SAMPLE_RATE,
        enable_endpoint_detection=True,
        rule1_min_trailing_silence=2.4,
        rule2_min_trailing_silence=0.8,
        rule3_min_utterance_length=30,
        decoding_method="greedy_search",
    )


def read_wav(path):
    samples, sr = sf.read(str(path), dtype="float32")
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    if sr != SAMPLE_RATE:
        sys.exit(f"{path}: expected {SAMPLE_RATE} Hz, got {sr}")
    return np.ascontiguousarray(samples, dtype=np.float32)


def ms_since(t0):
    return (time.perf_counter() - t0) * 1000.0


def offline_decode(rec, samples):
    stream = rec.create_stream()
    stream.accept_waveform(SAMPLE_RATE, samples)
    rec.decode_stream(stream)
    return stream.result.text


def online_text(rec, stream):
    result = rec.get_result(stream)
    return result if isinstance(result, str) else result.text


def online_step(rec, stream, chunk):
    stream.accept_waveform(SAMPLE_RATE, chunk)
    while rec.is_ready(stream):
        rec.decode_stream(stream)


def tail_padded(samples):
    return np.concatenate([samples, np.zeros(int(TAIL_SILENCE_S * SAMPLE_RATE), dtype=np.float32)])


# ---------------------------------------------------------------- phrase lane


def phrase_offline(rec, path, whole_clip):
    """Without --whole-clip, a line per pause, as the app types an offline model's text."""
    samples = read_wav(path)
    lines = [samples] if whole_clip else [line_audio(samples, f, l) for f, l in vad_lines(samples)]
    finals, latencies = [], []
    t0 = time.perf_counter()
    for audio in lines:
        t_line = time.perf_counter()
        text = offline_decode(rec, audio).strip()
        if text:
            finals.append(text)
            latencies.append(round(ms_since(t_line), 2))
    return {
        "file": path.name,
        "finals": finals,
        "ms": round(ms_since(t0), 2),
        "latencies": latencies,
    }


def online_stream(rec, lang):
    # Nemotron reads a per-stream language (model card: "en", "es", "auto").
    stream = rec.create_stream()
    stream.set_option("language", lang)
    return stream


def phrase_online(rec, path, lang):
    samples = tail_padded(read_wav(path))
    stream = online_stream(rec, lang)
    finals, latencies = [], []
    t0 = time.perf_counter()
    for start in range(0, len(samples), CHUNK):
        ts = time.perf_counter()
        online_step(rec, stream, samples[start:start + CHUNK])
        if rec.is_endpoint(stream):
            text = online_text(rec, stream).strip()
            if text:
                finals.append(text)
                latencies.append(round(ms_since(ts), 2))
            rec.reset(stream)
    ts = time.perf_counter()
    stream.input_finished()
    while rec.is_ready(stream):
        rec.decode_stream(stream)
    text = online_text(rec, stream).strip()
    if text:
        finals.append(text)
        latencies.append(round(ms_since(ts), 2))
    ms = ms_since(t0)
    return {
        "file": path.name,
        "finals": finals,
        "ms": round(ms, 2),
        "latencies": latencies,
    }


# ---------------------------------------------------------------- control run


class LineTracker:
    """Turns per-step recognizer text into partial and final events and trace entries."""

    def __init__(self):
        self.events = []
        self.trace = []
        self.last_text = ""
        self.first_partial_t = None

    def step(self, text, final_now, t, compute_ms):
        if text and text != self.last_text:
            if self.first_partial_t is None:
                self.first_partial_t = t
            self.events.append({"t": round(t, 3), "text": text, "type": "partial"})
        if final_now:
            if text:
                self.events.append({"t": round(t, 3), "text": text, "type": "final"})
                first = self.first_partial_t if self.first_partial_t is not None else t
                self.trace.append({
                    "completedAudio": round(t, 3),
                    "finalLatencyMs": int(round(compute_ms)),
                    "firstTextAudio": round(first, 3),
                    "text": text,
                })
            self.last_text = ""
            self.first_partial_t = None
        else:
            self.last_text = text


def control_online(rec, samples, lang):
    stream = online_stream(rec, lang)
    padded = tail_padded(samples)
    lines = LineTracker()
    clock = 0.0
    fed = 0.0
    for start in range(0, len(padded), CHUNK):
        chunk = padded[start:start + CHUNK]
        fed += len(chunk) / SAMPLE_RATE
        t0 = time.perf_counter()
        online_step(rec, stream, chunk)
        endpoint = rec.is_endpoint(stream)
        text = online_text(rec, stream).strip()
        compute = time.perf_counter() - t0
        clock = max(clock, fed) + compute
        lines.step(text, endpoint, clock, compute * 1000.0)
        if endpoint:
            rec.reset(stream)
    t0 = time.perf_counter()
    stream.input_finished()
    while rec.is_ready(stream):
        rec.decode_stream(stream)
    text = online_text(rec, stream).strip()
    compute = time.perf_counter() - t0
    clock = max(clock, fed) + compute
    lines.step(text, True, clock, compute * 1000.0)
    return lines.events, lines.trace


# Silero VAD through sherpa-onnx, the VAD an offline sherpa engine would segment
# with. An energy gate split on the click at each clip's start, and Canary
# hallucinated a line ("um") on it. Set by main().
VAD_MODEL = None


def vad_lines(samples):
    """Silero VAD: return (first_frame, last_frame) per line, inclusive, in 20 ms frames."""
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad = sherpa_onnx.SileroVadModelConfig(
        model=str(VAD_MODEL),
        min_silence_duration=VAD_MIN_SILENCE_S,
        min_speech_duration=0.25,
    )
    config.sample_rate = SAMPLE_RATE
    vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=60)
    window = config.silero_vad.window_size
    for i in range(0, len(samples), window):
        vad.accept_waveform(samples[i : i + window])
    vad.flush()
    spans = []
    while not vad.empty():
        segment = vad.front
        first = segment.start // VAD_FRAME
        last = max(first, (segment.start + len(segment.samples)) // VAD_FRAME - 1)
        spans.append((first, last))
        vad.pop()
    return spans


LINE_PAD = SAMPLE_RATE // 5  # 200 ms each side, so a tight energy cut keeps soft edges


def line_audio(samples, first, last):
    """One line's audio from a vad_lines span, padded and clamped to the clip."""
    begin = max(0, first * VAD_FRAME - LINE_PAD)
    end = min(len(samples), (last + 1) * VAD_FRAME + LINE_PAD)
    return samples[begin:end]


def control_offline(rec, samples):
    events, trace = [], []
    clock = 0.0
    for first, last in vad_lines(samples):
        end_of_speech_s = (last + 1) * VAD_FRAME / SAMPLE_RATE
        t0 = time.perf_counter()
        text = offline_decode(rec, line_audio(samples, first, last)).strip()
        decode_s = time.perf_counter() - t0
        clock = max(clock, end_of_speech_s + OFFLINE_HANGOVER_S) + decode_s
        decode_ms = decode_s * 1000.0
        if text:
            events.append({"t": round(clock, 3), "text": text, "type": "final"})
            trace.append({
                "completedAudio": round(clock, 3),
                "finalLatencyMs": int(round(decode_ms)),
                "firstTextAudio": round(clock, 3),
                "text": text,
                "pauseToTextMs": round(decode_ms, 1),
            })
    return events, trace


def run_control(cand, lang, rec, vendor, run_id, load_ms):
    audio_name = CONTROL_CLIPS[lang]
    samples = read_wav(vendor / "audio" / audio_name)
    duration = len(samples) / SAMPLE_RATE
    cpu0 = time.process_time()
    if cand["kind"] == "online-transducer":
        events, trace = control_online(rec, samples, lang)
    else:
        events, trace = control_offline(rec, samples)
    # The RecognizerHost contract ends every session with one stopped event.
    events.append({"t": round(max([duration] + [e["t"] for e in events]), 3), "type": "stopped"})
    cpu = time.process_time() - cpu0
    return {
        "audio": audio_name,
        "backend": "native",
        "language": lang,
        "model": run_id,
        "events": events,
        "trace": trace,
        "summary": {
            "contractViolations": [],
            "cpuPctOfOneCore": round(100.0 * cpu / duration, 2),
            "loadMs": round(load_ms, 2),
            "longTasksOver50": None,
            "typingEventMaxMs": None,
            "peakRssMb": None,
        },
    }


def peak_rss_mb():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


def write_json(path, data):
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)
        fh.write("\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("candidate", help="candidate id from candidates.json")
    parser.add_argument("lang", help="language code, e.g. en or es")
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--vendor", type=Path, default=None, help="vendor/moonshine directory")
    parser.add_argument("--skip-control", action="store_true")
    parser.add_argument(
        "--min-silence",
        type=float,
        default=0.5,
        help="offline models: seconds of non-speech that end a line (Silero VAD)",
    )
    parser.add_argument(
        "--whole-clip",
        action="store_true",
        help="offline models: one line per clip; writes phrases-<id>-<lang>.whole-clip.json",
    )
    args = parser.parse_args(argv)

    cand = load_candidate(args.candidate)
    if args.lang not in cand["languages"]:
        sys.exit(f"{cand['id']} does not support {args.lang!r}; languages: {cand['languages']}")
    if args.lang not in CONTROL_CLIPS:
        sys.exit(f"no control clip for language {args.lang!r}")

    vendor = args.vendor if args.vendor is not None else DEFAULT_VENDOR
    model_dir = vendor / "models" / "sherpa" / cand["dir"]
    global VAD_MODEL, VAD_MIN_SILENCE_S
    VAD_MIN_SILENCE_S = args.min_silence
    VAD_MODEL = vendor / "models" / "sherpa" / "silero_vad.onnx"
    missing = [f for f in model_files(cand) if not (model_dir / f).is_file()]
    if missing:
        sys.exit(f"missing model files in {model_dir}: {', '.join(missing)}")

    clips_dir = vendor / "phrases" / args.lang
    wavs = sorted(clips_dir.glob("*.wav"))
    if not wavs:
        sys.exit(f"no phrase clips in {clips_dir}")

    run_id = f"{cand['id']}-{args.lang}"
    out_dir = vendor / "conformance"
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    rec = build_recognizer(cand, args.lang, model_dir, args.threads)
    load_ms = ms_since(t0)

    online = cand["kind"] == "online-transducer"
    clips = [phrase_online(rec, w, args.lang) if online else phrase_offline(rec, w, args.whole_clip) for w in wavs]
    phrases = {
        "backend": "native",
        "language": args.lang,
        "model": run_id,
        "threads": args.threads,
        "loadMs": round(load_ms, 2),
        "clips": clips,
    }
    label = ".whole-clip" if args.whole_clip else ("" if args.min_silence == 0.5 else f".silence-{args.min_silence:g}")
    phrases_path = out_dir / f"phrases-{run_id}{label}.json"
    write_json(phrases_path, phrases)

    control = None
    control_path = out_dir / f"native-{run_id}{label}.json"
    if not args.skip_control:
        control = run_control(cand, args.lang, rec, vendor, run_id, load_ms)
        write_json(control_path, control)

    rss = peak_rss_mb()
    phrases["peakRssMb"] = round(rss, 1)
    write_json(phrases_path, phrases)
    if control is not None:
        control["summary"]["peakRssMb"] = round(rss, 1)
        write_json(control_path, control)

    ms_values = np.array([c["ms"] for c in clips], dtype=np.float64)
    print(
        f"{run_id} clips={len(clips)} median_ms={np.median(ms_values):.1f} "
        f"p95_ms={np.percentile(ms_values, 95):.1f} loadMs={load_ms:.1f} peakRssMb={rss:.1f}"
    )
    print(f"wrote {phrases_path}")
    if control is not None:
        print(f"wrote {control_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
