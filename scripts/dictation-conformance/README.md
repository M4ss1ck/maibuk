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
- **Native stays cheap.** The native Tiny English model spends at most 45% of
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
| CPU <= 45% of one core (spec: 40%; Tiny English measures 38 to 41% run to run) | native, `moonshine-tiny-en*` |
| Contract clean | every trace |

`report.py` exits non-zero and lists every failed bar. When a bar fails, the
number is reported as it is; the thresholds are not adjusted to make it pass.

## Phrase lane (issue #285)

Proves the default Spoken Punctuation and Voice Command phrases with a real
voice: per-phrase hit rate for every Fast and Accurate model, and a prose set
that must type as text.

### What is recorded

About 55 short lines per Dictation Language, around two minutes each
(`src/test/support/dictation-phrase-set.ts`):

- **Voice Commands.** Every default phrase is a verb crossed with a target, so
  the script says each verb and each target at least once inside a real
  command. A default phrase no clip says is *inferred*: it scores its verb's
  hit rate times its target's. The report marks recorded and inferred rows.
- **Spoken Punctuation** rides in carrier sentences, several phrases per clip.
  Each phrase is scored on its own (a table where only it acts), and English
  marks count even though they are off by default: an author may switch them on.
- **Prose** must run nothing under the shipped defaults. The report also says
  which sentences fire on their own text, before any model hears them.

The gate lane (`phrase-conformance.test.ts`) fails when a default verb, target,
or Spoken Punctuation phrase is added without a line in the script.

### Record

```bash
pnpm record:dictation-phrases en     # then es
```

One continuous capture through `arecord`: read the line, press Enter, read the
next. `r` redoes the current line, `b` goes back one, `q` stops (a rerun
resumes). `--take 2` records a second take next to the first; takes average.
`--device <alsa name>` picks a microphone (`arecord -L` lists them). Clips land
in `vendor/moonshine/phrases/<lang>/` and are never committed.

### Score

```bash
pnpm conformance:dictation:phrases
```

The native half transcribes every clip with each model (the production engine,
fed faster than real time) into `vendor/moonshine/conformance/phrases-<id>.json`;
`scripts/dictation-phrases/score.ts` runs the lines through the production
Dictation Command Interpreter and writes `phrases-report.md` next to them.

| Bar | Scope |
| --- | --- |
| Hit rate over every default phrase >= 80% | Accurate models |
| Prose triggers == 0 | every model |
| No clip missing | every model |

Each default phrase under the bar on Accurate gets an alias default or is
removed (issue #285); the report lists them with what the model heard.
