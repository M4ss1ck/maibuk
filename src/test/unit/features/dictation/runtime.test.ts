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

beforeEach(() => {
  resetDictationForTests();
  createRecognizerHost.mockReset();
  getModelFiles.mockReset();
  getModelFiles.mockResolvedValue(unsupportedModelFiles);
});

describe("getDictation()", () => {
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
