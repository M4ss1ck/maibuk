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
import type {
  PluginFileGrant,
  PluginFileGrantStore,
  PluginDroppedFile,
} from "@/features/plugins/file-grants";
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
  readonly kind = "file";
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

/** A dropped file whose browser handed back a handle promise, as a drop event does. */
function droppedHandle(file: File, handle: Promise<TestHandle | null> | null): PluginDroppedFile {
  return { file, handle: handle as unknown as Promise<FileSystemHandle | null> | null };
}

/** A `FileSystemDirectoryHandle` stand-in: a name and entries, walked in the order given. */
class TestDirectory {
  readonly kind = "directory";
  readonly name: string;
  private readonly entries: (TestHandle | TestDirectory)[];

  constructor(name: string, entries: (TestHandle | TestDirectory)[]) {
    this.name = name;
    this.entries = entries;
  }

  async *values(): AsyncGenerator<TestHandle | TestDirectory> {
    for (const entry of this.entries) yield entry;
  }
}

/** A file the input fallback hands over for a folder pick: its path under the picked folder. */
function fileInFolder(relativePath: string, bytes: string): File {
  const name = relativePath.split("/").pop() ?? relativePath;
  const file = pickedFile(name, bytes);
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
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

describe("createWebPluginFileGrantStore(): dropping", () => {
  it("persists a dropped file handle, and a new store over the same IndexedDB lists it", async () => {
    const indexedDB = new IDBFactory();
    const handle = new TestHandle({ name: "dropped.pdf", bytes: "hello" });
    const store = createWebPluginFileGrantStore({ indexedDB, randomId: sequentialIds() });

    await expect(
      store.drop("reader", [
        droppedHandle(pickedFile("dropped.pdf", "hello"), Promise.resolve(handle)),
      ])
    ).resolves.toEqual([{ grant: "grant-1", name: "dropped.pdf", size: 5 }]);

    const next = createWebPluginFileGrantStore({ indexedDB, randomId: sequentialIds() });
    await expect(next.list("reader")).resolves.toEqual([
      { grant: "grant-1", name: "dropped.pdf", size: 5 },
    ]);
    const range = await next.read("reader", "grant-1", 0, 5);
    expect(new TextDecoder().decode(range)).toBe("hello");
  });

  it("keeps a session grant from the File when the handle is null or refuses", async () => {
    const indexedDB = new IDBFactory();
    const store = createWebPluginFileGrantStore({ indexedDB, randomId: sequentialIds() });

    const dropped = await store.drop("reader", [
      droppedHandle(pickedFile("notes.epub", "bytes"), Promise.resolve(null)),
      droppedHandle(
        pickedFile("other.epub", "more"),
        Promise.reject(new Error("The browser gave no handle"))
      ),
    ]);

    expect(dropped).toEqual([
      { grant: "grant-1", name: "notes.epub", size: 5 },
      { grant: "grant-2", name: "other.epub", size: 4 },
    ]);
    const range = await store.read("reader", "grant-1", 0, 5);
    expect(new TextDecoder().decode(range)).toBe("bytes");

    const next = createWebPluginFileGrantStore({ indexedDB, randomId: sequentialIds() });
    await expect(next.list("reader")).resolves.toEqual([]);
  });

  it("returns the same grant when the same handle is dropped twice", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      randomId: sequentialIds(),
    });
    const handle = new TestHandle({ name: "dropped.pdf", bytes: "hello", entry: "entry-1" });

    const first = await store.drop("reader", [
      droppedHandle(pickedFile("dropped.pdf", "hello"), Promise.resolve(handle)),
    ]);
    const second = await store.drop("reader", [
      droppedHandle(pickedFile("dropped.pdf", "hello"), Promise.resolve(handle)),
    ]);

    expect(second).toEqual(first);
    await expect(store.list("reader")).resolves.toEqual([
      { grant: "grant-1", name: "dropped.pdf", size: 5 },
    ]);
  });
});

