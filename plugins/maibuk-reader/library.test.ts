/**
 * The Shelf service (#653) through the Plugin test kit's File Grant fakes: a
 * pick is fingerprinted and added once, a Missing Document is marked from
 * `files.stat`, removal releases the grant and forgets the Reading Position, and
 * locating a file again only reattaches a matching Fingerprint.
 */

import { createPluginClient } from "@/plugin-sdk";
import { createTestHost } from "@/features/plugins/test-kit";
import { describe, expect, it } from "vitest";
import { createShelfService, type ReaderClient } from "./library";
import { SHELF_KEY, positionKey, fingerprint, type ShelfEntry } from "./shelf";
import { pdfBytes, readerManifest, shelfEntry } from "./test-support";

function setup() {
  const storage = new Map<string, unknown>();
  const host = createTestHost({ manifest: readerManifest(), storage });
  const client = createPluginClient(host.port);
  return {
    host,
    storage,
    client,
    library: createShelfService(client),
  };
}

/** An in-memory storage adapter over a Map, for a fake client. */
function fakeStorage(map: Map<string, unknown>) {
  return {
    get: async ({ key }: { key: string }) => map.get(key) ?? null,
    set: async ({ key, value }: { key: string; value: unknown }) => {
      map.set(key, value);
      return null;
    },
    delete: async ({ key }: { key: string }) => {
      map.delete(key);
      return null;
    },
    keys: async () => [...map.keys()],
  };
}

