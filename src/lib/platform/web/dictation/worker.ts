// The web backend: port → Resampler16k → SpeechEngine → DictationEvents.
import {
  toDictationError,
  type DictationEvent,
  type ModelSpec,
} from "@/features/dictation/types";
import { readModelFiles } from "@/lib/platform/web/dictation/cache-model-files";
import { createEngine } from "@/lib/platform/web/dictation/engines";
import {
  createResampler,
  type Resampler,
} from "@/lib/platform/web/dictation/resampler";
import type { SpeechEngine } from "@/lib/platform/web/dictation/speech-engine";

type Request =
  | { id: number; type: "load"; spec: ModelSpec }
  | { id: number; type: "start"; port: MessagePort; sampleRate: number }
  | { id: number; type: "stop" }
  | { id: number; type: "setContext"; text: string }
  | { id: number; type: "dispose" };

let engine: SpeechEngine | null = null;
let loadedId: string | null = null;
let resampler: Resampler | null = null;
let port: MessagePort | null = null;
let running = false;
let pollQueued = false;

const emit = (event: DictationEvent) => postMessage({ type: "event", event });

function poll() {
  pollQueued = false;
  if (!running || !engine) return;
  try {
    for (const event of engine.poll()) emit(event);
  } catch (error) {
    running = false;
    emit({ type: "error", code: "engine_crashed", detail: String(error) });
  }
}

async function handle(msg: Request): Promise<void> {
  switch (msg.type) {
    case "load": {
      if (loadedId === msg.spec.id && engine) return;
      const files = await readModelFiles(msg.spec);
      engine?.dispose();
      engine = createEngine(msg.spec);
      await engine.load(files, msg.spec);
      loadedId = msg.spec.id;
      return;
    }
    case "start": {
      if (!engine) throw new Error("load first");
      engine.start();
      resampler = createResampler(msg.sampleRate);
      port = msg.port;
      running = true;
      port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!running || !engine || !resampler) return;
        const chunk = event.data;
        let sum = 0;
        for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
        emit({ type: "level", rms: Math.sqrt(sum / chunk.length) });
        engine.accept(resampler.push(chunk));
        if (!pollQueued) {
          pollQueued = true;
          setTimeout(poll, 0);
        }
      };
      return;
    }
    case "stop": {
      running = false;
      port?.close();
      port = null;
      if (engine) for (const event of engine.finish()) emit(event);
      return;
    }
    case "setContext":
      engine?.setContext(msg.text);
      return;
    case "dispose":
      engine?.dispose();
      engine = null;
      loadedId = null;
      return;
  }
}

self.onmessage = (event: MessageEvent<Request>) => {
  const msg = event.data;
  handle(msg).then(
    () => postMessage({ type: "ok", id: msg.id }),
    (error) => {
      const e = toDictationError(
        error,
        msg.type === "load" ? "model_corrupt" : "engine_crashed",
      );
      postMessage({
        type: "error",
        id: msg.id,
        code: e.code,
        detail: e.message,
      });
    },
  );
};
