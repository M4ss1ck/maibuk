# Offline, streaming voice dictation in Maibuk (TipTap 3 + Tauri 2 + web)

Research date: 2026-09-27. Primary sources only: official docs, specs, model cards, papers, registry metadata, and source code pinned to a commit or tag. Every code citation gives the repository, ref, file, and line. Maibuk paths are relative to the repo root at `8d362c5`. Nothing here was run as an inference benchmark; every accuracy and latency number is the vendor's own, and section 7 says what a spike must measure to confirm them.

Pinned refs used below:

| Source | Ref |
| --- | --- |
| Moonshine Voice (`moonshine-ai/moonshine`) | tag `v0.1.5` = commit `234f60faa0eb388b01cdf7e60aca232af37aefda` (2026-08-24) |
| `@moonshine-ai/moonshine-wasm` (npm) | `0.1.5`, published 2026-08-24 |
| `ai.moonshine:moonshine-voice` (Maven Central) | `0.1.5` |
| MoonshineJS (`moonshine-ai/moonshine-js`, archived) | commit `d423b524d123b2d4015b8d00185bbbf9c53795b1`; npm `@moonshine-ai/moonshine-js` `0.1.29` |
| HF `moonshine-ai/moonshine-streaming-small-es` | revision `8cb0974f29ca24d6b645518c430efc8c57cd0073` |
| HF `moonshine-ai/moonshine-streaming-tiny-es` | revision `215dc49e20d2efcfc438cd788b02920639bd85a0` |
| whisper.cpp | commit `d09f61a708f3487afa956ff578e60eae5e7a233c` (latest release `v1.9.4`) |
| whisper-rs | crate `0.16.0` (repo moved to Codeberg; GitHub mirror archived) |
| Transformers.js | commit `836b9cb1b3542f217eab330f6fc62768bdf314f9` (npm `@huggingface/transformers` `4.3.0`) |
| sherpa-onnx | commit `040afe360a38e25daaa325ce8889abf93ea02609` (release `v1.13.8`, crate `sherpa-onnx` `1.13.8`) |
| Vosk | `alphacep/vosk-api` release `v0.3.50` (2024-04-22); npm `vosk-browser` `0.0.8` (2022-12-25) |
| HF `nvidia/parakeet-tdt-0.6b-v3` | revision `541d1f99c6b0c3cd0b11a95167540bb8edefd82b` |
| HF `nvidia/canary-180m-flash` | revision `b12ab418510d093e83890178fd0e8b0d0f7918a6` |
| HF `mistralai/Voxtral-Mini-4B-Realtime-2602` | revision `2769294da9567371363522aac9bbcfdd19447add` |
| HF `kyutai/stt-1b-en_fr` | revision `1c34c6b4f7e9299bb61985f145052ff131005dde` |
| HF `Banafo/Kroko-ASR` | revision `d45212aeb212dd66083dd22710c9954f40ff8cc1` |
| Handy (Tauri dictation app) | commit `8f9cf53cd1410cda26beea39ff802ac306e39585` |
| tauri-plugin-stt | commit `69c7f0e3eabdf752f932bef3601dc037e9f88c53` (crate `0.2.2`) |
| WebKit | commit `73aa6c89e2cb77c46184a81aec944e4ab99d114d` |
| wry (Tauri webview layer) | `0.53.5`; Tauri `2.9.5` (from `src-tauri/Cargo.lock`) |
| prosemirror-history / prosemirror-view | `1.5.0` / `1.41.4` (installed) |
| MDN browser-compat-data | npm `@mdn/browser-compat-data` `8.1.3` |
| Web Speech API | Draft Community Group Report, 18 September 2026 |

---

## Summary and recommendation

**Moonshine Voice fits, and it is the best candidate found. But not as a drop-in npm install everywhere, and not through its convenience class.** Build dictation on Moonshine's streaming models, running natively on Tauri and as WebAssembly in a Worker on the web build, behind one platform adapter.

1. **Use Moonshine Voice's streaming models, Tiny for Android and web, Small for desktop.** They are the only candidate that is at once offline, truly streaming, small, MIT for code and weights including Spanish, and ships English and Spanish models. Spanish Small Streaming scores 4.9% WER and Tiny Streaming 6.2% on FLEURS + MLS (vendor numbers, section 1.4). Required download: Tiny Spanish 32.3 MB, Small Spanish 121.8 MB, Tiny English 45.2 MB, Small English 142.3 MB (section 1.3).
2. **The package is `@moonshine-ai/moonshine-wasm`, not `moonshine-js`.** The older `@moonshine-ai/moonshine-js` repo is archived and deprecated in favor of Moonshine Voice, and its last npm version declares a `file:` dependency on a sibling folder (section 1.1). Do not install it.
3. **Do not use `MicTranscriber` in Maibuk.** It runs `stream.transcribe()` on the main thread for every audio chunk (`mic-transcriber.ts:213-217`). Use the package's `SttWorkerHost`, which owns transcription in a module Worker, fed by Maibuk's own AudioWorklet (section 1.5).
4. **Tauri desktop: run Moonshine's C API from Rust, and capture the mic in Rust, not in the webview.** On Linux, WebKitGTK ships `enable-media-stream` off by default and wry never turns it on, and a Tauri user got `NotAllowedError` even with a permission hook (section 4.1). Handy, a 32k-star Tauri dictation app, captures with `cpal` in Rust (section 2.9). Stream results to the editor over a Tauri Channel.
5. **Tauri Android: wrap the official Android library (`ai.moonshine:moonshine-voice`) in a Tauri Kotlin plugin.** Android WebView has no `SharedArrayBuffer` according to MDN compat data, so the default threaded WASM build cannot run there (section 4.3). Moonshine's Android library needs `minSdk 26`; Maibuk builds with `minSdk 24` (section 1.7). That is a decision for Andy: raise the floor, or gate dictation at runtime.
6. **Web build: WASM in a Worker, with COOP/COEP headers, or the single-thread build.** The published WASM is threaded and needs cross-origin isolation (section 1.5). Maibuk's web deploy can send the headers through `public/_headers` (section 4.3). Host the model files on Maibuk's own origin for true offline use after first load. Tiny Spanish fits Cloudflare's 25 MiB per-file limit; Tiny English's 32.6 MB decoder does not (section 1.6).
7. **Auto-correction: rely on the model's own case and punctuation, render the in-progress line as a ProseMirror decoration, and commit only completed lines.** Moonshine revises the active line until `LineCompleted`, then never touches it again (section 3.2). That maps onto one undo step per spoken line, and the author's own typing is never fought. Feed the open chapter to `setContext()` so character and place names are biased in (section 3.4). Filler removal is a small rule table per language, applied at commit time. A local LLM cleanup pass is a later, opt-in extra, not part of v1 (section 3.3).
8. **Fallbacks and rejected options.** The Web Speech API is not offline by default. Its on-device mode exists only in desktop Chrome and Edge 139+, not in any Tauri webview (section 2.7). Whisper is not streaming and re-decodes a window. whisper-streaming reports 3.3 s latency (section 2.1). Parakeet v3 has the best Spanish number found (3.45% FLEURS es_419), but it is 600M parameters, about 640 MB int8, and not natively streaming. It is a candidate for an optional "polish this paragraph" re-transcription on desktop later, not for live dictation (section 2.5).

**Top risks** (details in section 6):

1. **Maturity.** Moonshine Voice is at 0.1.5, the WASM package is seven weeks old, and the Spanish streaming weights are a 2026-08-24 snapshot trained mostly on Whisper pseudo-labels and evaluated only on read speech. Mitigation: pin model files and host copies (MIT allows it).
2. **Platform plumbing.** Linux mic capture, Android's missing `SharedArrayBuffer`, the `minSdk` mismatch, and COOP/COEP on the web each need their own path. A single "WASM everywhere" build will not work on Android and is fragile on Linux.
3. **Unmeasured quality where it matters to authors.** Published WER strips case and punctuation, so nobody has measured Spanish punctuation, `¿`/`¡`, or filler behavior. The latency numbers are "end of speech to final line", not "first partial", and none is for a mid-range Android phone running Tiny Spanish.

The spike (section 7) decides between Tiny and Small per platform and confirms or kills the numbers above.

---

## 1. Moonshine Voice

### 1.1 Packages and versions

