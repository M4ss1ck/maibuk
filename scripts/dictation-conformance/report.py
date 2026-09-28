#!/usr/bin/env python3
"""The shared report for the dictation conformance lane.

Reads every ``vendor/moonshine/conformance/{web,native}-*.json`` trace, re-checks
the event contract, measures first-partial lag from the true speech onset (via
``onsets.py``) and final latency from the trace, prints a Markdown table, then
evaluates the bars below and exits non-zero listing every bar that failed.

Paths are resolved relative to the repository root, never the cwd.
"""
import glob
import json
import os
import sys

from onsets import first_partial_lags, quantile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
CONFORMANCE_DIR = os.path.join(REPO_ROOT, "vendor", "moonshine", "conformance")
AUDIO_DIR = os.path.join(REPO_ROOT, "vendor", "moonshine", "audio")

# Spike baseline: every key event at or under 16 ms. Event Timing only reports
# events of 16 ms or more, so the bar is "nothing above 16 ms".
TYPING_MAX_MS = 16

# The bars. One row per model, scoped by backend / id prefix. A bar is a
# metric, a comparison against `max` (or a clean `contract` list), the backends
# it applies to, and the id prefixes that scope it. `except_prefix` means the
# model is shown but its metric is recorded, not gated.
BARS = [
    {
        "id": "first_partial_p50",
        "label": "first partial from onset p50 <= 0.7 s",
        "metric": "first_partial_p50",
        "max": 0.7,
        "backends": ("web", "native"),
        "except_prefix": "moonshine-tiny-es",
        "except_status": "recorded",
    },
    {
        "id": "final_p50",
        "label": "final p50 <= 300 ms",
        "metric": "final_p50_ms",
        "max": 300,
        "backends": ("web", "native"),
    },
    {
        "id": "long_tasks",
        "label": "long tasks > 50 ms == 0",
        "metric": "long_tasks",
        "max": 0,
        "backends": ("web",),
    },
    {
        "id": "typing_max",
        "label": f"typing event max <= {TYPING_MAX_MS} ms",
        "metric": "typing_max_ms",
        "max": TYPING_MAX_MS,
        "backends": ("web",),
    },
    {
        "id": "cpu",
        "label": "CPU <= 40% of one core",
        "metric": "cpu_pct",
        "max": 40,
        "backends": ("native",),
        "only_prefix": "moonshine-tiny-en",
    },
    {
        "id": "contract",
        "label": "contract clean",
        "metric": "contract",
        "backends": ("web", "native"),
    },
]


def event_contract_violations(events):
    """CONTRACT, re-derived from the raw ``events`` list."""
    found = []
    stopped = [i for i, e in enumerate(events) if e.get("type") == "stopped"]
    if len(stopped) != 1:
        found.append(f"expected exactly one stopped, found {len(stopped)}")
    elif stopped[0] != len(events) - 1:
        found.append("stopped is not the last event")
        found.append(f"event after stopped: {events[-1].get('type')}")
    last_final = None
    for e in events:
        if e.get("type") == "error":
            found.append("error event")
        elif e.get("type") == "final":
            text = e.get("text") or ""
            if text and text == last_final:
                found.append(f"repeated final: {text}")
            last_final = text
    return found


def _dedupe(items):
    seen, out = set(), []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def analyze(doc, path):
    summary = doc.get("summary", {})
    trace = doc.get("trace", [])
    events = doc.get("events", [])
    audio = doc.get("audio") or (
        "quijote_es_16k.wav" if doc.get("language") == "es" else "two_cities_16k.wav"
    )
    lags = first_partial_lags(os.path.join(AUDIO_DIR, audio), trace)
    finals = [
        t["finalLatencyMs"] for t in trace if t.get("finalLatencyMs") is not None
    ]
    violations = _dedupe(
        list(summary.get("contractViolations") or []) + event_contract_violations(events)
    )
    return {
        "path": path,
        "backend": doc.get("backend", "web"),
        "model": doc.get("model", os.path.basename(path)),
        "first_partial_p50": None if not lags else round(quantile(lags, 0.5), 2),
        "first_partial_p95": None if not lags else round(quantile(lags, 0.95), 2),
        "final_p50_ms": None if not finals else round(quantile(finals, 0.5), 1),
        "final_p95_ms": None if not finals else round(quantile(finals, 0.95), 1),
        "cpu_pct": summary.get("cpuPctOfOneCore"),
        "long_tasks": summary.get("longTasksOver50"),
        "typing_max_ms": summary.get("typingEventMaxMs"),
        "load_ms": summary.get("loadMs"),
        "contract": violations,
        "bars": {},
    }


