// PROTOTYPE. Maibuk-owned transcription worker. Replaces the package's
// SttWorkerHost/stt-worker.js pair, which Vite cannot bundle:
//   - new URL("./stt-worker.js", import.meta.url) is copied as a raw asset, so
//     its `import "./transcriber.js"` 404s;
//   - new URL("./", import.meta.url) (moonshineWasmBaseUrl) is inlined as a
//     base64 data: URL of index.js;
//   - the Emscripten glue's pthread spawn is rewritten to self.location.href.
// Here the glue is loaded from its own ?url asset and handed to Emscripten as
// mainScriptUrlOrBlob, so pthread workers load the same file.
// Audio arrives on a MessagePort straight from the AudioWorklet; the page's
// main thread never touches PCM.
import { ModelArch, type Stream, Transcriber, type TranscriptLine } from "moonshine";
import mjsUrl from "./vendor/moonshine-wasm/dist/moonshine.mjs?url";
import wasmUrl from "./vendor/moonshine-wasm/dist/moonshine.wasm?url";

type In =
  | { type: "load"; model: string; files: Record<string, string>; interval: number; options: Record<string, string> }
  | { type: "audio-port"; port: MessagePort; sampleRate: number }
  | { type: "start" }
  | { type: "stop" }
  | { type: "context"; text: string };

const now = () => performance.timeOrigin + performance.now();
const post = (m: unknown) => postMessage(m);

let transcriber: Transcriber | null = null;
let stream: Stream | null = null;
let sampleRate = 16000;
let running = false;

// Absolute time each chunk reached the worker, by stream-second.
let receivedSec = 0;
const received: { audioEnd: number; at: number }[] = [];
const atAudio = (s: number) => received.find((r) => r.audioEnd >= s)?.at ?? Number.NaN;
const firstText = new Map<string, number>();

let passQueued = false;
function queuePass() {
  if (passQueued) return;
  passQueued = true;
  setTimeout(() => {
    passQueued = false;
    if (!stream || !running) return;
    const t0 = performance.now();
    try {
      stream.transcribe();
    } finally {
      post({ type: "pass", ms: performance.now() - t0 });
    }
  }, 0);
}

function lineEvent(name: string, line: TranscriptLine) {
  const at = now();
  let firstPartialMs: number | undefined;
  let finalMs: number | undefined;
  if (name === "onLineTextChanged" && line.text.trim() && !firstText.has(line.id)) {
    firstText.set(line.id, at);
    firstPartialMs = at - atAudio(line.startTime);
  }
  if (name === "onLineCompleted") finalMs = at - atAudio(line.startTime + line.duration);
  post({ type: "event", name, line, at, firstPartialMs, finalMs, audioAt: receivedSec });
}

async function load(msg: Extract<In, { type: "load" }>) {
  const rawFactory = (await import(/* @vite-ignore */ mjsUrl)).default;
  const t0 = performance.now();
  transcriber?.close();
  transcriber = await Transcriber.loadFromUrls(msg.files, {
    modelArch: msg.model.startsWith("small") ? ModelArch.SmallStreaming : ModelArch.TinyStreaming,
    options: Object.keys(msg.options).length ? msg.options : undefined,
    moduleOptions: {
      factory: (opts?: Record<string, unknown>) =>
        rawFactory({
          ...opts,
          mainScriptUrlOrBlob: new URL(mjsUrl, self.location.href).href,
          locateFile: (p: string) => (p.endsWith(".wasm") ? new URL(wasmUrl, self.location.href).href : p),
        }),
    },
    onProgress: (loaded: number, total: number | undefined, file: string) => post({ type: "progress", loaded, total, file }),
  });
  stream = transcriber.createStream({ updateInterval: msg.interval });
  stream.addListener({
    onLineStarted: ({ line }) => lineEvent("onLineStarted", line),
    onLineTextChanged: ({ line }) => lineEvent("onLineTextChanged", line),
    onLineCompleted: ({ line }) => lineEvent("onLineCompleted", line),
    onError: ({ error }) => post({ type: "error", message: String(error) }),
  });
  post({ type: "loaded", ms: performance.now() - t0 });
}

self.onmessage = async (e: MessageEvent<In>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "load":
        await load(msg);
        break;
      case "audio-port":
        sampleRate = msg.sampleRate;
        msg.port.onmessage = (a: MessageEvent<Float32Array>) => {
          if (!stream || !running) return;
          stream.addAudio(a.data, sampleRate);
          receivedSec += a.data.length / sampleRate;
          received.push({ audioEnd: receivedSec, at: now() });
          queuePass();
        };
        break;
      case "start":
        receivedSec = 0;
        received.length = 0;
        firstText.clear();
        stream?.start();
        running = true;
        post({ type: "started" });
        break;
      case "stop":
        running = false;
        stream?.stop();
        post({ type: "stopped", audioSec: receivedSec });
        break;
      case "context":
        transcriber?.setContext(msg.text);
        break;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};