describe("openFileFlow()", () => {
  it("adds a picked PDF once, titled after its file name", async () => {
    const { host, storage, library } = setup();
    try {
      host.files.queuePick({ name: "Dune.pdf", bytes: pdfBytes("a PDF") });
      const entry = await library.openFileFlow();
      expect(entry).not.toBeNull();
      expect(entry).toMatchObject({
        title: "Dune",
        format: "pdf",
        state: "ok",
        author: "",
        progress: null,
      });
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf).toHaveLength(1);
      expect(shelf[0].grant).toBe(entry?.grant);
      expect(shelf[0].fingerprint).toMatch(/^\d+:[0-9a-f]{64}$/);
    } finally {
      host.stop();
    }
  });

  it("returns null when the author cancels the picker and writes nothing", async () => {
    const { host, storage, library } = setup();
    try {
      host.files.queuePick(null);
      await expect(library.openFileFlow()).resolves.toBeNull();
      expect(storage.has(SHELF_KEY)).toBe(false);
    } finally {
      host.stop();
    }
  });

  it("finds the same Document again instead of adding a duplicate", async () => {
    const { host, storage, library } = setup();
    try {
      const bytes = pdfBytes("same file");
      host.files.queuePick({ name: "Dune.pdf", bytes });
      const first = await library.openFileFlow();
      host.files.queuePick({ name: "Dune.pdf", bytes });
      const second = await library.openFileFlow();
      expect(second?.id).toBe(first?.id);
      expect(second?.fingerprint).toBe(first?.fingerprint);
      expect(storage.get(SHELF_KEY)).toHaveLength(1);
    } finally {
      host.stop();
    }
  });

  it("reads the first and last 64 KB in two calls", async () => {
    const map = new Map<string, unknown>();
    const reads: Array<{ offset: number; length: number }> = [];
    const client = {
      storage: fakeStorage(map),
      files: {
        pick: async () => ({ grant: "g1", name: "Big.epub", size: 200_000 }),
        read: async ({ offset, length }: { offset: number; length: number }) => {
          reads.push({ offset, length });
          return new ArrayBuffer(0);
        },
        stat: async () => ({ name: "Big.epub", size: 200_000, modified: 0 }),
        requestAccess: async () => true,
        release: async () => null,
        list: async () => [],
      },
    } as unknown as ReaderClient;
    const library = createShelfService(client);
    const entry = await library.openFileFlow();
    expect(entry?.format).toBe("epub");
    expect(reads).toEqual([
      { offset: 0, length: 65_536 },
      { offset: 134_464, length: 65_536 },
    ]);
  });

  it("adds a zero-byte file without asking the host for a zero-length read", async () => {
    const { host, storage, library } = setup();
    try {
      host.files.queuePick({ name: "Empty.pdf", bytes: new Uint8Array(0) });
      const entry = await library.openFileFlow();
      expect(entry).toMatchObject({ title: "Empty", format: "pdf", state: "ok" });
      expect(storage.get(SHELF_KEY)).toHaveLength(1);
    } finally {
      host.stop();
    }
  });

  it("issues no reads for a zero-byte file and fingerprints empty head and tail", async () => {
    const map = new Map<string, unknown>();
    const reads: Array<{ offset: number; length: number }> = [];
    const client = {
      storage: fakeStorage(map),
      files: {
        pick: async () => ({ grant: "g1", name: "Empty.pdf", size: 0 }),
        read: async ({ offset, length }: { offset: number; length: number }) => {
          reads.push({ offset, length });
          return new ArrayBuffer(0);
        },
        stat: async () => ({ name: "Empty.pdf", size: 0, modified: 0 }),
        requestAccess: async () => true,
        release: async () => null,
        list: async () => [],
      },
    } as unknown as ReaderClient;

    const entry = await createShelfService(client).openFileFlow();

    expect(reads).toEqual([]);
    expect(entry?.fingerprint).toBe(await fingerprint(0, new Uint8Array(0), new Uint8Array(0)));
  });

  it("releases the picked grant when the format is unknown", async () => {
    const released: string[] = [];
    const map = new Map<string, unknown>();
    const client = {
      storage: fakeStorage(map),
      files: {
        pick: async () => ({ grant: "g1", name: "notes.txt", size: 0 }),
        read: async () => new ArrayBuffer(0),
        stat: async () => ({ name: "notes.txt", size: 0, modified: 0 }),
        requestAccess: async () => true,
        release: async ({ grant }: { grant: string }) => {
          released.push(grant);
          return null;
        },
        list: async () => [],
      },
    } as unknown as ReaderClient;
    const library = createShelfService(client);
    await expect(library.openFileFlow()).rejects.toThrow();
    expect(released).toEqual(["g1"]);
  });

  it("releases the old grant when upsert matches an existing entry with a differing grant", async () => {
    const released: string[] = [];
    const size = 0;
    const empty = new Uint8Array(0);
    const print = await fingerprint(size, empty, empty);
    const map = new Map<string, unknown>();
    map.set(SHELF_KEY, [shelfEntry({ id: "doc-1", grant: "old-grant", fingerprint: print })]);
    const client = {
      storage: fakeStorage(map),
      files: {
        pick: async () => ({ grant: "new-grant", name: "Dune.pdf", size }),
        read: async () => new ArrayBuffer(0),
        stat: async () => ({ name: "Dune.pdf", size, modified: 0 }),
        requestAccess: async () => true,
        release: async ({ grant }: { grant: string }) => {
          released.push(grant);
          return null;
        },
        list: async () => [],
      },
    } as unknown as ReaderClient;
    const library = createShelfService(client);
    const entry = await library.openFileFlow();
    expect(entry?.grant).toBe("new-grant");
    expect(released).toEqual(["old-grant"]);
  });
});

describe("refreshStates()", () => {
  it("marks a Document whose file is gone as missing", async () => {
    const { host, storage, library } = setup();
    try {
      host.files.queuePick({ name: "Dune.pdf", bytes: pdfBytes() });
      const entry = await library.openFileFlow();
      host.files.setMissing(entry?.grant as string);
      const shelf = await library.refreshStates();
      expect(shelf[0]).toMatchObject({ id: entry?.id, state: "missing" });
      expect((storage.get(SHELF_KEY) as ShelfEntry[])[0].state).toBe("missing");
    } finally {
      host.stop();
    }
  });

  it("marks a Document the browser must ask about again as needs-permission", async () => {
    const map = new Map<string, unknown>();
    map.set(SHELF_KEY, [shelfEntry({ id: "doc-1", grant: "g1" })]);
    const client = {
      storage: fakeStorage(map),
      files: {
        pick: async () => null,
        read: async () => new ArrayBuffer(0),
        stat: async () => {
          throw Object.assign(new Error("ask again"), { code: "file-needs-permission" });
        },
        requestAccess: async () => true,
        release: async () => null,
        list: async () => [],
      },
    } as unknown as ReaderClient;
    const shelf = await createShelfService(client).refreshStates();
    expect(shelf[0].state).toBe("needs-permission");
  });

  it("marks an unexpected read failure as unreadable", async () => {
    const map = new Map<string, unknown>();
    map.set(SHELF_KEY, [shelfEntry({ id: "doc-1", grant: "g1" })]);
    const client = {
      storage: fakeStorage(map),
      files: {
        pick: async () => null,
        read: async () => new ArrayBuffer(0),
        stat: async () => {
          throw new Error("corrupt");
        },
        requestAccess: async () => true,
        release: async () => null,
        list: async () => [],
      },
    } as unknown as ReaderClient;
    const shelf = await createShelfService(client).refreshStates();
    expect(shelf[0]).toMatchObject({ state: "unreadable", reason: "corrupt" });
  });
});

