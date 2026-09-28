import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUNTIMES,
  crc32cBase64,
  fetchTestAssets,
  runtimesFor,
} from "../../../../scripts/fetch-dictation-runtime.mjs";
import { crc32cBase64 as appCrc32cBase64 } from "@/features/dictation/crc32c";

describe("fetch-dictation-runtime pins", () => {
  it("pins both Moonshine v0.1.5 tarballs by SHA-256", () => {
    expect(RUNTIMES).toEqual([
      {
        name: "wasm",
        url: "https://github.com/moonshine-ai/moonshine/releases/download/v0.1.5/moonshine-voice-wasm.tar.gz",
        sha256: "c515bf7691e12048f70a92cc82b3b0894c16c3773ffcacb7d48944fb150e4837",
        stripComponents: 0,
      },
      {
        name: "linux-x86_64",
        url: "https://github.com/moonshine-ai/moonshine/releases/download/v0.1.5/moonshine-voice-linux-x86_64.tar.gz",
        sha256: "9c3a87fea93ff2ad957938868f95a0a366dce9ff8ad86bde6cdcf5a4cadb51df",
        stripComponents: 1,
      },
    ]);
  });

  it("fetches only the WASM runtime for the web build", () => {
    expect(runtimesFor(["node", "script", "--web"]).map((r) => r.name)).toEqual(["wasm"]);
  });

  it("fetches every runtime without --web", () => {
    expect(runtimesFor(["node", "script"])).toEqual(RUNTIMES);
    expect(runtimesFor(["node", "script", "--test-assets"])).toEqual(RUNTIMES);
  });
});

// A fetch Response stand-in whose body streams the given chunks.
function streamedResponse(chunks: Uint8Array[]) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined },
      }),
    },
  };
}

describe("fetch-dictation-runtime crc32c", () => {
  it("matches the app implementation for a few byte arrays", () => {
    const samples = [
      new Uint8Array(0),
      new Uint8Array([0]),
      new Uint8Array([0, 1, 2, 3, 4]),
      new Uint8Array([0xff, 0x00, 0xaa, 0x55, 0x10, 0x20, 0x30]),
    ];
    for (const sample of samples) {
      expect(crc32cBase64(sample)).toBe(appCrc32cBase64(sample));
    }
  });

  it("computes the canonical Castagnoli check vector", () => {
    // "123456789" is the standard CRC32C check value 0xe3069283.
    expect(crc32cBase64(new TextEncoder().encode("123456789"))).toBe("4waSgw==");
    expect(crc32cBase64(new Uint8Array(0))).toBe("AAAAAA==");
  });
});

describe("fetchTestAssets()", () => {
  let root: string;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function makeRoot(files: unknown[]) {
    root = mkdtempSync(join(tmpdir(), "maibuk-fetch-"));
    const catalogDir = join(root, "src/features/dictation");
    mkdirSync(catalogDir, { recursive: true });
    writeFileSync(join(catalogDir, "catalog.json"), JSON.stringify([{ id: "test-model", files }]));
  }

  it("throws naming the file when a download's size does not match", async () => {
    makeRoot([
      {
        name: "adapter.ort",
        url: "https://example.test/adapter.ort",
        bytes: 3,
        checksum: { algo: "crc32c", value: "kwQ+Bw==" },
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamedResponse([new Uint8Array([1, 2])]))
    );

    await expect(fetchTestAssets(root)).rejects.toThrow(/adapter\.ort/);
  });

  it("throws naming the file when a download's CRC32C does not match", async () => {
    const content = new Uint8Array([1, 2, 3]);
    const wrongValue = crc32cBase64(new Uint8Array([9, 9, 9]));
    if (wrongValue === crc32cBase64(content)) throw new Error("bad fixture");
    makeRoot([
      {
        name: "encoder.ort",
        url: "https://example.test/encoder.ort",
        bytes: content.length,
        checksum: { algo: "crc32c", value: wrongValue },
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamedResponse([content]))
    );

    await expect(fetchTestAssets(root)).rejects.toThrow(/encoder\.ort/);
  });

  it("streams a matching file into vendor/moonshine/models/<id>/", async () => {
    const content = new Uint8Array([1, 2, 3, 4, 5]);
    makeRoot([
      {
        name: "tokenizer.bin",
        url: "https://example.test/tokenizer.bin",
        bytes: content.length,
        checksum: { algo: "crc32c", value: crc32cBase64(content) },
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamedResponse([content]))
    );

    await fetchTestAssets(root, { run: () => undefined });

    const written = readFileSync(join(root, "vendor/moonshine/models/test-model/tokenizer.bin"));
    expect(new Uint8Array(written)).toEqual(content);
  });
});
