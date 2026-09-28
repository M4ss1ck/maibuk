# Dictation conformance lane

A periodic, local check that the production dictation backends keep their
promises: the same protocol, the same latency bars, on both the web host and the
Linux native host. It drives the **production** code (the web half uses
`createWebRecognizerHost` and `cacheModelFiles` as shipped, no reimplementation)
and records a trace per model that a single report turns into one table.

It is never part of CI. It needs real models, a real browser with a fake audio
device, and (for the native half) a Linux machine, so it runs on demand and on a
schedule, not on every pull request.

## What it proves

- **The event contract holds.** Exactly one `stopped`, it is last, no event after
  it, a final is never repeated, and no error events.
- **First partial comes quickly.** The first partial lands within 0.7 s of the
  true speech onset (measured from the WAV itself, not from the engine's own
  clock) for every model except Tiny Spanish.
- **Finals land quickly.** Final line latency p50 is at or under 300 ms.
- **The UI stays responsive while dictating.** No main-thread long task over
  50 ms, and no key event over 16 ms, on the web.
- **Native stays cheap.** The native Tiny English model spends at most 40% of
  one core.

## Prerequisites

- `pnpm fetch:dictation --test-assets`: the Moonshine WASM runtime, the Linux
  native runtime, the models and the test WAVs, into `vendor/moonshine/`.
- A local `ffmpeg` (used when assembling the test assets).
- Playwright Chromium: `pnpm exec playwright install chromium`.
- The native half runs on Linux only.

## Run

```bash
pnpm conformance:dictation
```

That builds the harness, runs the web half, runs the native half (Linux), and
prints the report with the bars.

One model, web only:

```bash
node scripts/dictation-conformance/web.mjs moonshine-tiny-en-260821
```

One model, native only:

```bash
cd src-tauri && CONFORMANCE_MODELS=moonshine-tiny-en-260821 \
  cargo test --release dictation::runner::tests::conformance -- --ignored --nocapture
```

The report on its own:

```bash
python3 scripts/dictation-conformance/report.py
```

`web.mjs` accepts several ids (`node scripts/dictation-conformance/web.mjs a b`)
and defaults to every catalog id.

## Output

- `vendor/moonshine/conformance/harness-dist/`: the built harness page, with `models/` linked to `vendor/moonshine/models/`
  so the page installs models same-origin.
- `vendor/moonshine/conformance/web-<modelId>.json`: the web trace.
- `vendor/moonshine/conformance/native-<modelId>.json`: the native trace.

All of `vendor/` is git-ignored, so none of these are committed.

The trace format is shared by both halves: `summary` (load time, CPU, long
tasks, typing event max, contract violations), `events` (level events omitted),
and `trace` (one entry per final with `firstTextAudio`, `completedAudio`,
`finalLatencyMs`, `text`). Report and bars live in `report.py`; the onset
detector and matching rule in `onsets.py`.

## Bars

| Bar | Scope |
| --- | --- |
| First partial from onset p50 <= 0.7 s | every model except `moonshine-tiny-es*` (shown, marked `recorded`) |
| Final p50 <= 300 ms | every model |
| Long tasks > 50 ms == 0 | web |
| Typing event max <= 16 ms | web (Event Timing records only events >= 16 ms, so `0` means every key event was faster) |
| CPU <= 40% of one core | native, `moonshine-tiny-en*` |
| Contract clean | every trace |

`report.py` exits non-zero and lists every failed bar. When a bar fails, the
number is reported as it is; the thresholds are not adjusted to make it pass.
