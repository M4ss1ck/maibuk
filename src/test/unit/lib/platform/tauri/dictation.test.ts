import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (args: Record<string, unknown>) => unknown;
const handlers: Record<string, Handler> = {};
class FakeChannel<T> {
  onmessage: (m: T) => void = () => {};
}
vi.mock("@tauri-apps/api/core", () => ({
  Channel: FakeChannel,
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    const h = handlers[cmd];
    if (!h) throw new Error(`no handler ${cmd}`);
    return h(args);
  }),
}));
const { createTauriRecognizerHost, tauriModelFiles } =
  await import("@/lib/platform/tauri/dictation");
const { invoke } = await import("@tauri-apps/api/core");

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  vi.mocked(invoke).mockClear();
});

describe("TauriRecognizerHost", () => {
  it("delivers events and resolves stop only after the stopped marker", async () => {
    let channel: FakeChannel<unknown> | null = null;
    handlers.dictation_start = ({ onEvent }) => {
      channel = onEvent as FakeChannel<unknown>;
    };
    handlers.dictation_stop = () => {
      setTimeout(() => {
        channel!.onmessage({
          kind: "event",
          event: { type: "final", text: "fin" },
        });
        channel!.onmessage({ kind: "stopped" });
      }, 10);
    };
    const events: unknown[] = [];
    const host = createTauriRecognizerHost();
    await host.start((e) => events.push(e));
    channel!.onmessage({
      kind: "event",
      event: { type: "partial", text: "fi" },
    });
    await host.stop();
    expect(events).toEqual([
      { type: "partial", text: "fi" },
      { type: "final", text: "fin" },
    ]);
  });

  it("turns a rejected command into a DictationError with its code", async () => {
    handlers.dictation_load = () => {
      throw { code: "model_corrupt", detail: "a.ort" };
    };
    await expect(
      createTauriRecognizerHost().load({ id: "m" } as never),
    ).rejects.toMatchObject({ code: "model_corrupt" });
  });

  it("reports library_missing as unsupported", async () => {
    handlers.dictation_is_supported = () => ({
      supported: false,
      reason: "library_missing",
    });
    expect(await createTauriRecognizerHost().isSupported()).toEqual({
      supported: false,
      reason: "library_missing",
    });
  });

  it("uses the exact command names and argument keys", async () => {
    for (const name of [
      "dictation_is_supported", "dictation_load", "dictation_start",
      "dictation_stop", "dictation_set_context", "dictation_unload",
      "dictation_input_device", "dictation_models_install",
      "dictation_models_cancel", "dictation_models_is_complete",
      "dictation_models_remove",
    ]) handlers[name] = () => undefined;
    const host = createTauriRecognizerHost();
    const spec = { id: "m" } as never;
    await host.isSupported();
    await host.load(spec);
    await host.start(() => {});
    await host.setContext("context");
    await host.inputDevice();
    await host.dispose();
    await tauriModelFiles.isComplete(spec);
    await tauriModelFiles.remove("m");
    const abort = new AbortController();
    await tauriModelFiles.install(spec, () => {}, abort.signal);
    abort.abort();
    const calls = vi.mocked(invoke).mock.calls;
    expect(calls.map(([name]) => name)).toEqual([
      "dictation_is_supported", "dictation_load", "dictation_start",
      "dictation_set_context", "dictation_input_device", "dictation_unload",
      "dictation_models_is_complete", "dictation_models_remove",
      "dictation_models_install",
    ]);
    expect(calls[1][1]).toEqual({ spec });
    expect(Object.keys(calls[2][1] as object)).toEqual(["onEvent"]);
    expect(calls[3][1]).toEqual({ text: "context" });
    expect(calls[6][1]).toEqual({ spec });
    expect(calls[7][1]).toEqual({ id: "m" });
    expect(Object.keys(calls[8][1] as object)).toEqual(["spec", "onProgress"]);
  });

  it("stop resolves when the runner already ended", async () => {
    let channel: FakeChannel<unknown> | null = null;
    handlers.dictation_start = ({ onEvent }) => {
      channel = onEvent as FakeChannel<unknown>;
    };
    handlers.dictation_stop = () => {};
    const host = createTauriRecognizerHost();
    await host.start(() => {});
    channel!.onmessage({ kind: "stopped" });
    await expect(host.stop()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("dictation_stop", undefined);
  });

  it("stop resolves without a stopped message when start was never called", async () => {
    handlers.dictation_stop = () => {};
    const host = createTauriRecognizerHost();
    await expect(host.stop()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("dictation_stop", undefined);
  });

  it("stop resolves when dictation_start rejected", async () => {
    handlers.dictation_start = () => {
      throw { code: "mic_denied" };
    };
    handlers.dictation_stop = () => {};
    const host = createTauriRecognizerHost();
    await expect(host.start(() => {})).rejects.toMatchObject({
      code: "mic_denied",
    });
    await expect(host.stop()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("dictation_stop", undefined);
  });
});

describe("tauriModelFiles", () => {
  it("reports progress and cancels through the command", async () => {
    const cancel = vi.fn();
    handlers.dictation_models_cancel = cancel;
    handlers.dictation_models_install = async ({ onProgress }) => {
      (onProgress as FakeChannel<[number, number]>).onmessage([5, 10]);
      await new Promise((r) => setTimeout(r, 20));
      throw { code: "cancelled" };
    };
    const progress: number[] = [];
    const controller = new AbortController();
    const install = tauriModelFiles.install(
      { id: "m" } as never,
      (d) => progress.push(d),
      controller.signal,
    );
    controller.abort();
    await expect(install).rejects.toMatchObject({ code: "cancelled" });
    expect(progress).toEqual([5]);
    expect(cancel).toHaveBeenCalledWith({ id: "m" });
  });

  it("install rejects an already-aborted signal without invoking anything", async () => {
    handlers.dictation_models_install = () => undefined;
    const controller = new AbortController();
    controller.abort();
    await expect(
      tauriModelFiles.install({ id: "m" } as never, () => {}, controller.signal),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(invoke).not.toHaveBeenCalledWith(
      "dictation_models_install",
      expect.anything(),
    );
  });
});