describe("removeFromShelf()", () => {
  it("releases the File Grant, deletes the Reading Position, and forgets the Document", async () => {
    const { host, storage, library } = setup();
    try {
      host.files.queuePick({ name: "Dune.pdf", bytes: pdfBytes() });
      const entry = await library.openFileFlow();
      storage.set(positionKey(entry?.id as string), { page: 12 });

      const shelf = await library.removeFromShelf(entry?.id as string);
      expect(shelf).toEqual([]);
      expect(storage.get(SHELF_KEY)).toEqual([]);
      expect(storage.has(positionKey(entry?.id as string))).toBe(false);
      await expect(host.files.grants()).resolves.toEqual([]);
    } finally {
      host.stop();
    }
  });
});

describe("locateAgain()", () => {
  it("reattaches a matching file and keeps the Reading Position", async () => {
    const { host, storage, library } = setup();
    try {
      const bytes = pdfBytes("the same file");
      host.files.queuePick({ name: "Dune.pdf", bytes });
      const entry = await library.openFileFlow();
      storage.set(positionKey(entry?.id as string), { page: 42, pageCount: 210 });
      host.files.setMissing(entry?.grant as string);
      await library.refreshStates();

      host.files.queuePick({ name: "Dune.pdf", bytes });
      const result = await library.locateAgain(entry?.id as string);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.entry).toMatchObject({ id: entry?.id, state: "ok" });
      expect(storage.get(positionKey(entry?.id as string))).toEqual({ page: 42, pageCount: 210 });
      expect((storage.get(SHELF_KEY) as ShelfEntry[])[0].state).toBe("ok");
    } finally {
      host.stop();
    }
  });

  it("refuses a different file and leaves the Missing Document alone", async () => {
    const { host, storage, library } = setup();
    try {
      host.files.queuePick({ name: "Dune.pdf", bytes: pdfBytes("the first file") });
      const entry = await library.openFileFlow();
      host.files.setMissing(entry?.grant as string);
      await library.refreshStates();

      host.files.queuePick({ name: "Dune.pdf", bytes: pdfBytes("a different file") });
      await expect(library.locateAgain(entry?.id as string)).resolves.toEqual({
        ok: false,
        reason: "fingerprint-mismatch",
      });
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf[0].state).toBe("missing");
      expect(shelf).toHaveLength(1);
    } finally {
      host.stop();
    }
  });

  it("reports a cancelled pick", async () => {
    const { host } = setup();
    try {
      const client = createPluginClient(host.port);
      const library = createShelfService(client);
      host.files.queuePick({ name: "Dune.pdf", bytes: pdfBytes() });
      const entry = await library.openFileFlow();
      host.files.queuePick(null);
      await expect(library.locateAgain(entry?.id as string)).resolves.toEqual({
        ok: false,
        reason: "cancelled",
      });
    } finally {
      host.stop();
    }
  });

  it("releases the picked grant when reattach fails, unless it is the missing entry's own", async () => {
    const released: string[] = [];
    const map = new Map<string, unknown>();
    map.set(SHELF_KEY, [
      shelfEntry({ id: "doc-1", grant: "old-grant", fingerprint: "doc-1:fingerprint" }),
    ]);
    const client = {
      storage: fakeStorage(map),
      files: {
        pick: async () => ({ grant: "new-grant", name: "Dune.pdf", size: 0 }),
        read: async () => new ArrayBuffer(0),
        stat: async () => ({ name: "Dune.pdf", size: 0, modified: 0 }),
        requestAccess: async () => true,
        release: async ({ grant }: { grant: string }) => {
          released.push(grant);
          return null;
        },
        list: async () => [],
      },
    } as unknown as ReaderClient;
    const library = createShelfService(client);
    const result = await library.locateAgain("doc-1");
    expect(result).toEqual({ ok: false, reason: "fingerprint-mismatch" });
    expect(released).toEqual(["new-grant"]);
  });

  it("keeps the picked grant when another Document on the Shelf holds it", async () => {
    const released: string[] = [];
    const map = new Map<string, unknown>();
    map.set(SHELF_KEY, [
      shelfEntry({ id: "doc-1", grant: "old-grant", fingerprint: "doc-1:fingerprint" }),
      shelfEntry({ id: "doc-2", grant: "other-grant", fingerprint: "doc-2:fingerprint" }),
    ]);
    const client = {
      storage: fakeStorage(map),
      files: {
        pick: async () => ({ grant: "other-grant", name: "Other.pdf", size: 0 }),
        read: async () => new ArrayBuffer(0),
        stat: async () => ({ name: "Other.pdf", size: 0, modified: 0 }),
        requestAccess: async () => true,
        release: async ({ grant }: { grant: string }) => {
          released.push(grant);
          return null;
        },
        list: async () => [],
      },
    } as unknown as ReaderClient;
    const library = createShelfService(client);
    const result = await library.locateAgain("doc-1");
    expect(result).toEqual({ ok: false, reason: "fingerprint-mismatch" });
    expect(released).toEqual([]);
  });

  it("releases the old grant when reattach succeeds with a differing grant", async () => {
    const released: string[] = [];
    const size = 0;
    const empty = new Uint8Array(0);
    const print = await fingerprint(size, empty, empty);
    const map = new Map<string, unknown>();
    map.set(SHELF_KEY, [shelfEntry({ id: "doc-1", grant: "old-grant", fingerprint: print })]);
    const client = {
      storage: fakeStorage(map),
      files: {
        pick: async () => ({ grant: "new-grant", name: "Dune.pdf", size }),
        read: async () => new ArrayBuffer(0),
        stat: async () => ({ name: "Dune.pdf", size, modified: 0 }),
        requestAccess: async () => true,
        release: async ({ grant }: { grant: string }) => {
          released.push(grant);
          return null;
        },
        list: async () => [],
      },
    } as unknown as ReaderClient;
    const library = createShelfService(client);
    const result = await library.locateAgain("doc-1");
    expect(result.ok).toBe(true);
    expect(released).toEqual(["old-grant"]);
  });
});

