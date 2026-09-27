import { describe, expect, it, vi } from "vitest";
import { createModelStore } from "@/features/dictation/model-store";
import { DictationError, type ModelFiles, type ModelSpec } from "@/features/dictation/types";

const spec = (id: string, platforms: ModelSpec["platforms"] = ["web"]): ModelSpec => ({
  id,
  engine: "moonshine",
  languages: ["en"],
  tier: "fast",
  platforms,
  files: [
    {
      name: "a",
      url: "https://x/a",
      bytes: 1,
      checksum: { algo: "crc32c", value: "AAAAAA==" },
    },
  ],
  engineOptions: {},
  capabilities: { casing: true, punctuation: true, streaming: true },
});

/** Files whose completion marker exists for the ids in `complete`. */
function fakeFiles(complete: string[] = []): ModelFiles & { installed: Set<string> } {
  const installed = new Set(complete);
  return {
    installed,
    install: vi.fn(async (s: ModelSpec) => void installed.add(s.id)),
    isComplete: vi.fn(async (s: ModelSpec) => installed.has(s.id)),
    remove: vi.fn(async (id: string) => void installed.delete(id)),
  };
}

const storeWith = (files: ModelFiles, isTutorialActive = () => false) =>
  createModelStore({
    files,
    catalog: [spec("a"), spec("b")],
    platform: "web",
    isTutorialActive,
  });

describe("createModelStore()", () => {
  it("lists only this platform's models", () => {
    const store = createModelStore({
      files: fakeFiles(),
      catalog: [spec("w"), spec("d", ["tauri-linux"])],
      platform: "web",
      isTutorialActive: () => false,
    });
    expect(store.available().map((s) => s.id)).toEqual(["w"]);
  });

  it("counts a model without its completion marker as not installed", async () => {
    const store = storeWith(fakeFiles(["a"]));
    expect([...(await store.installedIds())]).toEqual(["a"]);
  });

  it("installs a model", async () => {
    const files = fakeFiles();
    const store = storeWith(files);
    const onProgress = vi.fn();
    const signal = new AbortController().signal;
    await store.install(spec("a"), onProgress, signal);
    expect(files.install).toHaveBeenCalledWith(spec("a"), onProgress, signal);
    expect([...(await store.installedIds())]).toEqual(["a"]);
  });

  it("refuses to download while the Tutorial runs", async () => {
    const files = fakeFiles();
    const store = storeWith(files, () => true);
    await expect(store.install(spec("a"), () => {}, new AbortController().signal)).rejects.toEqual(
      new DictationError("tutorial_active")
    );
    expect(files.install).not.toHaveBeenCalled();
  });

  it("passes a failed install through as a DictationError and installs nothing", async () => {
    const files = fakeFiles();
    files.install = vi.fn(async () => {
      throw new TypeError("network");
    });
    const store = storeWith(files);
    await expect(
      store.install(spec("a"), () => {}, new AbortController().signal)
    ).rejects.toMatchObject({ code: "download_failed" });
    expect([...(await store.installedIds())]).toEqual([]);
  });

  it("keeps a failed checksum's code and installs nothing", async () => {
    const files = fakeFiles();
    files.install = vi.fn(async () => {
      throw new DictationError("model_corrupt", "a: checksum mismatch");
    });
    const store = storeWith(files);
    await expect(
      store.install(spec("a"), () => {}, new AbortController().signal)
    ).rejects.toMatchObject({ code: "model_corrupt" });
    expect([...(await store.installedIds())]).toEqual([]);
  });

  it("reports an aborted download as cancelled", async () => {
    const files = fakeFiles();
    const controller = new AbortController();
    files.install = vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const store = storeWith(files);
    await expect(store.install(spec("a"), () => {}, controller.signal)).rejects.toMatchObject({
      code: "cancelled",
    });
  });

  it("removes a model", async () => {
    const store = storeWith(fakeFiles(["a"]));
    await store.remove("a");
    expect([...(await store.installedIds())]).toEqual([]);
  });
});