| Package | Status | Evidence |
| --- | --- | --- |
| `@moonshine-ai/moonshine-wasm` | **Current.** `0.1.1` (2026-08-07) to `0.1.5` (2026-08-24), MIT, 96 files, 13.7 MB unpacked | `npm view @moonshine-ai/moonshine-wasm version license dist.unpackedSize dist.fileCount time` |
| `@moonshine-ai/moonshine-js` | **Deprecated.** Last `0.1.29` (2025-07-03). Depends on `@huggingface/transformers`, `onnxruntime-web`, and `'@ricky0123/vad-web': 'file:../vad-moonshine/packages/web'` | `npm view @moonshine-ai/moonshine-js dependencies`; repo README: "This project is now deprecated in favor of Moonshine Voice's Javascript support ... and has been archived" ([moonshine-js README](https://github.com/moonshine-ai/moonshine-js/blob/d423b524d123b2d4015b8d00185bbbf9c53795b1/README.md)); `gh api repos/moonshine-ai/moonshine-js` returns `archived: true` |
| `@usefulsensors/moonshine-js` | Older name, last `0.1.21` (2025-06) | `npm view` |
| `moonshine-voice` / `@moonshine-ai/moonshine-voice` | Do not exist on npm (404) | `npm view` |

"Moonshine Voice" is the product name of the `moonshine-ai/moonshine` repo ([README.md#L3-L14](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/README.md#L3-L14)); its web binding is `@moonshine-ai/moonshine-wasm` ([language-bindings/wasm/package.json](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/package.json), [docs/using/adding-the-library.md#L7-L22](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/using/adding-the-library.md#L7-L22)). Repo: 11,143 stars, last push 2026-08-31 (`gh api repos/moonshine-ai/moonshine`).

### 1.2 Runtime

- Not onnxruntime-web and not WebGPU. The WASM is Moonshine's C++ core plus a **minimal ONNX Runtime built from source**, linked by embind: "a thin embind bridge over the Moonshine C ABI" ([wasm README L7-L12](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/README.md#L7-L12)); "Microsoft doesn't publish a prebuilt ORT-wasm static library ... builds `libonnxruntime_webassembly.a` from ORT" ([L295-L301](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/README.md#L295-L301)); the minimal build "drops about two thirds of ORT's code" and only reads `.ort` models ([L303-L316](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/README.md#L303-L316)).
- The published `moonshine.wasm` is 13,155,937 bytes (6.4 MB gzip -9) and `moonshine.mjs` contains Emscripten `PThread` code (37 hits) and `SharedArrayBuffer` (measured on the `0.1.5` tarball from `npm pack`). The README: "The default build enables **SIMD + multithreading** ... which needs `SharedArrayBuffer` ... your server must send `Cross-Origin-Opener-Policy: same-origin` / `Cross-Origin-Embedder-Policy: require-corp`. If you can't set these headers, build the SIMD-only fallback" ([L191-L205](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/README.md#L191-L205)). The single-thread build is not published; you build it with emsdk 4.0.8 ([L275-L289](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/README.md#L275-L289)).
- Native targets (C++, Python, Swift, Android) share the same C core and ORT; iOS and Android use the same minimal ORT config, desktop uses prebuilt full ORT ([L347-L353](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/README.md#L347-L353)).

### 1.3 Models, languages, sizes, license

From [docs/models/available-models.md#L14-L32](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/models/available-models.md#L14-L32):

| Language | Architecture | Params (docs) | WER | License |
| --- | --- | --- | --- | --- |
| English | Medium Streaming | 245M | 6.65% (Open ASR avg) | MIT |
| English | Small Streaming | 123M | 7.84% | MIT |
| English | Tiny Streaming | 34M | 12.00% | MIT |
| Spanish | Small Streaming | 123M | 4.9% (FLEURS + MLS) | MIT |
| Spanish | Tiny Streaming | 34M | 6.2% | MIT |

**Spanish is supported and MIT.** The license file names the only non-MIT speech models: "the legacy non-streaming models for languages other than English ... Spanish Base" under the non-commercial Moonshine Community License; "Any speech-to-text model not named in that list is MIT, including every streaming model" ([LICENSE#L1-L21](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/LICENSE#L1-L21)). The HF cards for both Spanish streaming models say `license: mit` ([small-es card](https://huggingface.co/moonshine-ai/moonshine-streaming-small-es/blob/8cb0974f29ca24d6b645518c430efc8c57cd0073/README.md), [tiny-es card](https://huggingface.co/moonshine-ai/moonshine-streaming-tiny-es/blob/215dc49e20d2efcfc438cd788b02920639bd85a0/README.md)). So the owner's worry was correct for the old Spanish Base model and does not apply to the streaming ones. Do not load `ModelArch.Base` for Spanish.

**Download size**, summed from the generated manifest [core/moonshine-model-file-metadata.generated.cpp](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/core/moonshine-model-file-metadata.generated.cpp), excluding `*_with_attention.ort`, which is "only used to produce word-level timestamps" and fetched only on opt-in ([moonshine-model-catalog.cpp#L291-L306](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/core/moonshine-model-catalog.cpp#L291-L306)):

| Model (CDN dir) | Required bytes | Largest file |
| --- | --- | --- |
| `tiny-streaming-es/quantized_26_08_24` | 32.3 MB | `decoder_kv.ort` 19.72 MB |
| `small-streaming-es/quantized_26_08_24` | 121.8 MB | `decoder_kv.ort` 61.31 MB |
| `tiny-streaming-en/quantized_26_08_21` | 45.2 MB | `decoder_kv.ort` 32.58 MB |
| `small-streaming-en/quantized_26_08_21` | 142.3 MB | `decoder_kv.ort` 81.88 MB |
| `medium-streaming-en/quantized_26_08_21` | 269.1 MB | |

Language selection is per model: the catalog lists Spanish Small then Tiny Streaming ([moonshine-model-catalog.cpp#L119-L134](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/core/moonshine-model-catalog.cpp#L119-L134)). There is no bilingual model, so an author switching language mid-session needs the other model loaded.

**Parameter counts disagree.** The docs table says 123M/34M; the HF cards say 112.9M (Small es) and 27.0M (Tiny es). Recorded under "Could not verify".

### 1.4 Accuracy and latency, as published

- **Spanish.** Quantized models "scored as deployed (batch 1, VAD off) on a seeded 400-clip sample": Small 4.9%, Tiny 6.2% WER on FLEURS + MLS ([docs/models/accuracy.md#L54-L74](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/models/accuracy.md#L54-L74)). The small-es card adds: training is "roughly 160,000 hours, pseudo-labeled and unaudited" crawled audio labeled by "a Whisper-family teacher model", plus about 1,700 hours of human-transcribed read speech; "the model is not measured here on Latin American spontaneous speech"; WER is computed "after the usual case and punctuation normalization"; the quantized build scores 4.938 vs 4.933 float ([small-es card](https://huggingface.co/moonshine-ai/moonshine-streaming-small-es/blob/8cb0974f29ca24d6b645518c430efc8c57cd0073/README.md)).
- **Leaving the VAD on costs accuracy.** "Leaving the default VAD enabled adds roughly +1.5–2% WER on Tiny" on pre-segmented clips ([accuracy.md#L137-L140](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/models/accuracy.md#L137-L140)). Live dictation needs the VAD, so real WER will be above the table.
- **Latency.** From [docs/moonshine-vs-whisper.md#L5-L12](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/moonshine-vs-whisper.md#L5-L12): Tiny Streaming 69 ms on Linux x86, 92 ms on a Pixel 10a; Small Streaming 165 ms / 234 ms; Whisper Tiny 1,141 ms on Linux x86. The metric is "the average time between when the library determines the user has stopped talking and the delivery of the final transcript of that phrase" ([docs/using/benchmarks.md#L21](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/using/benchmarks.md#L21)). The Linux x86 column "was last taken before the build-optimization fix ... so they read pessimistically" ([benchmarks.md#L34](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/using/benchmarks.md#L34)). These are English models on native builds, not WASM, and not first-partial latency.
- **Paper.** Moonshine v2 introduces "an ergodic streaming-encoder ASR model that employs sliding-window self-attention to achieve bounded, low-latency inference" ([arXiv:2602.12241](https://arxiv.org/abs/2602.12241), 2026-02-12). The Spanish card gives the lookahead: "roughly 80 ms of lookahead" from the lookahead layers ([small-es card, Architecture](https://huggingface.co/moonshine-ai/moonshine-streaming-small-es/blob/8cb0974f29ca24d6b645518c430efc8c57cd0073/README.md)). The "Flavors of Moonshine" paper covers Arabic, Chinese, Japanese, Korean, Ukrainian and Vietnamese, not Spanish ([arXiv:2509.02523](https://arxiv.org/abs/2509.02523)).

### 1.5 Streaming, VAD, and threads in the browser

- **Streaming events.** `LineStarted`, `LineUpdated`, `LineTextChanged`, `LineCompleted`; "There will only be one line active at any one time"; "Once `LineCompleted` has been called, the library will never alter that line's text" ([docs/using/transcription.md#L110-L130](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/using/transcription.md#L110-L130)). Updates run "at a default interval of every 500ms of input", and the interval "is a floor rather than a fixed cadence" so a slow machine batches instead of falling behind ([transcription.md#L100-L102](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/using/transcription.md#L100-L102)). The C struct exposes `is_complete`, `is_updated`, `is_new`, `has_text_changed` ([core/moonshine-c-api.h#L273-L284](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/core/moonshine-c-api.h#L273-L284)).
- **VAD.** Silero VAD is compiled into the library ([wasm README L141-L147](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/README.md#L141-L147); `core/silero-vad.cpp`). No separate VAD package is needed.
- **Main thread vs Worker.** `MicTranscriber` captures with an AudioWorklet that posts mono chunks to the main thread, and then on the main thread calls `this.stream.addAudio(...)` and `this.stream.transcribe(this.flags)` per chunk ([mic-transcriber.ts#L208-L217](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/src/mic-transcriber.ts#L208-L217), worklet at [L396-L415](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/src/mic-transcriber.ts#L396-L415)). The package also exports `SttWorkerHost`, a module Worker that "Keeps the heavy `stream.transcribe()` work off the page's main thread" ([stt-worker.ts#L1-L6](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/src/stt-worker.ts#L1-L6), [stt-worker-host.ts#L74-L93](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/src/stt-worker-host.ts#L74-L93), exported in [index.ts#L83-L84](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/src/index.ts#L83-L84)). Moonshine's own meeting-notes example uses `SttWorkerHost` ([examples/web/meeting-notes/index.html#L713](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/examples/web/meeting-notes/index.html#L713), [#L3288](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/examples/web/meeting-notes/index.html#L3288)); its dictation example uses `MicTranscriber` ([examples/web/dictation/index.html#L985](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/examples/web/dictation/index.html#L985)). Maibuk should follow the meeting-notes pattern.
- **Blob worker bridge.** Cross-origin worker scripts are loaded through "a same-origin blob bridge" ([stt-worker-host.ts#L55-L71](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/src/stt-worker-host.ts#L55-L71)). Maibuk bundles workers with `new Worker(new URL(..., import.meta.url), { type: "module" })` (`src/features/sync/sync-codec.ts:50`, `src/lib/db/sql-export.ts:196`) and Vite `worker.format: "es"` (`vite.config.ts:22-24`), which should cover the package's `new URL('./stt-worker.js', import.meta.url)`. Whether Vite rewrites that URL inside a dependency, and whether the pthread workers resolve `moonshine.mjs`, is a spike item.

### 1.6 Model loading and "fully offline"

- Default: "Every other model ... is fetched from the Moonshine CDN (`https://download.moonshine.ai`) the first time it's needed and cached in the browser via the Cache API" ([wasm README L141-L147](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/README.md#L141-L147)); cache bucket `moonshine-models-v1` ([asset-downloader.ts#L64](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/src/asset-downloader.ts#L64)).
- Self-host: `Transcriber.load` takes raw bytes or a keyed `{ files }` map "for any architecture — including streaming", or `Transcriber.loadFromUrls(...)` pointing at your own URLs ([L166-L189](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/wasm/README.md#L166-L189)). The C API has `moonshine_load_transcriber_from_files` and `..._from_memory_files` ([moonshine-c-api.h#L471](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/core/moonshine-c-api.h#L471), [#L551](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/core/moonshine-c-api.h#L551)).
- Model files move: "Re-quantized models are published to a new dated directory on our CDN (currently `quantized_26_08_21`)" ([docs/models/quantization.md#L15](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/models/quantization.md#L15)).
- Hosting on Maibuk's web origin: the web build is served as Workers static assets (`wrangler.jsonc`), and "Individual file size | 25 MiB" ([Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). 25 MiB is 26.2 MB, so Tiny Spanish (largest file 19.72 MB) fits and Tiny English (32.58 MB) does not. Tiny English needs R2, another host, or splitting the file and joining it before `load` (the bytes API makes the last option possible).

**Implication:** "fully offline" means Maibuk controls the model bytes: pinned copies on its own origin (web), or bundled / first-run download into app data (Tauri). After that, no network. The MIT license permits redistribution.

### 1.7 Native paths

- **Linux / Windows / macOS.** Prebuilt shared libraries for Linux x86_64 and arm64 on GitHub Releases, a Windows library download, Swift Package Manager for macOS ([adding-the-library.md#L63-L99](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/using/adding-the-library.md#L63-L99)). Release `v0.1.5` assets include `moonshine-voice-linux-x86_64.tar.gz` (14.6 MB), `moonshine-voice-windows-x86_64.tar.gz` (26.1 MB), `moonshine-voice-macos-arm64.tar.gz` (`gh api repos/moonshine-ai/moonshine/releases/latest`). A plain C ABI (`moonshine_create_stream`, `moonshine_transcribe_add_audio_to_stream`, `moonshine_transcribe_stream`, `moonshine_transcriber_set_context` at [moonshine-c-api.h#L376, #L683, #L743, #L782](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/core/moonshine-c-api.h#L683)) is what a Rust `bindgen` wrapper would call. There is no official Rust crate; `moonshine-rs` `0.2.6` exists (unofficial, 294 downloads, crates.io API).
- **Android.** Maven `ai.moonshine:moonshine-voice`, latest `0.1.5` ([Maven Central metadata](https://repo1.maven.org/maven2/ai/moonshine/moonshine-voice/maven-metadata.xml); [adding-the-library.md#L59-L61](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/using/adding-the-library.md#L59-L61)). Built for `arm64-v8a`, `armeabi-v7a`, `x86_64` with **`minSdk = 26`** ([language-bindings/android/build.gradle.kts#L14, #L26](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/language-bindings/android/build.gradle.kts#L14)). Maibuk: `minSdk = 24` (`src-tauri/gen/android/app/build.gradle.kts:22`).
- **Domain biasing.** `setContext(text)` extracts rare words from a passage: "The user is dictating into a document ... Hand over the text and they will be found for you"; "up to a 40% reduction in errors with no latency cost"; streaming architectures only ([docs/models/domain-customization.md#L23-L27](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/models/domain-customization.md#L23-L27), [#L71](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/models/domain-customization.md#L71)).

### 1.8 Maintenance

Tags `v0.0.x` through `v0.1.5` (2026-08-24) (`git ls-remote --tags`); CHANGELOGS.md present; last push 2026-08-31; WASM npm package had five releases in 17 days. Very active, very young, and the API was renamed recently (the README warns agents off "the old `DialogFlow` names", [README.md#L26](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/README.md#L26)).

---

## 2. Alternatives

### 2.1 whisper.cpp (native via whisper-rs, WASM)

- MIT, 53,948 stars, release `v1.9.4` (2026-09-11) (`gh api`). Model disk and memory: tiny 75 MiB / ~273 MB, base 142 MiB / ~388 MB, small 466 MiB / ~852 MB ([README.md#L136-L144](https://github.com/ggml-org/whisper.cpp/blob/d09f61a708f3487afa956ff578e60eae5e7a233c/README.md#L136-L144)). Multilingual models cover Spanish.
- **Streaming is emulated.** "This is a naive example ... samples the audio every half a second and runs the transcription continuously" ([README.md#L652-L664](https://github.com/ggml-org/whisper.cpp/blob/d09f61a708f3487afa956ff578e60eae5e7a233c/README.md#L652-L664)). The structured approach, whisper-streaming with a "local agreement policy", reports "3.3 seconds latency on unsegmented long-form speech" ([arXiv:2307.14743](https://arxiv.org/abs/2307.14743)). Moonshine's docs name the cause: Whisper's fixed 30-second window and no caching between calls ([moonshine-vs-whisper.md#L18-L21](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/moonshine-vs-whisper.md#L18-L21), vendor claim).
- **WASM.** "x2 or x3 real-time for the `tiny` and `base` models on a modern CPU"; models up to `small`; greedy only; audio capped at 120 s ([examples/whisper.wasm/README.md](https://github.com/ggml-org/whisper.cpp/blob/d09f61a708f3487afa956ff578e60eae5e7a233c/examples/whisper.wasm/README.md)). `stream.wasm` builds a `libstream.worker.js` (pthreads) ([examples/stream.wasm/README.md](https://github.com/ggml-org/whisper.cpp/blob/d09f61a708f3487afa956ff578e60eae5e7a233c/examples/stream.wasm/README.md)).
- **Rust.** `whisper-rs` `0.16.0` (2026-03-12), 1.31M downloads; GitHub repo archived, development on Codeberg (crates.io API; `gh api repos/tazz4843/whisper-rs`).
- **faster-whisper** is a Python/CTranslate2 package ([SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper), referenced by Moonshine's benchmark, [benchmarks.md#L77](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/using/benchmarks.md#L77)). Shipping a Python runtime inside a Tauri app and the web build is out of scope.

Verdict: good for batch "record, then transcribe", not for real-time partials on Android or in WASM.

### 2.2 Transformers.js

- Apache-2.0, npm `4.3.0` (2026-09-16). WebGPU via `device: 'webgpu'`, "still experimental in many browsers" ([README.md#L103-L115](https://github.com/huggingface/transformers.js/blob/836b9cb1b3542f217eab330f6fc62768bdf314f9/README.md#L103-L115)).
- Supports Moonshine v1, Whisper, Parakeet, and Voxtral Realtime (source dirs `packages/transformers/src/models/{moonshine,whisper,parakeet,voxtral_realtime}`). **No Moonshine streaming architecture** in the tree at the pinned commit (`gh api .../git/trees/836b9cb...?recursive=1`, no `moonshine_streaming`). So via Transformers.js, Spanish Moonshine would be the v1 Base model, which is Community-licensed (section 1.3).
- Verdict: a general runtime, but it adds a second ONNX Runtime and does not reach the streaming Moonshine models. WebGPU is not available in Maibuk's Linux webview (section 4.4).

### 2.3 Vosk

- True streaming (Kaldi), Apache-2.0. Spanish: `vosk-model-small-es-0.42`, 39 MB, WER 16.02 (CV), 11.21 (MLS); `vosk-model-es-0.42`, 1.4 GB, 5.84 (MLS). Punctuation is a separate model: "we recommend the models trained with benob/recasepunc", with punctuation models for English, Russian, German only ([Vosk models](https://alphacephei.com/vosk/models)).
- Maintenance: last `vosk-api` release `v0.3.50` on 2024-04-22; `vosk-browser` npm last published 2022-12-25; Rust crate `vosk` `0.3.1` (2024-10-27) (`gh api`, `npm view`, crates.io API).
- Verdict: small and streaming, but the small Spanish model's WER is 2.5x Moonshine Tiny's on MLS, the output has no punctuation or case, and the web port is stale.

### 2.4 sherpa-onnx (k2-fsa)

- Apache-2.0, 14,981 stars, `v1.13.8` (2026-09-10); official Rust crate `sherpa-onnx` `1.13.8` (crates.io); npm `sherpa-onnx` `1.13.8`. Covers WASM, Android, iOS, desktop, VAD, punctuation.
- **Spanish streaming** exists only as `sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06` (124 MB compressed) in the `asr-models` release (`gh api repos/k2-fsa/sherpa-onnx/releases/tags/asr-models`). Kroko's community models are "Licensed under **CC-BY-SA**" ([Kroko-ASR card](https://huggingface.co/Banafo/Kroko-ASR/blob/d45212aeb212dd66083dd22710c9954f40ff8cc1/README.md)). Share-alike on weights bundled into an MIT app is a question for Andy, not a blocker by itself.
- The streaming models page lists no Spanish model ([online-transducer index](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/index.html)). Spanish offline options: Parakeet v3 int8, Canary-180m-flash int8 (154 MB compressed), NeMo fast-conformer CTC es (103 MB int8) (same release listing).
- **Punctuation models**: English-only (`online-punct-en`) or Chinese+English (CT-Transformer); none for Spanish ([punctuation models](https://k2-fsa.github.io/sherpa/onnx/punctuation/pretrained_models.html)).
- **WASM**: built from source with emsdk 4.0.23; the ASR target preloads the model into the Emscripten file system at build time (`--preload-file ${CMAKE_CURRENT_SOURCE_DIR}/assets@.`) ([wasm/asr/CMakeLists.txt#L40-L44](https://github.com/k2-fsa/sherpa-onnx/blob/040afe360a38e25daaa325ce8889abf93ea02609/wasm/asr/CMakeLists.txt#L40-L44); [build-wasm-simd-asr.sh](https://github.com/k2-fsa/sherpa-onnx/blob/040afe360a38e25daaa325ce8889abf93ea02609/build-wasm-simd-asr.sh)).
- Verdict: the strongest general toolkit and the best fallback if Moonshine fails the spike. Its weak spot for Maibuk is exactly Spanish streaming.

### 2.5 NVIDIA Parakeet TDT 0.6B v3 and Canary

- Parakeet v3: 600M params, 25 European languages including Spanish, automatic language detection, "Automatic **punctuation** and **capitalization**", CC-BY-4.0, "ready for commercial/non-commercial use"; FLEURS `es_419` WER 3.45 ([model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/blob/541d1f99c6b0c3cd0b11a95167540bb8edefd82b/README.md)). Streaming is chunked inference through a NeMo Python script with `chunk_secs=2` (same card, "Streaming with Parakeet models"). sherpa-onnx int8: about 640 MB (encoder 622 MB); RTF 0.220 on one Cortex-A76 thread, 0.088 on four ([sherpa-onnx NeMo transducer docs](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html)). Handy ships it on desktop (section 2.9).
- Canary-180m-flash: 182M, en/de/fr/es, optional punctuation and capitalization, CC-BY-4.0 ([card](https://huggingface.co/nvidia/canary-180m-flash/blob/b12ab418510d093e83890178fd0e8b0d0f7918a6/README.md)). Offline, not streaming.
- `nvidia/nemotron-speech-streaming-en-0.6b` is English-only (HF API, `license: other`).
- Verdict: best Spanish accuracy found, too big and not streaming for live dictation on Android or web. A desktop "re-transcribe the last paragraph at higher quality" option later.

### 2.6 Kyutai STT and Voxtral

- Kyutai `stt-1b-en_fr`: English and French only, ~1B params, 0.5 s delay; `stt-2.6b-en` English only ([card](https://huggingface.co/kyutai/stt-1b-en_fr/blob/1c34c6b4f7e9299bb61985f145052ff131005dde/README.md)). No Spanish: out.
- Voxtral Mini 4B Realtime (2026-02): natively streaming, 13 languages including Spanish, Apache-2.0, FLEURS Spanish 3.31% at 480 ms delay; "can run on a single GPU with >= 16GB memory" in BF16; ≈3.4B-parameter language model ([card](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602/blob/2769294da9567371363522aac9bbcfdd19447add/README.md); [arXiv:2602.11298](https://arxiv.org/abs/2602.11298)). The card calls it "optimized for on-device deployment", but 4B parameters is not realistic for a mid-range phone or a WASM tab. Transformers.js has a `voxtral_realtime` model directory. Out for v1; worth re-checking if a small quantized build appears.

### 2.7 Web Speech API (`SpeechRecognition`)

- Spec: Draft Community Group Report, 18 September 2026. `processLocally`: "When set to true, indicates a requirement that the speech recognition process MUST be performed locally on the user's device"; `available()` and `install()` for language packs; if local recognition is unavailable, `error` fires with `service-not-allowed`; `isFinal` false "represents an interim result that could still be changed" ([Web Speech API](https://webaudio.github.io/web-speech-api/)).
- MDN: "By default, using speech recognition on a web page involves a server-based recognition engine. Your audio is sent to a web service ... so it won't work offline" ([Using the Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API)).
- MDN compat data 8.1.3: `processLocally`, `available()`, `install()` are supported in Chrome 139 and Edge 139 on desktop, and `false` for Chrome Android, Android WebView, Safari, and iOS WebView (`api.SpeechRecognition.processLocally` etc. in `@mdn/browser-compat-data`).
- Tauri webviews: WebView2 reports a Web Speech `network` error in Runtime 153 that did not occur in 152, open since 2026-09-21 ([WebView2Feedback#5724](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5724)). WebKitGTK's port options enable speech synthesis but list no speech recognition option ([OptionsGTK.cmake#L107](https://github.com/WebKit/WebKit/blob/73aa6c89e2cb77c46184a81aec944e4ab99d114d/Source/cmake/OptionsGTK.cmake#L107)). Tauri issue "there is an error when using SpeechRecognition" (macOS) is open since 2023 ([tauri#6208](https://github.com/tauri-apps/tauri/issues/6208)).
- Verdict: fails "fully offline" by default and is unavailable in every Tauri webview Maibuk ships. Not a fit.

### 2.8 OS-native engines

- **Android `SpeechRecognizer`.** `createOnDeviceSpeechRecognizer` and `isOnDeviceRecognitionAvailable` are API 31; `triggerModelDownload` is API 33/34; methods "must be invoked only from the main application thread"; the class docs say the implementation "is likely to stream audio to remote servers ... As such this API is not intended to be used for continuous recognition, which would consume a significant amount of battery and bandwidth" ([SpeechRecognizer reference](https://developer.android.com/reference/android/speech/SpeechRecognizer)). The on-device variant avoids the network, but availability and Spanish quality vary by device vendor (unverified), and it stops after each utterance.
- **Windows `Windows.Media.SpeechRecognition`.** "When using these grammars [dictation, web search], speech recognition is performed by a remote web service ... they do require a connection to a network" ([Microsoft Learn, Speech recognition](https://learn.microsoft.com/en-us/windows/apps/design/input/speech-recognition)). Not offline for dictation.
- **Apple `SpeechAnalyzer`.** iOS/macOS 26.0+ only ([developer.apple.com, SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer)). Only relevant if Maibuk ships macOS, and only for macOS 26+.
- **Tauri plugin.** `tauri-plugin-stt` `0.2.2`: whisper.cpp via whisper-rs on desktop, OS `SpeechRecognizer` on Android, 23 stars ([README](https://github.com/brenogonzaga/tauri-plugin-stt/blob/69c7f0e3eabdf752f932bef3601dc037e9f88c53/README.md)). Useful reference code, not a dependency to adopt.

Verdict: inconsistent per OS, network on Windows, and no web build. Not the primary engine.

### 2.9 Reference implementation found: Handy

Handy is "A free, open source, and extensible speech-to-text application that works completely offline", built on Tauri, MIT, 32,262 stars, release `v0.9.7` (2026-09-18). It filters silence with Silero VAD and offers Whisper and Parakeet V3 ([README.md#L5-L31](https://github.com/cjpais/Handy/blob/8f9cf53cd1410cda26beea39ff802ac306e39585/README.md#L5-L31)). Audio capture is in Rust with `cpal = "0.16.0"`; inference through `transcribe-rs` (ONNX: "Parakeet, Moonshine, SenseVoice, GigaAM") and `transcribe-cpp` (Whisper) ([src-tauri/Cargo.toml#L51-L82](https://github.com/cjpais/Handy/blob/8f9cf53cd1410cda26beea39ff802ac306e39585/src-tauri/Cargo.toml#L51-L82)). It is press-to-talk, release-to-transcribe, not streaming. It also documents a WebKitGTK pitfall: WebKitGTK uses `SIGUSR1` internally, and listening for it "caused phantom recordings" ([README.md#L229](https://github.com/cjpais/Handy/blob/8f9cf53cd1410cda26beea39ff802ac306e39585/README.md#L229)). Lesson for Maibuk: on Tauri desktop, keep capture and inference in Rust.

---

## 3. Auto-correction layer

### 3.1 What each engine gives natively

| Engine | Case + punctuation | Source |
| --- | --- | --- |
| Moonshine streaming | Yes, trained on cased, punctuated text; `setContext` also carries the passage's capitalization | [domain-customization.md#L50, #L233](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/models/domain-customization.md#L50) ("Match transcript style to the model (cased, punctuated English)") |
| Parakeet v3 | Yes | model card, Key Features |
| Canary-180m-flash | Optional (PnC toggle) | model card |
| Kyutai STT | Yes | card: "The model produces transcripts with capitalization and punctuation" |
| Whisper | Yes (model output) | not re-verified here |
| Vosk, Kroko zipformer | No; separate recasepunc model, no Spanish | Vosk models page |

Published Spanish WER for Moonshine is computed "after the usual case and punctuation normalization" (small-es card), so punctuation quality is **not measured** anywhere. That includes Spanish inverted marks (`¿`, `¡`).

### 3.2 How streaming revisions work, and how they map onto ProseMirror

Moonshine: one active line; its text changes (`LineTextChanged`) until `LineCompleted`, then it is frozen (section 1.5). The Web Speech API has the same shape: interim results with `isFinal: false` "could still be changed" (spec). So there is one mutable tail and an append-only past.

ProseMirror facts that decide the design:

- A widget decoration is not document content; decorations are mapped through each transaction's `Mapping` (`Decoration.widget(pos, toDOM, { side })` at `prosemirror-view/src/decoration.ts:141-157`; `DecorationSet.map` at `:334-350`). Showing the interim line as a widget means no document change, no Maibuk save, no word-count job, and no undo entries while the author speaks.
- `prosemirror-history` groups changes that are adjacent and within `newGroupDelay` (default 500 ms); `closeHistory(tr)` forces a new undo event; a transaction with `addToHistory: false` is not undoable (`prosemirror-history/src/history.ts:277-283`, `:366-368`, `:388-393`).
- Positions map with an `assoc` side (`prosemirror-transform/src/map.ts:4-16`), so an anchor can stay put when the author types before it.

**Proposed mapping (my design, not from a source):**

1. On start, record an anchor at the caret. Keep it in plugin state and map it on every transaction.
2. On `LineTextChanged`, replace the widget's text only. It renders in a muted style.
3. On `LineCompleted`, run the commit pipeline (3.3) and insert the text at the mapped anchor in **one** transaction with `closeHistory`, so one Mod+Z removes one spoken line. Move the anchor to the end of the insert.
4. If the author types or moves the caret while dictating, the anchor maps and the widget follows it. Dictation does not steal the caret. Whether the anchor should follow the caret instead is a UX decision for the spike.
5. Stopping dictation calls `stop()`, which completes any active line (transcription.md guarantee).

This stays inside Maibuk's editor-latency rule: nothing whose cost grows with chapter length runs per update, and document writes happen once per spoken line, which then flows through the existing `EMIT_COALESCE_MS = 300` burst coalescing (`src/components/editor/Editor.tsx:56`, `:317`).

### 3.3 Post-processing options

- **Rule-based commit pipeline (recommended for v1, my design):** spacing and capitalization relative to the text before the anchor (a line that follows a sentence end starts uppercase; a line inserted mid-sentence has its first letter lowered); a per-language filler list (en: "um", "uh", "er"; es: "eh", "este", "o sea") removed only as whole tokens and only when a setting is on; spoken commands such as "nuevo párrafo" / "new paragraph" and "punto" / "period" as an opt-in table. Deterministic, testable, and instant. The filler words are my examples, not from a source; whether Moonshine even emits fillers is unverified.
- **Punctuation restoration model:** the one multilingual option found, `1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase` (47 languages incl. Spanish, Apache-2.0), has a 1.11 GB `model.onnx` (HF tree API). Too large to justify when the ASR already punctuates.
- **Local LLM cleanup:** WebLLM runs "accelerated with WebGPU" ([web-llm README#L20](https://github.com/mlc-ai/web-llm/blob/main/README.md)); llama.cpp is MIT and native. Handy offers "post-processing" as a separate toggle ([README.md#L100](https://github.com/cjpais/Handy/blob/8f9cf53cd1410cda26beea39ff802ac306e39585/README.md#L100)). My opinion: an LLM rewrite of an author's words is a product decision with real risk (it changes voice), and it needs WebGPU or a multi-hundred-MB native model. Offer it later as an explicit "clean up selection" command, never automatically on live dictation.

### 3.4 Names and vocabulary

Pass the open Chapter's text (or a Book's names list) to `setContext()`; Moonshine picks rare tokens itself and it "follows whichever language the loaded model was built for" ([domain-customization.md#L27-L46](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/docs/models/domain-customization.md#L27)). Keep the cap modest; long lists cost general accuracy (same doc, "What a long list costs"). For fiction with invented names, this is the most valuable correction feature on the list.

---

## 4. Non-blocking architecture

### 4.1 Audio capture per platform

- **Web.** `getUserMedia` + AudioWorklet; AudioWorklet is Chrome 66+, Safari 14.1+, Firefox 76+ (MDN BCD). The worklet should post to the transcription Worker directly (via a `MessageChannel` port) so the main thread never touches audio. Moonshine's `MicTranscriber` routes chunks through the main thread (section 1.5).
- **Linux (WebKitGTK).** `enable-media-stream` "Default Value: FALSE" ([WebKitSettings docs](https://webkitgtk.org/reference/webkit2gtk/stable/property.Settings.enable-media-stream.html)). wry 0.53.5 sets WebGL and WebAudio on but never media stream and adds no permission handler on Linux (`wry-0.53.5/src/webkitgtk/mod.rs:424-446`); a search of `tauri-2.9.5` and `tauri-runtime-wry` for `media_stream` finds nothing. Tauri issue [#15277](https://github.com/tauri-apps/tauri/issues/15277) (WebKitGTK 2.50.4) reports `NotAllowedError` with a `permission-request` allow hook, later closed by the reporter as a local integration problem, "we need to validate against the working Handy implementation". A permission-handler API for Tauri is still an open request ([#14753](https://github.com/tauri-apps/tauri/issues/14753)). Maibuk's AppImage also sets `bundleMediaFramework: false` (`src-tauri/tauri.conf.json`), which would matter for GStreamer-backed capture. Capturing in Rust with `cpal` avoids all of this.
- **Windows (WebView2).** wry only auto-allows clipboard read in `PermissionRequested` (`wry-0.53.5/src/webview2/mod.rs:496-506`), so mic access shows WebView2's prompt; users report no way to re-prompt after denial ([tauri#8606](https://github.com/tauri-apps/tauri/issues/8606)). Rust capture avoids this too.
- **Android.** wry's `onPermissionRequest` asks for `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` at runtime for `AUDIO_CAPTURE` (`wry-0.53.5/src/android/kotlin/RustWebChromeClient.kt:94-118`), but Maibuk's manifest declares only `INTERNET` (`src-tauri/gen/android/app/src/main/AndroidManifest.xml:3`). Both permissions must be added. A Tauri Kotlin plugin can declare permissions and gets generated `checkPermissions`/`requestPermissions` commands ([Tauri mobile plugin docs](https://v2.tauri.app/develop/plugins/develop-mobile/)).
- **macOS.** `NSMicrophoneUsageDescription` "is required if your app uses APIs that access the device’s microphone" ([Apple](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription)). Maibuk has no `Info.plist` today.

### 4.2 Where inference runs

| Target | Capture | Inference | To the editor |
| --- | --- | --- | --- |
| Web | AudioWorklet | `SttWorkerHost` Worker (WASM) | `postMessage`, text only |
| Tauri desktop | `cpal` in Rust | Moonshine C API on a Rust thread | Tauri Channel |
| Tauri Android | Moonshine Android library (Kotlin) | same library, native | plugin event (`trigger`) |

Tauri docs: "The event system is not designed for low latency or high throughput situations", while "Channels are designed to be fast and deliver ordered data" ([Calling the frontend from Rust](https://v2.tauri.app/develop/calling-frontend/)). Only text crosses the bridge, a few messages per second, so either works; Channels keep ordering.

This fits Maibuk's existing platform adapter layout: `src/lib/platform/index.ts` picks `web/` or `tauri/` implementations at build time with `IS_WEB`, `IS_ANDROID`, `IS_DESKTOP` (`src/lib/platform/index.ts:11-18`, `:42-46`). A `DictationEngine` interface with `start`, `stop`, `setContext`, and `onLineText`/`onLineCompleted` callbacks, one implementation per row above, keeps the editor code identical everywhere.

### 4.3 SharedArrayBuffer and COOP/COEP

- MDN BCD 8.1.3: `SharedArrayBuffer` is Chrome 68, Safari 15.2, Firefox 79, and **`false` for Android WebView**; `crossOriginIsolated` is Android WebView 87. So the published threaded Moonshine WASM cannot run inside Maibuk's Android app, whatever the headers.
- Tauri desktop: `app.security.headers` accepts `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`, sent on responses from the app's protocol ([Tauri config reference, HeaderConfig](https://v2.tauri.app/reference/config/)). Maibuk's `tauri.conf.json` has none today. With native inference on desktop, WASM is not needed there.
- Web: Workers static assets read a `_headers` file (`/*` patterns, up to 100 rules) ([Cloudflare _headers](https://developers.cloudflare.com/workers/static-assets/headers/)). Maibuk already ships `public/_headers` for `/embed`. Adding `COOP: same-origin` + `COEP: require-corp` to `/*` makes every cross-origin subresource need CORP or CORS. That would break, for example, chapter images hot-linked from other sites. Measure what breaks, or build Moonshine's single-thread WASM and skip the headers.

### 4.4 WebGPU per webview

MDN BCD 8.1.3: WebGPU in Chrome/Edge 144+ ("Linux (Intel Gen12+ GPUs only)"), Safari 26, Android WebView 121. WebKit's CMake default for `ENABLE_WEBGPU` is `OFF` and the GTK port options do not turn it on ([WebKitFeatures.cmake#L308](https://github.com/WebKit/WebKit/blob/73aa6c89e2cb77c46184a81aec944e4ab99d114d/Source/cmake/WebKitFeatures.cmake#L308)). Moonshine does not use WebGPU, so this matters only for the rejected Transformers.js and WebLLM paths.

---

## 5. Fit matrix

Latency is the vendor's own figure; "Spanish" is WER on the vendor's panel (not comparable across rows).

| Candidate | Offline | Streaming partials | Latency (vendor) | Spanish | Desktop / Android / Web | Size (es) | License (code / weights) | Maintenance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Moonshine streaming (Tiny/Small)** | Yes, if models self-hosted | Yes, native | 69 / 165 ms end-of-speech on x86; 92 / 234 ms Pixel 10a (English) | 6.2% / 4.9% FLEURS+MLS | C API / Android AAR (minSdk 26) / WASM (threads need COOP+COEP) | 32 MB / 122 MB | MIT / MIT | Very active, v0.1.x |
| whisper.cpp | Yes | Emulated (re-decode window) | 1,141 ms Whisper Tiny x86 (Moonshine's benchmark); 3.3 s whisper-streaming | Multilingual, not checked | Rust crate / Android example / WASM | 75–466 MiB | MIT / MIT | Very active |
| Transformers.js | Yes | Via Whisper/Voxtral only | Not measured | Moonshine es only as v1 Base (non-commercial) | Web only (in webviews) | varies | Apache / varies | Active |
| Vosk small | Yes | Yes | Not stated | 16.0% CV, 11.2% MLS; no punctuation | Rust crate / Android / stale WASM | 39 MB | Apache / Apache | Slow (last release 2024-04) |
| sherpa-onnx + Kroko es | Yes | Yes | Not stated | Not stated | Rust crate / Android / WASM (build) | 124 MB compressed | Apache / CC-BY-SA | Active (toolkit) |
| Parakeet v3 (sherpa-onnx) | Yes | No (chunked, 2 s) | RTF 0.088–0.22 on Cortex-A76 | 3.45% FLEURS es_419 | Desktop yes; Android heavy; web impractical | ~640 MB int8 | CC-BY-4.0 | Active |
| Canary-180m-flash | Yes | No | Not stated | Not stated here | via sherpa-onnx | 154 MB compressed int8 | CC-BY-4.0 | Active |
| Voxtral Mini 4B Realtime | Yes | Yes | 480 ms delay | 3.31% FLEURS | GPU ≥16 GB BF16 | multi-GB | Apache-2.0 | Active |
| Kyutai STT | Yes | Yes | 0.5 s | **No Spanish** | Rust/MLX server | ~1B params | Apache / CC-BY-4.0 | Last push 2026-01 |
| Web Speech API | **No** by default; on-device only Chrome/Edge 139+ desktop | Yes | n/a | Vendor | Not in any Tauri webview | n/a | n/a | Draft spec |
| Android `SpeechRecognizer` on-device | Yes (API 31+) | Yes (partial results) | n/a | Device-dependent | Android only | OS | OS | OS |
| Windows speech dictation | **No** (web service) | n/a | n/a | n/a | Windows only | OS | OS | OS |

**Recommendation:** Moonshine streaming, native on Tauri (Rust C API on desktop, Kotlin AAR on Android) and WASM-in-Worker on the web; sherpa-onnx is the fallback toolkit if the spike fails Moonshine; Parakeet v3 is a possible later desktop "polish" pass.

---

## 6. Risks

1. **Maturity and model churn (high).** v0.1.5; WASM npm package first published 2026-08-07; model dirs re-quantized and re-dated (`quantized_26_08_24`); Spanish weights are one checkpoint snapshot ("pin the revision of this repository rather than tracking `main`", small-es card). Training is mostly Whisper pseudo-labels, evaluation is read speech only. Mitigation: pin exact files by checksum (the manifest carries CRC32C), host them, and keep the engine behind `DictationEngine` so sherpa-onnx can replace it.
2. **Platform plumbing (high).** Four separate paths: Linux capture (WebKitGTK media stream off by default), Android (no `SharedArrayBuffer`, `minSdk 26` vs Maibuk's 24, missing `RECORD_AUDIO`), Windows (WebView2 prompt behavior if the webview captures), web (COOP/COEP side effects, 25 MiB per-file limit). Mitigation: Rust capture on desktop; Kotlin plugin on Android; single-thread WASM on the web if the headers break too much.
3. **Unmeasured author-facing quality (medium-high).** Punctuation, Spanish `¿`/`¡`, fillers, accents other than European read speech, and first-partial latency are unmeasured. Mitigation: the spike below, with Andy's own Spanish and English recordings.
4. **Editor integration (medium).** Wrong anchoring could fight the caret or flood the undo stack. Mitigation: decoration for interim text, one `closeHistory` transaction per completed line, keyboard and screen-reader tests per AGENTS.md (a Command in `shortcut-registry.ts`, a live region announcing "Listening", an E2E row).
5. **Tutorial and background-job rules.** Dictation writes through the editor's normal save path, so it inherits Tutorial Library gating. Model downloads are a new background job and must check `isTutorialLibraryActive()` per AGENTS.md.

---

## 7. What the spike must measure

Target hardware: one mid-range Android phone (Pixel 6a class or older), one Linux x86 laptop, one Windows laptop, Chrome for the web build. Model: Tiny and Small Streaming, es and en.

| Measure | How | Pass bar (proposed) |
| --- | --- | --- |
| First-partial latency | time from speech onset (VAD) to first `LineTextChanged` | ≤ 700 ms on Android Tiny |
| Final latency | end of speech to `LineCompleted` (Moonshine's own metric) | ≤ 300 ms desktop, ≤ 500 ms Android |
| Compute load (inverse RTF) | Moonshine `benchmark` percentage; Android via the library | ≤ 40% of one big core on Android Tiny |
| Spanish WER + punctuation | 10 minutes of Andy reading his own prose, es and en; score WER and separately punctuation F1 and `¿`/`¡` | WER ≤ 10% with VAD on; punctuation usable without edits for most sentences |
| Filler behavior | scripted "eh", "este", "um" | known: kept or dropped |
| Main-thread long tasks | Chrome Performance panel + `PerformanceObserver('longtask')` during 5 min dictation while typing | zero tasks > 50 ms attributable to dictation |
| Typing latency with dictation on | Maibuk's Android input measurement (AGENTS.md "Editor latency") | no regression vs dictation off |
| Memory | peak RSS (desktop), `dumpsys meminfo` (Android), tab memory (web) | record; no OOM on the Android device |
| WASM bundling | Vite build resolves `stt-worker.js` and pthread workers; works with COOP/COEP; single-thread build speed | loads offline after first visit |
| Linux capture | `cpal` in Rust on X11 and Wayland | works without webview permissions |

---

## Sources

Moonshine (tag `v0.1.5` unless noted)
- README, LICENSE, `docs/models/available-models.md`, `accuracy.md`, `quantization.md`, `domain-customization.md`, `papers.md`, `docs/moonshine-vs-whisper.md`, `docs/using/transcription.md`, `benchmarks.md`, `adding-the-library.md`: https://github.com/moonshine-ai/moonshine/tree/v0.1.5
- WASM binding: `language-bindings/wasm/{README.md,package.json,src/mic-transcriber.ts,src/stt-worker.ts,src/stt-worker-host.ts,src/asset-downloader.ts,src/index.ts}`
- Core: `core/moonshine-c-api.h`, `core/moonshine-model-catalog.cpp`, `core/moonshine-model-file-metadata.generated.cpp`; Android: `language-bindings/android/build.gradle.kts`
- Examples: `examples/web/meeting-notes/index.html`, `examples/web/dictation/index.html`
- Papers: https://arxiv.org/abs/2410.15608, https://arxiv.org/abs/2509.02523, https://arxiv.org/abs/2602.12241
- HF: https://huggingface.co/moonshine-ai/moonshine-streaming-small-es, https://huggingface.co/moonshine-ai/moonshine-streaming-tiny-es
- Maven: https://repo1.maven.org/maven2/ai/moonshine/moonshine-voice/maven-metadata.xml
- MoonshineJS (archived): https://github.com/moonshine-ai/moonshine-js

Alternatives
- whisper.cpp README and `examples/{whisper.wasm,stream.wasm}/README.md` at `d09f61a`; whisper-streaming https://arxiv.org/abs/2307.14743
- Transformers.js README and tree at `836b9cb`
- Vosk models: https://alphacephei.com/vosk/models
- sherpa-onnx: https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/index.html, https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html, https://k2-fsa.github.io/sherpa/onnx/punctuation/pretrained_models.html, `wasm/asr/CMakeLists.txt` and `build-wasm-simd-asr.sh` at `040afe3`, release `asr-models`
- Kroko: https://huggingface.co/Banafo/Kroko-ASR
- NVIDIA: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3, https://huggingface.co/nvidia/canary-180m-flash
- Kyutai: https://huggingface.co/kyutai/stt-1b-en_fr; Voxtral: https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602, https://arxiv.org/abs/2602.11298
- Web Speech API: https://webaudio.github.io/web-speech-api/; MDN: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API, https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally; `@mdn/browser-compat-data` 8.1.3
- WebView2: https://github.com/MicrosoftEdge/WebView2Feedback/issues/5724
- Android: https://developer.android.com/reference/android/speech/SpeechRecognizer
- Windows: https://learn.microsoft.com/en-us/windows/apps/design/input/speech-recognition
- Apple: https://developer.apple.com/documentation/speech/speechanalyzer, https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription
- Handy: https://github.com/cjpais/Handy (README, `src-tauri/Cargo.toml` at `8f9cf53`)
- tauri-plugin-stt: https://github.com/brenogonzaga/tauri-plugin-stt
- WebLLM: https://github.com/mlc-ai/web-llm; punctuation model: https://huggingface.co/1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase

Platform
- WebKit `Source/cmake/OptionsGTK.cmake`, `Source/cmake/WebKitFeatures.cmake` at `73aa6c8`; WebKitGTK: https://webkitgtk.org/reference/webkit2gtk/stable/property.Settings.enable-media-stream.html
- wry `0.53.5` (local cargo registry): `src/webkitgtk/mod.rs`, `src/webview2/mod.rs`, `src/android/kotlin/RustWebChromeClient.kt`
- Tauri: https://v2.tauri.app/reference/config/, https://v2.tauri.app/develop/calling-frontend/, https://v2.tauri.app/develop/plugins/develop-mobile/, issues #6208, #8606, #14753, #15277
- Cloudflare: https://developers.cloudflare.com/workers/static-assets/headers/, https://developers.cloudflare.com/workers/platform/limits/
- ProseMirror (installed): `prosemirror-history@1.5.0/src/history.ts`, `prosemirror-view@1.41.4/src/decoration.ts`, `prosemirror-transform@1.10.5/src/map.ts`

---

## Verification log

Passes run:

1. **Source reads.** Moonshine was shallow-cloned at `v0.1.5` and every Moonshine claim was read in the file cited. The published `0.1.5` npm tarball was unpacked to confirm the threaded build (`PThread`, `SharedArrayBuffer` in `moonshine.mjs`) and the 13.16 MB `.wasm`. Model sizes were computed by a script over `moonshine-model-file-metadata.generated.cpp`, excluding `*_with_attention.ort` per `moonshine-model-catalog.cpp:291-306`. wry was read from the local cargo registry at the version in `Cargo.lock`; ProseMirror from `node_modules`.
2. **Registry and repo metadata.** `npm view` (moonshine-wasm, moonshine-js, transformers, vosk-browser, sherpa-onnx), crates.io API (whisper-rs, sherpa-onnx, transcribe-rs, vosk, moonshine-rs), Maven Central metadata, HF model API (revisions, licenses, languages), `gh api` (stars, pushes, releases, archived flags, sherpa-onnx `asr-models` assets), MDN BCD 8.1.3 unpacked and queried by script.
3. **Docs, specs, cards, papers.** Web Speech spec, MDN, Android, Microsoft Learn, Apple doc JSON, WebKitGTK, Tauri, Cloudflare pages fetched; arXiv abstracts fetched; model cards read in raw Markdown.

### Could not verify

- **Moonshine accuracy and latency on Maibuk's targets.** All numbers are vendor-measured, English-only for latency, native not WASM, and "end of speech to final", not first partial. Settle: the spike in section 7. **Settled by the [spike](#spike-results-2026-09-27), latency only:** web (Chromium) and Linux native are measured; Android, Windows, and WER on Andy's recordings are still open.
- **Parameter counts.** Docs say 123M/34M (Small/Tiny Streaming); the Spanish HF cards say 112.9M/27.0M. Settle: count tensors in the HF safetensors, or ask on Moonshine's Discord.
- **Spanish punctuation, `¿`/`¡`, and fillers in Moonshine output.** WER is computed after normalization. Settle: transcribe a Spanish recording and inspect. **Settled by the [spike](#spike-results-2026-09-27):** Spanish output has no capitals and no punctuation at all; fillers are still unmeasured.
- **Moonshine memory use** (RAM for Tiny/Small, native and WASM). Not documented. Settle: measure in the spike. **Settled by the [spike](#spike-results-2026-09-27):** native 155 MB (Tiny es) to 477 MB (Small en) peak RSS; web +512 to +890 MB across browser processes.
- **Moonshine WASM under Vite.** Whether Vite rewrites `new URL('./stt-worker.js', import.meta.url)` inside the dependency and whether pthread workers resolve under Tauri's custom protocol. Settle: a build of the web target with the package. **Settled by the [spike](#spike-results-2026-09-27):** the package's worker does not survive Maibuk's Vite config; a Maibuk-owned worker does.
- **Single-thread Moonshine WASM speed.** Not published. Settle: build with `-DMOONSHINE_WASM_SINGLE_THREAD=ON` and benchmark.
- **Android WebView `SharedArrayBuffer`.** Based on MDN BCD (`version_added: false`), not a device test. Settle: `typeof SharedArrayBuffer` and `crossOriginIsolated` inside Maibuk's Android build with COOP/COEP set through `app.security.headers`.
- **Whether `app.security.headers` apply on Android and Linux.** The Tauri page does not state platform limits. Settle: read response headers in each webview's devtools.
- **Linux webview mic with `enable-media-stream` on.** Tauri #15277 was closed as a local integration problem, so it may work with the right setup. Settle: a minimal Tauri app enabling the setting via `with_webview` and handling `permission-request`. **Settled by the [spike](#spike-results-2026-09-27):** denied with `NotAllowedError`; Rust `cpal` capture is the path.
- **WebKitGTK `SpeechRecognition`.** The GTK options list no speech recognition option; not tested at runtime. Settle: `'webkitSpeechRecognition' in window` in Maibuk's Linux build. **Settled by the [spike](#spike-results-2026-09-27):** absent.
- **Android WebView `SpeechRecognition`.** BCD lists it (139, and prefixed since 4.4.3) but without `processLocally`. Settle: device test. Irrelevant for "offline" either way.
- **WebKitGTK WebGPU in distro builds.** CMake default is off; distributions may differ. Settle: `navigator.gpu` in the Linux build. **Settled by the [spike](#spike-results-2026-09-27):** absent.
- **Android on-device `SpeechRecognizer` Spanish quality and continuity.** Vendor- and device-dependent. Settle: device test.
- **Whisper Spanish WER per model size.** Not extracted from the Whisper paper's appendix. Settle: read Appendix D.2.4 of https://cdn.openai.com/papers/whisper.pdf.
- **Kroko Spanish accuracy.** No WER found in the sources read. Settle: Kroko's own benchmark page or a spike run.
- **sherpa-onnx WASM threading.** Inferred single-threaded from CMake flags without `-pthread`; not run. Settle: build and check `crossOriginIsolated` requirement.
- **Voxtral Realtime on consumer hardware.** Card claims on-device suitability but documents a ≥16 GB GPU for BF16; no quantized build checked. Settle: look for an official GGUF/ONNX int4 build and measure.
- **Whether Maibuk's minSdk 24 can link Moonshine's AAR.** Gradle manifest merge normally fails on a higher library `minSdk` unless overridden; not tried. Settle: add the dependency and run `pnpm build:android`.

---

## Spike results (2026-09-27)

The spike is throwaway and lives on the `spike-voice-dictation` branch (never merges): its README, the dictation page and worker, the Rust engine, and a Tauri shell behind a `dictation-spike` Cargo feature. It answered section 7 for the web and Linux desktop paths. Android, Windows, and accuracy on real recordings are still open. The branch's own README, `spike/dictation/README.md`, holds the raw tables.

Moonshine streaming works on both paths, fast enough, with zero main-thread jank. But four things the research above assumed are wrong:

1. **Spanish output has no capitals and no punctuation.** Tiny and Small Spanish both return lowercase text with no commas, periods, `¿` or `¡`. Both English models return cased, punctuated text. Nothing in Moonshine's repo or the model cards says so. Recommendation 7's "rely on the model's own case and punctuation" holds for English only; Spanish needs a punctuation and truecasing pass before v1.
2. **The npm package is stale.** The catalog of `@moonshine-ai/moonshine-wasm@0.1.5` has no Spanish streaming model and rejects the current `frontend.model.ort` + `frontend.weights.ort` layout. The WASM in the GitHub release `moonshine-voice-wasm.tar.gz` (same tag) is current. `pnpm fetch:dictation` vendors that release, not npm.
3. **The package's `SttWorkerHost` cannot be bundled by Vite.** Vite copies its `new URL("./stt-worker.js", import.meta.url)` as a raw asset so its `import "./transcriber.js"` 404s, inlines the base URL as a base64 `data:` URL, and rewrites the Emscripten pthread spawn. Maibuk owns its worker instead (`src/lib/platform/web/dictation/worker.ts`), which also lets the AudioWorklet post straight to it so the main thread never touches audio.
4. **Default settings miss the latency bars.** With defaults the first partial lands about 1 s after speech starts. Two settings fix it: `transcription_interval=0.2` (a core option, default 0.5) plus, on the web, the JS `Stream` `updateInterval=0.2` (a second, separate gate). On native, `MOONSHINE_ORT_SINGLE_THREAD=1` is required or ONNX Runtime spins 5 to 7 cores for Tiny English.

Confirmed from the Tauri shell on this machine (WebKitGTK, `AppleWebKit/605.1.15`):

- `getUserMedia` fails with `NotAllowedError`. Webview mic capture is out on Linux; Rust capture is the path.
- `SharedArrayBuffer` is `false` even with `crossOriginIsolated === true`. The threaded WASM cannot run in WebKitGTK at all, so desktop must be native.
- No `SpeechRecognition`, no WebGPU, and no Long Tasks API in WebKitGTK.

Against section 7's bars, measured: first partial 0.34 to 0.64 s p50 (Tiny Spanish is the exception at 0.84 to 0.88 s), final line 33 to 260 ms p50, zero main-thread long tasks while typing, native memory 155 MB (Tiny es) to 477 MB (Small en) peak RSS, web +512 to +890 MB. Spanish WER on Andy's recordings, fillers, Android, and Windows remain unmeasured.

What production code needs out of this: own the worker, vendor the release WASM, bundle the two Linux `.so` files with an `$ORIGIN` rpath, add `libasound2-dev` as a Linux build dependency, guard the null `lines` pointer `moonshine_transcribe_stream` returns when there are no lines, and add a Spanish punctuation and truecasing pass before v1.
