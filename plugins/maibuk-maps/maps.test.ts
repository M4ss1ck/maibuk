/**
 * The Maps data model (#744): one storage key per Map plus the `index` the list
 * page reads. Every test goes through `createMapStore` over an in-memory
 * storage that records which keys were read, so "the list never loads a whole
 * Map" is a fact the test can see.
 */

import { describe, expect, it } from "vitest";
import {
  DATA_VERSION,
  INDEX_KEY,
  createMapStore,
  mapKey,
  mapPreview,
  migrateMapsData,
  type MapDocument,
  type MapLineElement,
  type MapStorage,
} from "./maps";
import { sceneToSvg } from "./scene";

/** An in-memory storage that remembers every key read. */
function memoryStorage(seed: Iterable<[string, unknown]> = []) {
  const values = new Map<string, unknown>(seed);
  const reads: string[] = [];
  const storage: MapStorage = {
    async get({ key }) {
      reads.push(key);
      return values.has(key) ? structuredClone(values.get(key)) : null;
    },
    async set({ key, value }) {
      values.set(key, structuredClone(value));
      return null;
    },
    async delete({ key }) {
      values.delete(key);
      return null;
    },
  };
  return { storage, values, reads };
}

/** A store with a clock and ids the test controls. */
function storeOver(storage: MapStorage) {
  let clock = 1_000;
  let next = 0;
  return createMapStore(storage, {
    now: () => clock++,
    newId: () => `m${++next}`,
  });
}

function line(id: string, points: [number, number][]): MapLineElement {
  return { id, kind: "line", name: id, hidden: false, locked: false, points };
}

