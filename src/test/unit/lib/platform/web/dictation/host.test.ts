import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebRecognizerHost } from "@/lib/platform/web/dictation/host";
import type { DictationEvent, ModelSpec } from "@/features/dictation/types";

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  postMessage(msg: { id?: number; type: string }) {
    this.posted.push(msg);
    if (msg.id !== undefined)
      queueMicrotask(() =>
        this.onmessage?.({ data: { type: "ok", id: msg.id } } as MessageEvent),
      );
  }
  emit(event: DictationEvent) {
    this.onmessage?.({ data: { type: "event", event } } as MessageEvent);
  }
  terminate() {}
}

const spec = { id: "m" } as ModelSpec;
let worker: FakeWorker;

beforeEach(() => {
  worker = new FakeWorker();
  vi.stubGlobal("crossOriginIsolated", true);
  vi.stubGlobal("SharedArrayBuffer", ArrayBuffer);
  vi.stubGlobal("AudioWorkletNode", class {});
});
afterEach(() => vi.unstubAllGlobals());

describe("WebRecognizerHost", () => {
  it("is unsupported without cross-origin isolation", async () => {
    vi.stubGlobal("crossOriginIsolated", false);
    const host = createWebRecognizerHost({
      createWorker: () => worker as unknown as Worker,
    });
    expect(await host.isSupported()).toEqual({
      supported: false,
      reason: "not_isolated",
    });
  });

  it("maps a denied microphone to mic_denied", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("no", "NotAllowedError");
        }),
      },
    });
    const host = createWebRecognizerHost({
      createWorker: () => worker as unknown as Worker,
    });
    await host.load(spec);
    await expect(host.start(() => {})).rejects.toMatchObject({
      code: "mic_denied",
    });
  });

  it("maps a missing microphone to mic_unavailable", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("no", "NotFoundError");
        }),
      },
    });
    const host = createWebRecognizerHost({
      createWorker: () => worker as unknown as Worker,
    });
    await expect(host.start(() => {})).rejects.toMatchObject({
      code: "mic_unavailable",
    });
  });

  it("reports a worker crash as engine_crashed", async () => {
    const events: DictationEvent[] = [];
    const host = createWebRecognizerHost({
      createWorker: () => worker as unknown as Worker,
    });
    await host.load(spec);
    (
      host as unknown as { attach(l: (e: DictationEvent) => void): void }
    ).attach((e) => events.push(e));
    worker.onerror?.({ message: "boom" } as ErrorEvent);
    expect(events).toEqual([
      { type: "error", code: "engine_crashed", detail: "boom" },
    ]);
  });
});
