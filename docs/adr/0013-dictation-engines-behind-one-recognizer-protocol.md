---
status: accepted
---

# Dictation engines sit behind one RecognizerHost protocol

Maibuk dictates through one protocol, `RecognizerHost` (`load`, `start`, `stop`, `setContext`; events `level`, `partial`, `final`, `error`), implemented once per backend (a Web Worker on the web, a Rust thread in the desktop app). Inside each backend the same pipeline runs, capture → 16 kHz resampler → `SpeechEngine`, and only the `SpeechEngine` adapter knows the engine. Models are data (`ModelSpec` in `src/features/dictation/types.ts`, listed in `src/features/dictation/catalog.json`).

The author wants the engine swappable (Whisper or others) and languages and model sizes addable without touching the session, the UI, or the protocol. One protocol also makes both backends behave the same, so one conformance suite covers both.

## Considered Options

- Call Moonshine's own `SttWorkerHost` on the web: rejected. Vite cannot bundle its worker (the spike's third corrected assumption), and the session would depend on one engine's API.
- Expose Moonshine's C API one-to-one as Tauri commands: rejected. The session would speak two engine-shaped dialects, one per backend, and a second engine would mean a second set of commands.
- Capture audio in the webview on desktop too: rejected. WebKitGTK denies `getUserMedia` and has no `SharedArrayBuffer`, so desktop capture and inference run in Rust.

## Consequences

- Each new engine is two adapters, one TypeScript and one Rust, registered by engine id.
- The protocol changes only with a new ADR.
- Shared JSON fixtures (`src/test/fixtures/dictation/`) keep the two backends' serialization, resampling, and checksums identical.