describe("createWebPluginFileGrantStore(): folder picks", () => {
  it("walks nested subfolders, matches extensions ignoring case, and grants one file per match", async () => {
    const root = new TestDirectory("Library", [
      new TestHandle({ name: "a.epub", bytes: "one" }),
      new TestDirectory("Fiction", [
        new TestHandle({ name: "B.EPUB", bytes: "two" }),
        new TestDirectory("Deep", [new TestHandle({ name: "c.epub", bytes: "three" })]),
      ]),
      new TestHandle({ name: "cover.jpg", bytes: "img" }),
      new TestHandle({ name: "notes.txt", bytes: "x" }),
    ]);
    const showDirectoryPicker = vi.fn(async () => root);
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showDirectoryPicker,
      randomId: sequentialIds(),
    });

    await expect(store.pickFolder("reader", ["epub"])).resolves.toEqual({
      folder: "Library",
      grants: [
        { grant: "grant-1", name: "a.epub", size: 3 },
        { grant: "grant-2", name: "B.EPUB", size: 3 },
        { grant: "grant-3", name: "c.epub", size: 5 },
      ],
    });
    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: "read" });
  });

  it("returns null and grants nothing when the author cancels the folder picker", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showDirectoryPicker: vi.fn(async () => {
        throw new DOMException("Aborted", "AbortError");
      }),
      randomId: sequentialIds(),
    });

    await expect(store.pickFolder("reader", ["epub"])).resolves.toBeNull();
    await expect(store.list("reader")).resolves.toEqual([]);
  });

  it("refuses with user-action-required when the browser blocks the folder picker", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showDirectoryPicker: vi.fn(async () => {
        throw new DOMException("No activation", "NotAllowedError");
      }),
      randomId: sequentialIds(),
    });

    await expect(store.pickFolder("reader", ["epub"])).rejects.toMatchObject({
      code: "user-action-required",
    });
  });

  it("reads, stats, and releases a folder grant like a picked file grant", async () => {
    const root = new TestDirectory("Library", [
      new TestHandle({ name: "a.epub", bytes: "hello", lastModified: 42 }),
    ]);
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showDirectoryPicker: vi.fn(async () => root),
      randomId: sequentialIds(),
    });
    const folder = await store.pickFolder("reader", ["epub"]);
    const [grant] = folder?.grants ?? [];
    if (!grant) throw new Error("The folder pick returned no File Grant");

    const bytes = await store.read("reader", grant.grant, 0, 5);
    expect(new TextDecoder().decode(bytes)).toBe("hello");
    await expect(store.stat("reader", grant.grant)).resolves.toEqual({
      name: "a.epub",
      size: 5,
      modified: 42,
    });

    await store.release("reader", grant.grant);
    await expect(store.read("reader", grant.grant, 0, 5)).rejects.toMatchObject({
      code: "file-missing",
    });
  });

  it("returns the grant already held when the folder holds a file the Plugin picked", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showOpenFilePicker: pickerFor([
        new TestHandle({ name: "a.epub", bytes: "hello", entry: "entry-1" }),
      ]),
      showDirectoryPicker: vi.fn(
        async () =>
          new TestDirectory("Library", [
            new TestHandle({ name: "a.epub", bytes: "hello", entry: "entry-1" }),
          ])
      ),
      randomId: sequentialIds(),
    });
    const picked = await pickGrant(store);

    await expect(store.pickFolder("reader", ["epub"])).resolves.toEqual({
      folder: "Library",
      grants: [picked],
    });
  });

  it("lists each grant once when a folder names the same file entry twice", async () => {
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      showDirectoryPicker: vi.fn(
        async () =>
          new TestDirectory("Library", [
            new TestHandle({ name: "a.epub", bytes: "hello", entry: "entry-1" }),
            new TestDirectory("Copy", [
              new TestHandle({ name: "a.epub", bytes: "hello", entry: "entry-1" }),
            ]),
          ])
      ),
      randomId: sequentialIds(),
    });

    await expect(store.pickFolder("reader", ["epub"])).resolves.toEqual({
      folder: "Library",
      grants: [{ grant: "grant-1", name: "a.epub", size: 5 }],
    });
  });

  it("filters the input fallback by extension and names the folder from its relative path", async () => {
    vi.stubGlobal("showDirectoryPicker", undefined);
    const pickFolderWithInput = vi.fn(async () => [
      fileInFolder("Library/a.epub", "one"),
      fileInFolder("Library/cover.jpg", "img"),
      fileInFolder("Library/Sub/B.EPUB", "two"),
    ]);
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      pickFolderWithInput,
      randomId: sequentialIds(),
    });

    await expect(store.pickFolder("reader", ["epub"])).resolves.toEqual({
      folder: "Library",
      grants: [
        { grant: "grant-1", name: "a.epub", size: 3 },
        { grant: "grant-2", name: "B.EPUB", size: 3 },
      ],
    });
    await expect(store.list("reader")).resolves.toEqual([
      { grant: "grant-1", name: "a.epub", size: 3 },
      { grant: "grant-2", name: "B.EPUB", size: 3 },
    ]);
  });

  it("returns null when the folder input fallback is cancelled", async () => {
    vi.stubGlobal("showDirectoryPicker", undefined);
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      pickFolderWithInput: async () => null,
      randomId: sequentialIds(),
    });

    await expect(store.pickFolder("reader", ["epub"])).resolves.toBeNull();
  });

  it("names the folder empty when the input fallback hands over no files", async () => {
    vi.stubGlobal("showDirectoryPicker", undefined);
    const store = createWebPluginFileGrantStore({
      indexedDB: new IDBFactory(),
      pickFolderWithInput: async () => [],
      randomId: sequentialIds(),
    });

    await expect(store.pickFolder("reader", ["epub"])).resolves.toEqual({
      folder: "",
      grants: [],
    });
  });
});
