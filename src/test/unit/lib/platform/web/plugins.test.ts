import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";

const mockOpenWithData = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform/web/dialog", () => ({ webDialog: { openWithData: mockOpenWithData } }));

import { createWebPluginDirectory } from "@/lib/platform/web/plugins";

beforeEach(() => {
  mockOpenWithData.mockReset();
});

/** The slice of OPFS the adapter uses, faked in memory. */
interface FakeEntry {
  kind: "file" | "directory";
  bytes?: Uint8Array;
  children?: Map<string, FakeEntry>;
}

function notFound(): DOMException {
  return new DOMException("not found", "NotFoundError");
}

function handleOf(name: string, entry: FakeEntry): unknown {
  return {
    name,
    kind: entry.kind,
    getDirectoryHandle: async (child: string, options?: { create?: boolean }) => {
      const childEntry = entry.children?.get(child);
      if (childEntry && childEntry.kind === "directory") return handleOf(child, childEntry);
      if (options?.create) {
        const created: FakeEntry = { kind: "directory", children: new Map() };
        entry.children?.set(child, created);
        return handleOf(child, created);
      }
      throw notFound();
    },
    getFileHandle: async (child: string, options?: { create?: boolean }) => {
      const childEntry = entry.children?.get(child);
      if (childEntry && childEntry.kind === "file") return handleOf(child, childEntry);
      if (options?.create) {
        const created: FakeEntry = { kind: "file", bytes: new Uint8Array() };
        entry.children?.set(child, created);
        return handleOf(child, created);
      }
      throw notFound();
    },
    removeEntry: async (child: string) => {
      if (!entry.children?.delete(child)) throw notFound();
    },
    createWritable: async () => ({
      write: async (data: Uint8Array | ArrayBuffer) => {
        entry.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      },
      close: async () => undefined,
    }),
    values: function* () {
      for (const [child, childEntry] of entry.children ?? []) {
        yield handleOf(child, childEntry);
      }
    },
    getFile: async () => {
      const bytes = entry.bytes ?? new Uint8Array();
      return { arrayBuffer: async () => bytes.slice().buffer };
    },
  };
}

function directory(entry: Omit<FakeEntry, "kind">): FakeEntry {
  return { kind: "directory", children: new Map(), ...entry };
}

function file(contents: string): FakeEntry {
  return { kind: "file", bytes: new TextEncoder().encode(contents) };
}

function seededRoot(): FileSystemDirectoryHandle {
  const tracer = directory({
    children: new Map([
      ["manifest.json", file("{}")],
      ["index.js", file("export {}")],
      ["lib", directory({ children: new Map([["util.js", file("export {}")]]) })],
    ]),
  });
  const plugins = directory({
    children: new Map([
      ["tracer", tracer],
      ["loose-file", file("not a folder")],
    ]),
  });
  return handleOf(
    "",
    directory({ children: new Map([["plugins", plugins]]) })
  ) as FileSystemDirectoryHandle;
}

describe("createWebPluginDirectory()", () => {
  it("lists the Plugin folders in OPFS, not loose files", async () => {
    const adapter = createWebPluginDirectory(seededRoot());
    await expect(adapter.listFolders()).resolves.toEqual(["tracer"]);
  });

  it("reads a folder's files with POSIX-relative paths and their bytes", async () => {
    const adapter = createWebPluginDirectory(seededRoot());
    const folder = await adapter.readFolder("tracer");
    expect(folder?.name).toBe("tracer");
    expect(folder?.files.map((entry) => entry.path)).toEqual([
      "index.js",
      "lib/util.js",
      "manifest.json",
    ]);
    expect(new TextDecoder().decode(folder?.files[0].bytes)).toBe("export {}");
  });

  it("returns null for a folder that is not there", async () => {
    const adapter = createWebPluginDirectory(seededRoot());
    await expect(adapter.readFolder("absent")).resolves.toBeNull();
  });

  it("lists nothing when the Plugin Directory was never created", async () => {
    const adapter = createWebPluginDirectory(
      handleOf("", directory({})) as FileSystemDirectoryHandle
    );
    await expect(adapter.listFolders()).resolves.toEqual([]);
  });

  it("lists nothing when the browser has no OPFS", async () => {
    const adapter = createWebPluginDirectory();
    await expect(adapter.listFolders()).resolves.toEqual([]);
    await expect(adapter.readFolder("tracer")).resolves.toBeNull();
  });

  it("replaces a folder's files, dropping the ones the new copy does not carry", async () => {
    const adapter = createWebPluginDirectory(seededRoot());
    const encoder = new TextEncoder();

    const replaced = await adapter.replaceFolder?.("tracer", [
      { path: "manifest.json", bytes: encoder.encode("{}") },
      { path: "extra/new.js", bytes: encoder.encode("export {}") },
    ]);

    expect(replaced).toBe(true);
    const folder = await adapter.readFolder("tracer");
    expect(folder?.files.map((entry) => entry.path)).toEqual(["extra/new.js", "manifest.json"]);
    expect(new TextDecoder().decode(folder?.files[0].bytes)).toBe("export {}");
  });

  it("creates the folder when replacing one that is not there yet", async () => {
    const adapter = createWebPluginDirectory(seededRoot());

    const replaced = await adapter.replaceFolder?.("fresh", [
      { path: "manifest.json", bytes: new TextEncoder().encode("{}") },
    ]);

    expect(replaced).toBe(true);
    const folder = await adapter.readFolder("fresh");
    expect(folder?.files.map((entry) => entry.path)).toEqual(["manifest.json"]);
  });

  it("refuses to replace when the browser has no OPFS", async () => {
    const adapter = createWebPluginDirectory();
    await expect(adapter.replaceFolder?.("tracer", [])).resolves.toBe(false);
  });

  it("fires watch once a folder write completes, and stops after unsubscribe", async () => {
    const adapter = createWebPluginDirectory(seededRoot());
    const seen: string[] = [];
    const stop = adapter.watch?.((id) => seen.push(id));
    const files = [{ path: "manifest.json", bytes: new TextEncoder().encode("{}") }];

    await adapter.replaceFolder?.("tracer", files);

    expect(seen).toEqual(["tracer"]);

    stop?.();
    await adapter.replaceFolder?.("tracer", files);

    expect(seen).toEqual(["tracer"]);
  });
});