describe("reopen()", () => {
  it("marks the Document ok only when the browser grants access", async () => {
    const map = new Map<string, unknown>();
    map.set(SHELF_KEY, [shelfEntry({ id: "doc-1", grant: "g1", state: "needs-permission" })]);
    let allowed = false;
    const client = {
      storage: fakeStorage(map),
      files: {
        pick: async () => null,
        read: async () => new ArrayBuffer(0),
        stat: async () => ({ name: "Dune.pdf", size: 1, modified: 0 }),
        requestAccess: async () => allowed,
        release: async () => null,
        list: async () => [],
      },
    } as unknown as ReaderClient;
    const library = createShelfService(client);

    await expect(library.reopen("doc-1")).resolves.toBe(false);
    expect((map.get(SHELF_KEY) as ShelfEntry[])[0].state).toBe("needs-permission");

    allowed = true;
    await expect(library.reopen("doc-1")).resolves.toBe(true);
    expect((map.get(SHELF_KEY) as ShelfEntry[])[0].state).toBe("ok");
  });
});

describe("the current Document", () => {
  it("reopens the Document the Reading page had open, after a relaunch", async () => {
    const { storage, library } = setup();
    storage.set(SHELF_KEY, [
      shelfEntry({ id: "doc-1", grant: "grant-1", lastReadAt: 2 }),
      shelfEntry({ id: "doc-2", grant: "grant-2", lastReadAt: 1, title: "Emma" }),
    ]);
    expect(await library.loadCurrent()).toBeNull();
    await library.rememberCurrent("doc-2");
    expect((await library.loadCurrent())?.title).toBe("Emma");
  });

  it("forgets a Document that left the Shelf", async () => {
    const { storage, library } = setup();
    storage.set(SHELF_KEY, [shelfEntry({ id: "doc-1", grant: "grant-1" })]);
    await library.rememberCurrent("doc-1");
    await library.removeFromShelf("doc-1");
    expect(await library.loadCurrent()).toBeNull();
  });
});
