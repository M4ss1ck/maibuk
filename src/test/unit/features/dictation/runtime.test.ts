import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUnsupportedHost, unsupportedModelFiles } from "@/lib/platform/unsupported-dictation";
import { DictationError, type ModelFiles, type ModelSpec } from "@/features/dictation/types";

const { createRecognizerHost, getModelFiles } = vi.hoisted(() => ({
  createRecognizerHost: vi.fn(),
  getModelFiles: vi.fn(),
}));
vi.mock("@/lib/platform", () => ({
  dictationPlatform: () => "web",
  createRecognizerHost,
  getModelFiles,
}));

const { getDictation, resetDictationForTests } = await import("@/features/dictation/runtime");
const { useDictationStore } = await import("@/features/dictation/store");
const { MODEL_CATALOG } = await import("@/features/dictation/catalog");

beforeEach(() => {
  resetDictationForTests();
  useDictationStore.setState({ enabled: true });
  createRecognizerHost.mockReset();
  getModelFiles.mockReset();
  getModelFiles.mockResolvedValue(unsupportedModelFiles);
});

describe("getDictation()", () => {
  it("turning Dictation off releases an active microphone and keeps models", async () => {
    const host = {
      ...createUnsupportedHost("platform"),
      load: vi.fn(async () => {}),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    };
    createRecognizerHost.mockResolvedValue(host);
    const { session } = await getDictation();
    useDictationStore.setState({ installed: [MODEL_CATALOG[0].id] });
    session.register({ id: "chapter", language: () => "en", showPartial() {}, commit() {} });
    session.focus("chapter");
    await session.start();
    expect(session.getSnapshot().status).toBe("listening");
    useDictationStore.getState().setEnabled(false);
    await vi.waitFor(() => expect(host.stop).toHaveBeenCalledTimes(1));
    expect(session.getSnapshot().status).toBe("idle");
    expect(useDictationStore.getState().installed).toEqual([MODEL_CATALOG[0].id]);
    useDictationStore.getState().setEnabled(true);
    await session.start();
    expect(host.start).toHaveBeenCalledTimes(2);
    await session.stop();
  });
  it("refuses to load a model or open the microphone while Dictation is off", async () => {
    const host = {
      ...createUnsupportedHost("platform"),
      load: vi.fn(async () => {}),
      start: vi.fn(async () => {}),
    };
    createRecognizerHost.mockResolvedValue(host);
    const { session } = await getDictation();
    useDictationStore.setState({ installed: [MODEL_CATALOG[0].id], enabled: false });
    session.register({ id: "chapter", language: () => "en", showPartial() {}, commit() {} });
    session.focus("chapter");
    await session.start();
    await session.toggle();
    expect(host.load).not.toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
    expect(session.getSnapshot().status).toBe("idle");
  });
  it("builds the runtime once and shares it", async () => {
    createRecognizerHost.mockResolvedValue(createUnsupportedHost("platform"));
    const [a, b] = await Promise.all([getDictation(), getDictation()]);
    expect(a).toBe(b);
    expect(createRecognizerHost).toHaveBeenCalledTimes(1);
  });

  it("a failed build is not cached, so the next call retries", async () => {
    createRecognizerHost
      .mockRejectedValueOnce(new Error("worker failed to load"))
      .mockResolvedValue(createUnsupportedHost("platform"));
    await expect(getDictation()).rejects.toThrow("worker failed to load");
    await expect(getDictation()).resolves.toBeDefined();
    expect(createRecognizerHost).toHaveBeenCalledTimes(2);
  });

  it("notifies and rethrows when a model install fails", async () => {
    createRecognizerHost.mockResolvedValue(createUnsupportedHost("platform"));
    getModelFiles.mockResolvedValue({
      install: async () => {
        throw new DictationError("download_failed");
      },
      isComplete: async () => false,
      remove: async () => {},
    } satisfies ModelFiles);
    const runtime = await getDictation();
    const notify = vi.fn();
    runtime.setNotifier(notify);
    const spec = {
      id: "spec",
      engine: "moonshine",
      languages: ["en"],
      tier: "fast",
      platforms: ["web"],
      files: [],
      engineOptions: {},
      capabilities: { casing: true, punctuation: true, streaming: true },
    } satisfies ModelSpec;

    await expect(runtime.install(spec)).rejects.toThrow("download_failed");
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      code: "download_failed",
    });
  });
});
