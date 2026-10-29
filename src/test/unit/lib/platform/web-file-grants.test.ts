/**
 * The web File Grant store (ADR 0036): a picked handle persists in IndexedDB
 * under the Plugin's id and survives a new store instance, the browser's
 * permission answer gates `read`, and a browser without the File System Access
 * API keeps grants for the session only. IndexedDB that fails never breaks a
 * pick: the grant falls back to the session.
 */
import "fake-indexeddb/auto";
import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginFileGrant, PluginFileGrantStore } from "@/features/plugins/file-grants";
import { createWebPluginFileGrantStore } from "@/lib/platform/web/file-grants";
import { PluginApiError } from "@/plugin-sdk/protocol";

type TestPermission = "denied" | "granted" | "prompt";

interface TestHandleOptions {
  name: string;
  bytes: string;
  /** The file entry two handles share when they name the same file. */
  entry?: string;
  permission?: TestPermission;
  missing?: boolean;
  lastModified?: number;
}

/** A `FileSystemFileHandle` stand-in: named bytes, a shared entry, and a permission answer. */
class TestHandle {
  readonly name: string;
  readonly entry: string;
  readonly lastModified: number;
  permission: TestPermission;
  private readonly bytes: string;
  private readonly missing: boolean;

  constructor(options: TestHandleOptions) {
    this.name = options.name;
    this.bytes = options.bytes;
    this.entry = options.entry ?? options.name;
    this.permission = options.permission ?? "granted";
    this.missing = options.missing ?? false;
    this.lastModified = options.lastModified ?? 1_700_000_000_000;
  }

  async getFile(): Promise<File> {
    if (this.missing) throw new DOMException("The file is gone", "NotFoundError");
    return new File([this.bytes], this.name, { lastModified: this.lastModified });
  }

  async isSameEntry(other: TestHandle): Promise<boolean> {
    return other.entry === this.entry;
  }

  async queryPermission(): Promise<TestPermission> {
    return this.permission;
  }

  async requestPermission(): Promise<TestPermission> {
    this.permission = "granted";
    return this.permission;
  }
}

/** A picker queued with the handles its next calls answer, one call per pick. */
function pickerFor(...picks: (TestHandle[] | Error | DOMException)[]) {
  return vi.fn(async () => {
    const next = picks.shift();
    if (next === undefined) return [];
    if (next instanceof Error || next instanceof DOMException) throw next;
    return next;
  });
}

/** Grant ids a test can name: grant-1, grant-2, ... */
function sequentialIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `grant-${next}`;
  };
}

/** The same `File` the fallback input would hand over. */
function pickedFile(name: string, bytes: string, lastModified = 1_700_000_000_000): File {
  return new File([bytes], name, { lastModified });
}

/** The grant a pick must return; a cancelled pick fails here, not a later line. */
async function pickGrant(
  store: PluginFileGrantStore,
  pluginId = "reader"
): Promise<PluginFileGrant> {
  const picked = await store.pick(pluginId, ["pdf"]);
  expect(picked).not.toBeNull();
  if (!picked) throw new Error("The pick returned no File Grant");
  return picked;
}

