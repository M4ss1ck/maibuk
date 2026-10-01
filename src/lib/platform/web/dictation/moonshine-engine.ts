import { ModelArch, Transcriber, type Stream } from "moonshine-wasm";
import mjsUrl from "moonshine-wasm/moonshine.mjs?url";
import wasmUrl from "moonshine-wasm/moonshine.wasm?url";
import type { ModelSpec } from "@/features/dictation/types";
import { createLineMapper } from "@/lib/platform/web/dictation/moonshine-lines";
import type { SpeechEngine } from "@/lib/platform/web/dictation/speech-engine";

// Moonshine's own worker (SttWorkerHost) does not survive Vite: its worker is
// copied raw, its base URL is inlined as a data: URL, and its pthread spawn is
// rewritten. So the Emscripten glue loads from its own ?url asset and is
// handed to Emscripten as mainScriptUrlOrBlob, so pthreads load the same file.
const absolute = (url: string) => new URL(url, self.location.href).href;

const ARCH: Record<string, ModelArch> = {
  "tiny-streaming": ModelArch.TinyStreaming,
  "small-streaming": ModelArch.SmallStreaming,
};

export function createMoonshineEngine(): SpeechEngine {
  let transcriber: Transcriber | null = null;
  let stream: Stream | null = null;
  let mapper = createLineMapper();

  return {
    async load(files, spec: ModelSpec) {
      const { arch, ...options } = spec.engineOptions;
      const factory = (await import(/* @vite-ignore */ absolute(mjsUrl))).default;
      transcriber?.close();
      transcriber = await Transcriber.load({
        files: Object.fromEntries(files),
        modelArch: ARCH[arch],
        options,
        moduleOptions: {
          factory: (opts?: Record<string, unknown>) =>
            factory({
              ...opts,
              mainScriptUrlOrBlob: absolute(mjsUrl),
              locateFile: (path: string) => (path.endsWith(".wasm") ? absolute(wasmUrl) : path),
            }),
        },
      });
    },
    start() {
      if (!transcriber) throw new Error("load() first");
      stream?.close();
      mapper = createLineMapper();
      // The JS stream gates passes on its own interval, separate from the
      // core's transcription_interval; both must be 0.2 s for first words in ~0.6 s.
      stream = transcriber.createStream({ updateInterval: 0.2 });
      stream.addListener({
        onLineTextChanged: ({ line }) => mapper.onTextChanged(line),
        onLineCompleted: ({ line }) => mapper.onCompleted(line),
      });
      stream.start();
    },
    accept(pcm16k) {
      stream?.addAudio(pcm16k, 16000);
    },
    poll() {
      stream?.transcribe();
      return mapper.drain();
    },
    finish() {
      if (!stream) return [];
      stream.stop(); // completes the active line
      try {
        stream.transcribe();
      } catch {
        // A stopped stream may refuse another pass; stop() already flushed.
      }
      const events = mapper.drain();
      stream.close();
      stream = null;
      return events;
    },
    setContext(text) {
      transcriber?.setContext(text);
    },
    dispose() {
      stream?.close();
      transcriber?.close();
      stream = null;
      transcriber = null;
    },
  };
}