describe("createMapStore", () => {
  it("creates an empty Map under its own key and lists it from the index", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);

    const entry = await store.create({ name: "  The Reach  ", bookId: "b1", preset: "landscape" });

    expect(entry).toMatchObject({ id: "m1", name: "The Reach", bookId: "b1", preset: "landscape" });
    expect(values.get(mapKey("m1"))).toEqual({
      id: "m1",
      bookId: "b1",
      name: "The Reach",
      page: { preset: "landscape", widthMm: 228.6, heightMm: 152.4 },
      styleId: "atlas",
      overrides: {},
      elements: [],
      createdAt: 1000,
      updatedAt: 1000,
      dataVersion: DATA_VERSION,
    });
    expect(await store.list()).toEqual([entry]);
  });

  it("gives each page size its print dimensions", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);
    for (const preset of ["portrait", "landscape", "spread", "square"] as const) {
      await store.create({ name: preset, bookId: null, preset });
    }
    const pages = [1, 2, 3, 4].map((n) => (values.get(mapKey(`m${n}`)) as { page: unknown }).page);
    expect(pages).toEqual([
      { preset: "portrait", widthMm: 152.4, heightMm: 228.6 },
      { preset: "landscape", widthMm: 228.6, heightMm: 152.4 },
      { preset: "spread", widthMm: 304.8, heightMm: 228.6 },
      { preset: "square", widthMm: 203.2, heightMm: 203.2 },
    ]);
  });

  it("lists newest first and reads only the index, never a whole Map", async () => {
    const { storage, reads } = memoryStorage();
    const store = storeOver(storage);
    await store.create({ name: "Old", bookId: null, preset: "square" });
    await store.create({ name: "New", bookId: null, preset: "square" });
    reads.length = 0;

    const listed = await store.list();

    expect(listed.map((entry) => entry.name)).toEqual(["New", "Old"]);
    expect(reads).toEqual([INDEX_KEY]);
  });

  it("carries a small page-shaped preview in each index entry", async () => {
    const { storage } = memoryStorage();
    const store = storeOver(storage);
    const entry = await store.create({ name: "Isle", bookId: null, preset: "spread" });
    expect(entry.preview.startsWith("data:image/svg+xml,")).toBe(true);
    const svg = decodeURIComponent(entry.preview.slice("data:image/svg+xml,".length));
    expect(svg).toContain('viewBox="0 0 304.8 228.6"');
    expect(entry.preview.length).toBeLessThan(1024);
  });

  it("renames the Map and its index entry together, and moves it to the top", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);
    await store.create({ name: "First", bookId: null, preset: "portrait" });
    await store.create({ name: "Second", bookId: null, preset: "portrait" });

    const renamed = await store.rename("m1", " Kingdom of Ash ");

    expect(renamed).toMatchObject({ id: "m1", name: "Kingdom of Ash", updatedAt: 1002 });
    expect(values.get(mapKey("m1"))).toMatchObject({ name: "Kingdom of Ash", updatedAt: 1002 });
    expect((await store.list()).map((entry) => entry.name)).toEqual(["Kingdom of Ash", "Second"]);
  });

  it("deletes the Map's key and its index entry", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);
    await store.create({ name: "Keep", bookId: null, preset: "portrait" });
    await store.create({ name: "Drop", bookId: null, preset: "portrait" });

    await store.remove("m2");

    expect(values.has(mapKey("m2"))).toBe(false);
    expect(values.has(mapKey("m1"))).toBe(true);
    expect((await store.list()).map((entry) => entry.id)).toEqual(["m1"]);
  });

  it("refuses an empty name, and renaming or deleting a Map that is not there", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);
    await expect(store.create({ name: "   ", bookId: null, preset: "square" })).rejects.toThrow(
      "empty-name"
    );
    expect(values.size).toBe(0);
    await store.create({ name: "Real", bookId: null, preset: "square" });
    await expect(store.rename("m1", "")).rejects.toThrow("empty-name");
    await expect(store.rename("nope", "X")).rejects.toThrow("not-found");
    await store.remove("nope");
    expect((await store.list()).map((entry) => entry.name)).toEqual(["Real"]);
  });

  it("keeps the index whole when writes overlap", async () => {
    const { storage } = memoryStorage();
    const store = storeOver(storage);
    await Promise.all([
      store.create({ name: "A", bookId: null, preset: "square" }),
      store.create({ name: "B", bookId: null, preset: "square" }),
      store.create({ name: "C", bookId: null, preset: "square" }),
    ]);
    expect((await store.list()).map((entry) => entry.name).sort()).toEqual(["A", "B", "C"]);
    await Promise.all([store.rename("m1", "A2"), store.remove("m2")]);
    expect((await store.list()).map((entry) => entry.name).sort()).toEqual(["A2", "C"]);
  });

  it("removes the new Map's key when the index write fails, so no orphan is left", async () => {
    const memory = memoryStorage();
    const failing: MapStorage = {
      ...memory.storage,
      async set(input) {
        if (input.key === INDEX_KEY) throw new Error("library-unavailable");
        return memory.storage.set(input);
      },
    };
    const store = storeOver(failing);
    await expect(store.create({ name: "X", bookId: null, preset: "square" })).rejects.toThrow(
      "library-unavailable"
    );
    expect(memory.values.size).toBe(0);
  });

  it("refuses to rename a stored Map it cannot index, instead of dropping it from the list", async () => {
    const entry = {
      id: "m1",
      bookId: null,
      name: "Old",
      preset: "square",
      updatedAt: 1,
      preview: "data:,",
    };
    const { storage } = memoryStorage([
      [INDEX_KEY, [entry]],
      [mapKey("m1"), { id: "m1", name: "Old", elements: [], page: { widthMm: 1, heightMm: 1 } }],
    ]);
    const store = storeOver(storage);
    await expect(store.rename("m1", "New")).rejects.toThrow("not-found");
    expect(await store.list()).toEqual([entry]);
  });

  it("reads a damaged index as empty and skips malformed rows", async () => {
    const { storage } = memoryStorage([[INDEX_KEY, "garbage"]]);
    expect(await storeOver(storage).list()).toEqual([]);
    const mixed = memoryStorage([
      [
        INDEX_KEY,
        [
          {
            id: "ok",
            bookId: null,
            name: "Fine",
            preset: "square",
            updatedAt: 5,
            preview: "data:,",
          },
          { id: 3, name: null },
        ],
      ],
    ]);
    expect((await storeOver(mixed.storage).list()).map((entry) => entry.id)).toEqual(["ok"]);
  });

  it("loads one Map, and treats a damaged Map or a missing one as absent", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);
    await store.create({ name: "Drawn", bookId: null, preset: "square" });
    const created = values.get(mapKey("m1")) as MapDocument;

    expect(await store.load("m1")).toEqual(created);
    expect(await store.load("missing")).toBeNull();

    await storage.set({
      key: mapKey("m1"),
      value: { ...created, elements: [line("short", [[0, 0]])] },
    });
    expect(await store.load("m1")).toBeNull();
  });

  it("saves the Map and its index entry, with the line in the preview and a new time", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);
    await store.create({ name: "Drawn", bookId: null, preset: "square" });
    const loaded = (await store.load("m1")) as MapDocument;

    await store.save({
      ...loaded,
      elements: [
        line("coast", [
          [0, 0],
          [10, 10],
        ]),
      ],
    });

    const stored = values.get(mapKey("m1")) as MapDocument;
    expect(stored.updatedAt).toBe(1001);
    expect(stored.elements).toEqual([
      line("coast", [
        [0, 0],
        [10, 10],
      ]),
    ]);

    const [entry] = await store.list();
    expect(entry.updatedAt).toBe(1001);
    expect(entry.preview).toBe(mapPreview(stored));
    expect(mapPreview(stored)).toBe(`data:image/svg+xml,${encodeURIComponent(sceneToSvg(stored))}`);
    const svg = decodeURIComponent(entry.preview.slice("data:image/svg+xml,".length));
    expect(svg).toContain('data-element-id="coast"');
    expect(svg).toContain('d="M 0 0 L 10 10"');
  });

  it("writes the Map before the index and restores the old Map when the index write fails", async () => {
    const memory = memoryStorage();
    const setup = storeOver(memory.storage);
    await setup.create({ name: "Kept", bookId: null, preset: "square" });
    const before = structuredClone(memory.values.get(mapKey("m1")));

    const operations: string[] = [];
    const failing: MapStorage = {
      async get(input) {
        operations.push(`get:${input.key}`);
        return memory.storage.get(input);
      },
      async set(input) {
        operations.push(`set:${input.key}`);
        if (input.key === INDEX_KEY) throw new Error("index-offline");
        return memory.storage.set(input);
      },
      async delete(input) {
        operations.push(`delete:${input.key}`);
        return memory.storage.delete(input);
      },
    };
    const store = storeOver(failing);

    await expect(
      store.save({
        ...(before as MapDocument),
        elements: [
          line("coast", [
            [0, 0],
            [1, 1],
          ]),
        ],
      })
    ).rejects.toThrow("index-offline");

    expect(memory.values.get(mapKey("m1"))).toEqual(before);
    expect(operations.filter((operation) => operation.startsWith("set:"))).toEqual([
      `set:${mapKey("m1")}`,
      `set:${INDEX_KEY}`,
      `set:${mapKey("m1")}`,
    ]);
  });

  it("refuses a Map with a short or non-finite Map Line, and one that is not stored", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);
    await store.create({ name: "Drawn", bookId: null, preset: "square" });
    const loaded = (await store.load("m1")) as MapDocument;
    const before = structuredClone(values.get(mapKey("m1")));

    await expect(store.save({ ...loaded, elements: [line("short", [[0, 0]])] })).rejects.toThrow(
      "invalid-map"
    );
    await expect(
      store.save({
        ...loaded,
        elements: [
          line("broken", [
            [0, 0],
            [Number.NaN, 1],
          ]),
        ],
      })
    ).rejects.toThrow("invalid-map");
    expect(values.get(mapKey("m1"))).toEqual(before);

    await expect(store.save({ ...loaded, id: "missing" })).rejects.toThrow("not-found");
  });

  it("keeps concurrent saves in order", async () => {
    const { storage } = memoryStorage();
    const store = storeOver(storage);
    await store.create({ name: "Drawn", bookId: null, preset: "square" });
    const loaded = (await store.load("m1")) as MapDocument;

    await Promise.all([
      store.save({ ...loaded, name: "First" }),
      store.save({ ...loaded, name: "Second" }),
    ]);

    expect(await store.load("m1")).toMatchObject({ name: "Second", updatedAt: 1002 });
  });
});

describe("migrateMapsData", () => {
  it("leaves version 1 data exactly as it was", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);
    await store.create({ name: "Kept", bookId: "b1", preset: "portrait" });
    const before = structuredClone([...values]);
    await migrateMapsData(storage, 1);
    expect([...values]).toEqual(before);
  });

  it("refuses a version it does not know, so activation stops before any write", async () => {
    const { storage, values } = memoryStorage([[INDEX_KEY, []]]);
    await expect(migrateMapsData(storage, 0)).rejects.toThrow("version 0");
    expect([...values]).toEqual([[INDEX_KEY, []]]);
  });
});