beforeEach(() => {
  // A browser's structured clone keeps a FileSystemFileHandle alive; fake-indexeddb
  // clones into plain data, which would strip the stand-in handle's methods.
  vi.stubGlobal("structuredClone", (value: unknown) => value);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createWebPluginFileGrantStore()", () => {
  it("persists a picked handle, filtered to the Plugin's extensions", async () => {
    const indexedDB = new IDBFactory();
    const handle = new TestHandle({ name: "book.pdf", bytes: "hello" });
    const picker = pickerFor([handle]);
    const store = createWebPluginFileGrantStore({
      indexedDB,
      showOpenFilePicker: picker,
      randomId: sequentialIds(),
    });

    await expect(store.pick("reader", ["pdf", "epub"])).resolves.toEqual({
      grant: "grant-1",
      name: "book.pdf",
      size: 5,
    });
    expect(picker).toHaveBeenCalledWith({
      multiple: false,
      excludeAcceptAllOption: false,
      types: [
        {
          description: "Documents",
          accept: { "application/octet-stream": [".pdf", ".epub"] },
        },
      ],
    });

    const next = createWebPluginFileGrantStore({ indexedDB, randomId: sequentialIds() });

    await expect(next.list("reader")).resolves.toEqual([
      { grant: "grant-1", name: "book.pdf", size: 5 },
    ]);
  });

  it("returns null when the author cancels the picker", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showOpenFilePicker: pickerFor(new DOMException("Aborted", "AbortError")),
      randomId: sequentialIds(),
    });

    await expect(store.pick("reader", ["pdf"])).resolves.toBeNull();
  });

  it("refuses with user-action-required when the browser blocks the picker", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showOpenFilePicker: pickerFor(new DOMException("No activation", "NotAllowedError")),
      randomId: sequentialIds(),
    });

    await expect(store.pick("reader", ["pdf"])).rejects.toMatchObject({
      code: "user-action-required",
    });
  });

  it("keeps one grant when the same file is picked again", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showOpenFilePicker: pickerFor(
        [new TestHandle({ name: "book.pdf", bytes: "hello", entry: "entry-1" })],
        [new TestHandle({ name: "book.pdf", bytes: "hello", entry: "entry-1" })]
      ),
      randomId: sequentialIds(),
    });

    const first = await store.pick("reader", ["pdf"]);
    const second = await store.pick("reader", ["pdf"]);

    expect(second).toEqual(first);
    await expect(store.list("reader")).resolves.toEqual([
      { grant: "grant-1", name: "book.pdf", size: 5 },
    ]);
  });

  it("reads a byte range, and past the end returns the bytes that exist", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showOpenFilePicker: pickerFor([
        new TestHandle({ name: "book.txt", bytes: "hello world", lastModified: 42 }),
      ]),
      randomId: sequentialIds(),
    });
    const picked = await pickGrant(store);

    const range = await store.read("reader", picked.grant, 6, 5);
    expect(new TextDecoder().decode(range)).toBe("world");
    const tail = await store.read("reader", picked.grant, 9, 10);
    expect(new TextDecoder().decode(tail)).toBe("ld");
    const pastEnd = await store.read("reader", picked.grant, 20, 4);
    expect(pastEnd.byteLength).toBe(0);

    await expect(store.stat("reader", picked.grant)).resolves.toEqual({
      name: "book.txt",
      size: 11,
      modified: 42,
    });
  });

  it("refuses a grant while the browser still has to ask, until access is granted", async () => {
    const handle = new TestHandle({ name: "book.pdf", bytes: "hello", permission: "prompt" });
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showOpenFilePicker: pickerFor([handle]),
      randomId: sequentialIds(),
    });
    const picked = await pickGrant(store);

    const refused = await store.read("reader", picked.grant, 0, 5).catch((error) => error);
    expect(refused).toBeInstanceOf(PluginApiError);
    expect(refused.code).toBe("file-needs-permission");

    await expect(store.requestAccess("reader", picked.grant)).resolves.toBe(true);
    await expect(store.read("reader", picked.grant, 0, 5)).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("reports a handle whose file disappeared as missing", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showOpenFilePicker: pickerFor([
        new TestHandle({ name: "moved.pdf", bytes: "x", missing: true }),
      ]),
      randomId: sequentialIds(),
    });
    const picked = await pickGrant(store);

    await expect(store.read("reader", picked.grant, 0, 1)).rejects.toMatchObject({
      code: "file-missing",
    });
    await expect(store.stat("reader", picked.grant)).rejects.toMatchObject({
      code: "file-missing",
    });
  });

  it("refuses a grant that belongs to another Plugin", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showOpenFilePicker: pickerFor([new TestHandle({ name: "book.pdf", bytes: "hello" })]),
      randomId: sequentialIds(),
    });
    const picked = await pickGrant(store);

    await expect(store.read("other", picked.grant, 0, 5)).rejects.toMatchObject({
      code: "file-missing",
    });
    await expect(store.requestAccess("other", picked.grant)).rejects.toMatchObject({
      code: "file-missing",
    });
  });

  it("keeps a fallback pick for the session only", async () => {
    vi.stubGlobal("showOpenFilePicker", undefined);
    const indexedDB = new IDBFactory();
    const pickWithInput = vi.fn(async () => pickedFile("notes.epub", "bytes"));
    const store = createWebPluginFileGrantStore({
      indexedDB,
      pickWithInput,
      randomId: sequentialIds(),
    });

    await expect(store.pick("reader", ["pdf", "epub"])).resolves.toEqual({
      grant: "grant-1",
      name: "notes.epub",
      size: 5,
    });
    await expect(store.list("reader")).resolves.toEqual([
      { grant: "grant-1", name: "notes.epub", size: 5 },
    ]);
    expect(pickWithInput).toHaveBeenCalledWith(["pdf", "epub"]);

    const next = createWebPluginFileGrantStore({ indexedDB, randomId: sequentialIds() });
    await expect(next.list("reader")).resolves.toEqual([]);
  });

  it("returns null when the fallback input is cancelled", async () => {
    vi.stubGlobal("showOpenFilePicker", undefined);
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      pickWithInput: async () => null,
      randomId: sequentialIds(),
    });

    await expect(store.pick("reader", ["pdf"])).resolves.toBeNull();
  });

  it("still picks when IndexedDB cannot open, keeping the grant for the session", async () => {
    const broken = {
      open: () => {
        throw new Error("IndexedDB is blocked");
      },
    } as unknown as IDBFactory;
    const store = createWebPluginFileGrantStore({
      indexedDB: broken,
      showOpenFilePicker: pickerFor([new TestHandle({ name: "book.pdf", bytes: "hello" })]),
      randomId: sequentialIds(),
    });

    const picked = await store.pick("reader", ["pdf"]);

    expect(picked).toEqual({ grant: "grant-1", name: "book.pdf", size: 5 });
    await expect(store.list("reader")).resolves.toEqual([
      { grant: "grant-1", name: "book.pdf", size: 5 },
    ]);
    const range = await store.read("reader", "grant-1", 0, 5);
    expect(new TextDecoder().decode(range)).toBe("hello");
    await expect(store.read("reader", "unknown", 0, 1)).rejects.toMatchObject({
      code: "file-missing",
    });
  });

  it("ends only the named Plugin's grants", async () => {
    const indexedDB = new IDBFactory();
    const store = createWebPluginFileGrantStore({
      indexedDB,
      showOpenFilePicker: pickerFor(
        [new TestHandle({ name: "reader.pdf", bytes: "one" })],
        [new TestHandle({ name: "dictionary.pdf", bytes: "two" })]
      ),
      randomId: sequentialIds(),
    });
    await store.pick("reader", ["pdf"]);
    await store.pick("dictionary", ["pdf"]);

    await store.clearPlugin("reader");

    await expect(store.list("reader")).resolves.toEqual([]);
    await expect(store.list("dictionary")).resolves.toEqual([
      { grant: "grant-2", name: "dictionary.pdf", size: 3 },
    ]);

    const next = createWebPluginFileGrantStore({ indexedDB, randomId: sequentialIds() });
    await expect(next.list("reader")).resolves.toEqual([]);
    await expect(next.list("dictionary")).resolves.toEqual([
      { grant: "grant-2", name: "dictionary.pdf", size: 3 },
    ]);
  });

  it("ends every grant on the device", async () => {
    const indexedDB = new IDBFactory();
    const store = createWebPluginFileGrantStore({
      indexedDB,
      showOpenFilePicker: pickerFor(
        [new TestHandle({ name: "reader.pdf", bytes: "one" })],
        [new TestHandle({ name: "dictionary.pdf", bytes: "two" })]
      ),
      randomId: sequentialIds(),
    });
    await store.pick("reader", ["pdf"]);
    await store.pick("dictionary", ["pdf"]);

    await store.clearAll();
    await expect(store.list("reader")).resolves.toEqual([]);

    const next = createWebPluginFileGrantStore({ indexedDB, randomId: sequentialIds() });
    await expect(next.list("reader")).resolves.toEqual([]);
    await expect(next.list("dictionary")).resolves.toEqual([]);
  });

  it("reports an unknown File Grant as missing on release", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      randomId: sequentialIds(),
    });

    await expect(store.release("reader", "unknown")).rejects.toMatchObject({
      code: "file-missing",
    });
  });

  it("refuses to release another Plugin's grant and keeps it for its owner", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showOpenFilePicker: pickerFor([new TestHandle({ name: "reader.pdf", bytes: "one" })]),
      randomId: sequentialIds(),
    });
    const picked = await pickGrant(store, "reader");

    await expect(store.release("dictionary", picked.grant)).rejects.toMatchObject({
      code: "file-missing",
    });
    await expect(store.list("reader")).resolves.toEqual([picked]);
  });

  it("drops the session copy and reports internal-error when IndexedDB cannot remove a session grant", async () => {
    const broken = {
      open: () => {
        throw new Error("IndexedDB is blocked");
      },
    } as unknown as IDBFactory;
    const store = createWebPluginFileGrantStore({
      indexedDB: broken,
      showOpenFilePicker: pickerFor([new TestHandle({ name: "book.pdf", bytes: "hello" })]),
      randomId: sequentialIds(),
    });
    const picked = await pickGrant(store);

    await expect(store.release("reader", picked.grant)).rejects.toMatchObject({
      code: "internal-error",
    });
    await expect(store.read("reader", picked.grant, 0, 5)).rejects.toMatchObject({
      code: "file-missing",
    });
  });

  it("reports internal-error when IndexedDB refuses to remove a persisted grant", async () => {
    const indexedDB = new IDBFactory();
    const store = createWebPluginFileGrantStore({
      indexedDB,
      showOpenFilePicker: pickerFor([new TestHandle({ name: "book.pdf", bytes: "hello" })]),
      randomId: sequentialIds(),
    });
    const picked = await pickGrant(store);
    // Reads still work; only the removal's readwrite transaction fails.
    const realTransaction = IDBDatabase.prototype.transaction;
    const refuse = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase,
      names,
      mode,
      options
    ) {
      if (mode === "readwrite") {
        throw new DOMException("The quota has been exceeded", "QuotaExceededError");
      }
      return realTransaction.call(this, names, mode, options);
    });

    try {
      await expect(store.release("reader", picked.grant)).rejects.toMatchObject({
        code: "internal-error",
      });
    } finally {
      refuse.mockRestore();
    }
    await expect(store.list("reader")).resolves.toEqual([picked]);
  });
});
