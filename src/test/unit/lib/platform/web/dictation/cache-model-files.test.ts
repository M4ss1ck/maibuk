// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cacheModelFiles, readModelFiles } from "@/lib/platform/web/dictation/cache-model-files";
import { crc32cBase64 } from "@/features/dictation/crc32c";
import type { ModelSpec } from "@/features/dictation/types";

const store = new Map<string, Map<string, Response>>();
const fakeCaches = {
  open: async (name: string) => {
    const bucket = store.get(name) ?? new Map<string, Response>();
    store.set(name, bucket);
    return {
      put: async (key: string, res: Response) => void bucket.set(key, res),
      match: async (key: string) => bucket.get(key)?.clone(),
      delete: async (key: string) => bucket.delete(key),
      keys: async () =>
        [...bucket.keys()].map((url) => new Request(new URL(url, "https://app.test"))),
    };
  },
};

const bytesA = new TextEncoder().encode("hello");
const bytesB = new TextEncoder().encode("world!!");
const spec: ModelSpec = {
  id: "m1",
  engine: "moonshine",
  languages: ["en"],
  tier: "fast",
  platforms: ["web"],
  files: [
    {
      name: "a.ort",
      url: "https://cdn.test/a.ort",
      bytes: 5,
      checksum: { algo: "crc32c", value: crc32cBase64(bytesA) },
    },
    {
      name: "b.bin",
      url: "https://cdn.test/b.bin",
      bytes: 7,
      checksum: { algo: "crc32c", value: crc32cBase64(bytesB) },
    },
  ],
  engineOptions: {},
  capabilities: { casing: true, punctuation: true, streaming: true },
};

function serve(map: Record<string, Uint8Array | number>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = map[url];
      if (typeof body === "number") return new Response(null, { status: body });
      return new Response(body);
    })
  );
}

beforeEach(() => {
  store.clear();
  vi.stubGlobal("caches", fakeCaches);
});

describe("cacheModelFiles", () => {
  it("installs, verifies, reports progress, and marks complete last", async () => {
    serve({
      "https://cdn.test/a.ort": bytesA,
      "https://cdn.test/b.bin": bytesB,
    });
    const progress: number[] = [];
    await cacheModelFiles.install(
      spec,
      (done) => progress.push(done),
      new AbortController().signal
    );
    expect(await cacheModelFiles.isComplete(spec)).toBe(true);
    expect(progress.at(-1)).toBe(12);
    const files = await readModelFiles(spec);
    expect(new TextDecoder().decode(files.get("b.bin"))).toBe("world!!");
  });

  it("rejects a checksum mismatch and leaves nothing installed", async () => {
    serve({
      "https://cdn.test/a.ort": new TextEncoder().encode("HELLO"),
      "https://cdn.test/b.bin": bytesB,
    });
    await expect(
      cacheModelFiles.install(spec, () => {}, new AbortController().signal)
    ).rejects.toMatchObject({ code: "download_failed" });
    expect(await cacheModelFiles.isComplete(spec)).toBe(false);
    expect([...(store.get("maibuk-dictation-v1")?.keys() ?? [])]).toEqual([]);
  });

  it("maps a 404 to model_gone", async () => {
    serve({ "https://cdn.test/a.ort": 404 });
    await expect(
      cacheModelFiles.install(spec, () => {}, new AbortController().signal)
    ).rejects.toMatchObject({ code: "model_gone" });
  });

  it("abort removes partial entries", async () => {
    serve({
      "https://cdn.test/a.ort": bytesA,
      "https://cdn.test/b.bin": bytesB,
    });
    const controller = new AbortController();
    const install = cacheModelFiles.install(
      spec,
      (done) => done >= 5 && controller.abort(),
      controller.signal
    );
    await expect(install).rejects.toBeTruthy();
    expect(await cacheModelFiles.isComplete(spec)).toBe(false);
    expect([...(store.get("maibuk-dictation-v1")?.keys() ?? [])]).toEqual([]);

    await cacheModelFiles.install(spec, () => {}, new AbortController().signal);
    expect(await cacheModelFiles.isComplete(spec)).toBe(true);
    expect((await readModelFiles(spec)).size).toBe(2);
  });

  it("missing marker is not installed, and reading it is model_corrupt", async () => {
    serve({
      "https://cdn.test/a.ort": bytesA,
      "https://cdn.test/b.bin": bytesB,
    });
    await cacheModelFiles.install(spec, () => {}, new AbortController().signal);
    await (await caches.open("maibuk-dictation-v1")).delete("/dictation/m1/.complete");
    expect(await cacheModelFiles.isComplete(spec)).toBe(false);
    await expect(readModelFiles(spec)).rejects.toMatchObject({
      code: "model_corrupt",
    });
  });

  it("a truncated stored file is model_corrupt on read", async () => {
    serve({
      "https://cdn.test/a.ort": bytesA,
      "https://cdn.test/b.bin": bytesB,
    });
    await cacheModelFiles.install(spec, () => {}, new AbortController().signal);
    await (await caches.open("maibuk-dictation-v1")).put(
      "/dictation/m1/b.bin",
      new Response("wor")
    );
    await expect(readModelFiles(spec)).rejects.toMatchObject({
      code: "model_corrupt",
    });
  });

  it("remove deletes every entry of the model", async () => {
    serve({
      "https://cdn.test/a.ort": bytesA,
      "https://cdn.test/b.bin": bytesB,
    });
    await cacheModelFiles.install(spec, () => {}, new AbortController().signal);
    await cacheModelFiles.remove("m1");
    expect(await cacheModelFiles.isComplete(spec)).toBe(false);
  });
});