const encoder = new TextEncoder();

/** Builds a `.zip` from POSIX-relative paths, as the adapter's unzip reads it. */
function zip(files: Record<string, string>): Uint8Array {
  const data: Record<string, Uint8Array> = {};
  for (const [name, contents] of Object.entries(files)) data[name] = encoder.encode(contents);
  return zipSync(data);
}

const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** The byte offset of every central-directory file header in a `.zip`. */
function centralDirectoryOffsets(data: Uint8Array): number[] {
  const offsets: number[] = [];
  for (let index = 0; index + 4 <= data.length; index++) {
    if (
      data[index] === 0x50 &&
      data[index + 1] === 0x4b &&
      data[index + 2] === 0x01 &&
      data[index + 3] === 0x02
    ) {
      offsets.push(index);
    }
  }
  return offsets;
}

/** Forges one central-directory entry's declared uncompressed size. */
function setDeclaredUncompressedSize(data: Uint8Array, offset: number, size: number): void {
  new DataView(data.buffer, data.byteOffset + offset + 24, 4).setUint32(0, size, true);
}

describe("createWebPluginDirectory(): install and remove (#443)", () => {
  afterEach(() => {
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  it("reports the web platform with no folder picker without showDirectoryPicker", () => {
    const adapter = createWebPluginDirectory(seededRoot());
    expect(adapter.kind).toBe("web");
    expect(adapter.supportsFolderPicker).toBe(false);
    expect(adapter.addFromFolder).toBeUndefined();
  });

  it("installs a zip whose manifest is at the root, replacing the folder with that id", async () => {
    mockOpenWithData.mockResolvedValue({
      name: "tracer.zip",
      data: zip({ "manifest.json": '{"id":"tracer"}', "index.js": "export const a = 1;" }),
    });
    const adapter = createWebPluginDirectory(seededRoot());

    await expect(adapter.addFromZip?.()).resolves.toBe("tracer");

    const folder = await adapter.readFolder("tracer");
    expect(folder?.files.map((file) => file.path)).toEqual(["index.js", "manifest.json"]);
    expect(new TextDecoder().decode(folder?.files[1].bytes)).toBe('{"id":"tracer"}');
  });

  it("installs a zip wrapped in one top-level folder, stripping the folder name", async () => {
    mockOpenWithData.mockResolvedValue({
      name: "tracer.zip",
      data: zip({
        "tracer/manifest.json": '{"id":"tracer"}',
        "tracer/index.js": "export {}",
      }),
    });
    const adapter = createWebPluginDirectory(seededRoot());

    await expect(adapter.addFromZip?.()).resolves.toBe("tracer");

    const folder = await adapter.readFolder("tracer");
    expect(folder?.files.map((file) => file.path)).toEqual(["index.js", "manifest.json"]);
  });

  it("resolves null when the file picker is cancelled", async () => {
    mockOpenWithData.mockResolvedValue(null);
    const adapter = createWebPluginDirectory(seededRoot());

    await expect(adapter.addFromZip?.()).resolves.toBeNull();
  });

  it("refuses a zip entry that leaves the Plugin folder", async () => {
    mockOpenWithData.mockResolvedValue({
      name: "evil.zip",
      data: zip({ "manifest.json": '{"id":"tracer"}', "../evil.txt": "evil" }),
    });
    const adapter = createWebPluginDirectory(seededRoot());

    await expect(adapter.addFromZip?.()).rejects.toThrow();
    await expect(adapter.readFolder("tracer")).resolves.not.toBeNull();
  });

  it("refuses a zip over the entry cap", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 4097; index++) files[`f${index}.js`] = "x";
    mockOpenWithData.mockResolvedValue({ name: "many.zip", data: zip(files) });
    const adapter = createWebPluginDirectory(seededRoot());

    await expect(adapter.addFromZip?.()).rejects.toThrow(/too many/i);
  });

  it("refuses a zip whose declared uncompressed size exceeds the per-file cap", async () => {
    const data = zip({ "manifest.json": '{"id":"tracer"}', "big.bin": "x" });
    // Forge the first central-directory entry's uncompressed size past the
    // 64 MB per-file cap; the filter must reject before inflating it.
    const [first] = centralDirectoryOffsets(data);
    setDeclaredUncompressedSize(data, first, MAX_FILE_BYTES + 1);
    mockOpenWithData.mockResolvedValue({ name: "bomb.zip", data });
    const adapter = createWebPluginDirectory(seededRoot());

    await expect(adapter.addFromZip?.()).rejects.toThrow(/too large/i);
  });

  it("refuses a zip whose declared total exceeds the total cap", async () => {
    const files: Record<string, string> = { "manifest.json": '{"id":"tracer"}' };
    for (let index = 0; index < 5; index++) files[`f${index}.bin`] = "x";
    const data = zip(files);
    // Each entry is under the per-file cap; together they pass the total cap.
    for (const offset of centralDirectoryOffsets(data)) {
      setDeclaredUncompressedSize(data, offset, 60 * 1024 * 1024);
    }
    mockOpenWithData.mockResolvedValue({ name: "bomb.zip", data });
    const adapter = createWebPluginDirectory(seededRoot());

    await expect(adapter.addFromZip?.()).rejects.toThrow(/too large/i);
  });

  it("refuses a manifest without a usable id", async () => {
    mockOpenWithData.mockResolvedValue({
      name: "bad.zip",
      data: zip({ "manifest.json": '{"id":"Tracer"}' }),
    });
    const adapter = createWebPluginDirectory(seededRoot());

    await expect(adapter.addFromZip?.()).rejects.toThrow();
  });

  it("removes a Plugin folder and reports whether it was there", async () => {
    const adapter = createWebPluginDirectory(seededRoot());

    await expect(adapter.removeFolder?.("tracer")).resolves.toBe(true);
    await expect(adapter.readFolder("tracer")).resolves.toBeNull();
    await expect(adapter.removeFolder?.("tracer")).resolves.toBe(false);
    await expect(adapter.removeFolder?.("absent")).resolves.toBe(false);
  });

  it("skips OS litter and refuses manifests it cannot use", async () => {
    const littered = createWebPluginDirectory(seededRoot());
    mockOpenWithData.mockResolvedValue({
      name: "tracer.zip",
      data: zip({ "manifest.json": '{"id":"tracer"}', ".DS_Store": "junk" }),
    });
    await littered.addFromZip?.();
    expect((await littered.readFolder("tracer"))?.files.map((file) => file.path)).toEqual([
      "manifest.json",
    ]);

    for (const data of [
      zip({ "index.js": "x" }),
      zip({ "one/manifest.json": '{"id":"one"}', "two/manifest.json": '{"id":"two"}' }),
      zip({ "tracer/manifest.json": '{"id":"tracer"}', "README.md": "stray" }),
      zip({ "manifest.json": "not json" }),
    ]) {
      mockOpenWithData.mockResolvedValue({ name: "bad.zip", data });
      await expect(createWebPluginDirectory(seededRoot()).addFromZip?.()).rejects.toThrow();
    }
  });

  it("refuses two entries that differ only by case", async () => {
    mockOpenWithData.mockResolvedValue({
      name: "case.zip",
      data: zip({ "manifest.json": '{"id":"tracer"}', "Index.js": "a", "index.js": "b" }),
    });
    const adapter = createWebPluginDirectory(seededRoot());

    await expect(adapter.addFromZip?.()).rejects.toThrow(/same path/i);
  });

  it("throws when the browser has no Plugin storage", async () => {
    const adapter = createWebPluginDirectory();
    await expect(adapter.addFromZip?.()).rejects.toThrow();
  });

  it("installs a picked folder when the browser can pick one", async () => {
    const picked = handleOf(
      "",
      directory({
        children: new Map([
          ["manifest.json", file('{"id":"picked"}')],
          ["index.js", file("export {}")],
        ]),
      })
    ) as FileSystemDirectoryHandle;
    const showDirectoryPicker = vi.fn().mockResolvedValue(picked);
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker =
      showDirectoryPicker;
    const adapter = createWebPluginDirectory(seededRoot());

    expect(adapter.supportsFolderPicker).toBe(true);
    await expect(adapter.addFromFolder?.()).resolves.toBe("picked");

    const folder = await adapter.readFolder("picked");
    expect(folder?.files.map((entry) => entry.path)).toEqual(["index.js", "manifest.json"]);
    expect(showDirectoryPicker).toHaveBeenCalled();
  });

  it("resolves null when the folder picker is cancelled", async () => {
    const showDirectoryPicker = vi
      .fn()
      .mockRejectedValue(new DOMException("aborted", "AbortError"));
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker =
      showDirectoryPicker;
    const adapter = createWebPluginDirectory(seededRoot());

    await expect(adapter.addFromFolder?.()).resolves.toBeNull();
  });
});
