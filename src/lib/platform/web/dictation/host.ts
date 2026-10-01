import {
  DictationError,
  type DictationEvent,
  type ModelSpec,
  type RecognizerHost,
  type SupportReport,
} from "@/features/dictation/types";
// Vite asset/worker specifiers must be relative for Vite to detect them.
import workletUrl from "./capture-worklet.ts?worker&url";

type Pending = { resolve: () => void; reject: (e: DictationError) => void };

export function createWebRecognizerHost(deps: { createWorker?: () => Worker } = {}) {
  const createWorker =
    deps.createWorker ??
    (() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }));
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  let listener: ((event: DictationEvent) => void) | null = null;
  let media: MediaStream | null = null;
  let context: AudioContext | null = null;

  const ensureWorker = () => {
    if (worker) return worker;
    worker = createWorker();
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "event") return listener?.(msg.event);
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.type === "ok") slot.resolve();
      else slot.reject(new DictationError(msg.code, msg.detail));
    };
    worker.onerror = (event: ErrorEvent) => {
      const error = new DictationError("engine_crashed", event.message);
      for (const slot of pending.values()) slot.reject(error);
      pending.clear();
      listener?.({
        type: "error",
        code: "engine_crashed",
        detail: event.message,
      });
      worker?.terminate();
      worker = null;
    };
    return worker;
  };

  const rpc = (
    type: string,
    payload: Record<string, unknown> = {},
    transfer: Transferable[] = []
  ) =>
    new Promise<void>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ensureWorker().postMessage({ id, type, ...payload }, transfer);
    });

  const releaseAudio = async () => {
    media?.getTracks().forEach((track) => {
      track.stop();
    });
    media = null;
    await context?.close().catch(() => {});
    context = null;
  };

  const host: RecognizerHost & {
    attach(l: (e: DictationEvent) => void): void;
  } = {
    async isSupported(): Promise<SupportReport> {
      if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
        return { supported: false, reason: "not_isolated" };
      }
      if (typeof AudioWorkletNode === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        return { supported: false, reason: "no_audio" };
      }
      return { supported: true };
    },
    load: (spec: ModelSpec) => rpc("load", { spec }),
    async start(onEvent) {
      try {
        media = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true,
          },
        });
      } catch (error) {
        const name = (error as DOMException).name;
        throw new DictationError(
          name === "NotAllowedError" || name === "SecurityError" ? "mic_denied" : "mic_unavailable",
          name
        );
      }
      listener = onEvent;
      try {
        context = new AudioContext();
        await context.audioWorklet.addModule(workletUrl);
        const node = new AudioWorkletNode(context, "dictation-capture", {
          channelCountMode: "explicit",
          channelCount: 1,
        });
        const channel = new MessageChannel();
        node.port.postMessage({ port: channel.port1 }, [channel.port1]);
        await rpc("start", { port: channel.port2, sampleRate: context.sampleRate }, [
          channel.port2,
        ]);
        const source = context.createMediaStreamSource(media);
        const mute = context.createGain();
        mute.gain.value = 0;
        source.connect(node).connect(mute).connect(context.destination);
        media.getAudioTracks()[0]?.addEventListener("ended", () => {
          listener?.({ type: "error", code: "mic_unavailable" });
        });
      } catch (error) {
        await releaseAudio();
        listener = null;
        throw error;
      }
    },
    async stop() {
      await releaseAudio();
      if (worker) await rpc("stop");
      listener = null;
    },
    setContext: (text) => rpc("setContext", { text }),
    // The browser chooses the microphone; it has no name until permission is granted.
    inputDevice: async () => null,
    async dispose() {
      await releaseAudio();
      if (worker) await rpc("dispose");
      worker?.terminate();
      worker = null;
    },
    attach(l) {
      ensureWorker();
      listener = l;
    },
  };
  return host;
}
