import { describe, expect, it } from "vitest";
import { createWebPluginDirectory } from "@/lib/platform/web/plugins";

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
    getDirectoryHandle: async (child: string) => {
      const childEntry = entry.children?.get(child);
      if (!childEntry || childEntry.kind !== "directory") throw notFound();
      return handleOf(child, childEntry);
    },
    values: function* () {
      for (const [child, childEntry] of entry.children ?? []) {
        yield handleOf(child, childEntry);
      }
    },
    getFile: async () => {
      const bytes = entry.bytes ?? new Uint8Array();
      return { arrayBuffer: async () => bytes.buffer.slice(0) };
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
  return handleOf("", directory({ children: new Map([["plugins", plugins]]) })) as FileSystemDirectoryHandle;
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
    const adapter = createWebPluginDirectory(handleOf("", directory({})) as FileSystemDirectoryHandle);
    await expect(adapter.listFolders()).resolves.toEqual([]);
  });

  it("lists nothing when the browser has no OPFS", async () => {
    const adapter = createWebPluginDirectory();
    await expect(adapter.listFolders()).resolves.toEqual([]);
    await expect(adapter.readFolder("tracer")).resolves.toBeNull();
  });
});
