import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUnsupportedHost, unsupportedModelFiles } from "@/lib/platform/unsupported-dictation";

const { createRecognizerHost } = vi.hoisted(() => ({ createRecognizerHost: vi.fn() }));
vi.mock("@/lib/platform", () => ({
  dictationPlatform: () => "web",
  createRecognizerHost,
  getModelFiles: async () => unsupportedModelFiles,
}));

const { getDictation, resetDictationForTests } = await import("@/features/dictation/runtime");

beforeEach(() => {
  resetDictationForTests();
  createRecognizerHost.mockReset();
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
});