def _in_scope(bar, analysis):
    if analysis["backend"] not in bar.get("backends", ()):
        return False
    if bar.get("only_prefix") and not analysis["model"].startswith(bar["only_prefix"]):
        return False
    return True


def evaluate_bars(analyses):
    """Fill every row's ``bars`` and return the failure messages ([] when clean)."""
    failures = []
    for analysis in analyses:
        for bar in BARS:
            if not _in_scope(bar, analysis):
                continue
            if bar.get("except_prefix") and analysis["model"].startswith(
                bar["except_prefix"]
            ):
                analysis["bars"][bar["id"]] = bar.get("except_status", "recorded")
                continue
            if bar["metric"] == "contract":
                if analysis["contract"]:
                    analysis["bars"][bar["id"]] = "fail"
                    failures.append(
                        f'{analysis["backend"]}/{analysis["model"]}: {bar["label"]} '
                        f'({"; ".join(analysis["contract"])})'
                    )
                else:
                    analysis["bars"][bar["id"]] = "ok"
                continue
            value = analysis[bar["metric"]]
            if value is None:
                analysis["bars"][bar["id"]] = "fail"
                failures.append(
                    f'{analysis["backend"]}/{analysis["model"]}: {bar["label"]} (missing)'
                )
            elif value > bar["max"]:
                analysis["bars"][bar["id"]] = "fail"
                failures.append(
                    f'{analysis["backend"]}/{analysis["model"]}: {bar["label"]} (got {value})'
                )
            else:
                analysis["bars"][bar["id"]] = "ok"
    return failures


def _cell(value, suffix=""):
    return "n/a" if value is None else f"{value}{suffix}"


def _pair(p50, p95, suffix=""):
    if p50 is None and p95 is None:
        return "n/a"
    return f"{_cell(p50)}{suffix} / {_cell(p95)}{suffix}"


def render_table(analyses):
    lines = [
        "| Backend | Model | First partial from onset p50 / p95 (s) | Final p50 / p95 (ms) "
        "| CPU (% one core) | Long tasks > 50 ms | Typing event max (ms) | Load (ms) | Contract | Bars |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for a in analyses:
        bars = ", ".join(f"{bar['id']}:{a['bars'].get(bar['id'], '-')}" for bar in BARS)
        contract = "clean" if not a["contract"] else f"{len(a['contract'])} violations"
        lines.append(
            f"| {a['backend']} | {a['model']} "
            f"| {_pair(a['first_partial_p50'], a['first_partial_p95'])} "
            f"| {_pair(a['final_p50_ms'], a['final_p95_ms'])} "
            f"| {_cell(a['cpu_pct'])} | {_cell(a['long_tasks'])} "
            f"| {_cell(a['typing_max_ms'])} | {_cell(a['load_ms'])} "
            f"| {contract} | {bars} |"
        )
    return "\n".join(lines)


def trace_paths():
    patterns = ["web-*.json", "native-*.json"]
    paths = []
    for pattern in patterns:
        paths.extend(glob.glob(os.path.join(CONFORMANCE_DIR, pattern)))
    return sorted(set(paths))


def main(argv=None):
    paths = trace_paths()
    if not paths:
        print(f"no trace files in {CONFORMANCE_DIR}", file=sys.stderr)
        return 1
    analyses = []
    for path in paths:
        try:
            with open(path, encoding="utf-8") as f:
                doc = json.load(f)
            analyses.append(analyze(doc, path))
        except Exception as error:  # report every unreadable or unanalyzable trace
            print(f"cannot analyze {path}: {error}", file=sys.stderr)
            return 1
    failures = evaluate_bars(analyses)
    print(render_table(analyses))
    if failures:
        print()
        print("Failed bars:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print()
    print("All bars hold.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
