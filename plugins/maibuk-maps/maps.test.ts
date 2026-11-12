/**
 * The Maps data model (#744): one storage key per Map plus the `index` the list
 * page reads. Every test goes through `createMapStore` over an in-memory
 * storage that records which keys were read, so "the list never loads a whole
 * Map" is a fact the test can see.
 */

import { describe, expect, it } from "vitest";
import {
  DATA_VERSION,
  DEFAULT_FILL_COLOR,
  DEFAULT_LABEL_FONT,
  DEFAULT_LABEL_HALO_MM,
  DEFAULT_LABEL_SIZE_MM,
  DEFAULT_LABEL_WIDTH_MM,
  DEFAULT_SCALE_BAR_SIZE_MM,
  DEFAULT_STAMP_SIZE_MM,
  INDEX_KEY,
  LINE_STYLE_DEFAULT_ENCLOSES,
  MAP_LABEL_FONTS,
  MAP_LABEL_FONT_FAMILIES,
  PAGE_SIZES,
  bendFromPoint,
  createMapStore,
  labelBaselinePath,
  mapKey,
  mapPreview,
  migrateMapsData,
  newLabel,
  newStamp,
  type MapDocument,
  type MapElement,
  type MapFillElement,
  type MapLabelElement,
  type MapLineElement,
  type MapStampElement,
  type MapStorage,
} from "./maps";
import { sceneToSvg } from "./scene";
import { MAP_STYLES } from "./styles";
import { SCALE_BAR_STAMP_REF } from "./stamps";
import { templateElements } from "./templates";

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
  return {
    id,
    kind: "line",
    name: id,
    hidden: false,
    locked: false,
    points,
    style: "plain",
    enclosesFills: LINE_STYLE_DEFAULT_ENCLOSES.plain,
    closed: false,
    curves: points.slice(1).map(() => true),
    roughened: false,
  };
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

  it("starts a Map from a Template, writing its Elements, style, and name at once", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);

    await store.create({
      name: "  The Reach  ",
      bookId: null,
      preset: "landscape",
      templateId: "archipelago",
    });

    // The Map took `m1`; its Elements take the ids that follow it.
    let next = 1;
    const expected = templateElements(
      "archipelago",
      PAGE_SIZES.landscape,
      "The Reach",
      () => `m${++next}`
    );
    expect(values.get(mapKey("m1"))).toMatchObject({
      styleId: "parchment",
      elements: expected,
    });
    // The title Label carries the cleaned Map name.
    expect(expected.find((element) => element.kind === "label")).toMatchObject({
      text: "The Reach",
    });
  });

  it("names a Template's Elements in the author's language", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);

    await store.create({
      name: "Las Islas",
      bookId: null,
      preset: "landscape",
      templateId: "archipelago",
      language: "es",
    });

    const map = values.get(mapKey("m1")) as MapDocument;
    expect(map.elements[0].name).toBe("Relleno 1");
    expect(
      map.elements.some(
        (element) => element.kind === "stamp" && element.name === "Rosa de los vientos"
      )
    ).toBe(true);
  });

  it("leaves a Map blank when it names no Template", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);

    await store.create({ name: "Blank", bookId: null, preset: "square" });

    expect(values.get(mapKey("m1"))).toMatchObject({ styleId: "atlas", elements: [] });
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

  it("reads an unknown Map Style as Atlas, and keeps a known one", async () => {
    const { storage, values } = memoryStorage();
    const store = storeOver(storage);
    await store.create({ name: "Styled", bookId: null, preset: "square" });
    const created = values.get(mapKey("m1")) as MapDocument;

    await storage.set({ key: mapKey("m1"), value: { ...created, styleId: "night" } });
    expect((await store.load("m1"))?.styleId).toBe("night");

    await storage.set({ key: mapKey("m1"), value: { ...created, styleId: "dusk" } });
    expect((await store.load("m1"))?.styleId).toBe("atlas");
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

describe("Map Line styles", () => {
  it("gives each style its Encloses Fills default", () => {
    expect(LINE_STYLE_DEFAULT_ENCLOSES).toEqual({
      coast: true,
      river: false,
      road: false,
      border: true,
      coastRipple: false,
      plain: true,
    });
  });

  it("keeps a Map Line's colour role or hex override, and refuses anything else", async () => {
    const base = {
      id: "line",
      kind: "line",
      name: "Line",
      hidden: false,
      locked: false,
      points: [
        [0, 0],
        [10, 0],
      ],
      style: "plain",
      enclosesFills: true,
      closed: false,
      curves: [false],
      roughened: false,
    };

    const role = await oldMap([{ ...base, color: "river" }]);
    expect((await role.store.load("m1"))?.elements[0]).toMatchObject({ color: "river" });

    const hex = await oldMap([{ ...base, color: "#123456" }]);
    expect((await hex.store.load("m1"))?.elements[0]).toMatchObject({ color: "#123456" });

    const named = await oldMap([{ ...base, color: "blue" }]);
    expect(await named.store.load("m1")).toBeNull();
  });

  /** A Map as #745 stored it: a Pencil line with no style fields at all. */
  async function oldMap(elements: unknown[]) {
    const memory = memoryStorage();
    const store = storeOver(memory.storage);
    await store.create({ name: "Old", bookId: null, preset: "square" });
    const created = memory.values.get(mapKey("m1")) as MapDocument;
    await memory.storage.set({ key: mapKey("m1"), value: { ...created, elements } });
    return { ...memory, store };
  }

  it("reads a Pencil line from before line styles as a plain, curved line", async () => {
    const { store } = await oldMap([
      {
        id: "pencil",
        kind: "line",
        name: "Pencil",
        hidden: false,
        locked: false,
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
      },
    ]);

    expect(await store.load("m1")).toMatchObject({
      elements: [
        {
          id: "pencil",
          style: "plain",
          enclosesFills: true,
          closed: false,
          curves: [true, true],
          roughened: false,
        },
      ],
    });
  });

  it("fills a missing Encloses Fills from the line's own style", async () => {
    const { store } = await oldMap([
      {
        id: "river",
        kind: "line",
        name: "River",
        hidden: false,
        locked: false,
        points: [
          [0, 0],
          [10, 0],
        ],
        style: "river",
      },
    ]);

    expect((await store.load("m1"))?.elements[0]).toMatchObject({
      style: "river",
      enclosesFills: false,
      curves: [true],
    });
  });

  it("rejects a line whose style or curve flags are malformed", async () => {
    const base = {
      id: "broken",
      kind: "line",
      name: "Broken",
      hidden: false,
      locked: false,
      points: [
        [0, 0],
        [10, 0],
      ],
      style: "plain",
      enclosesFills: true,
      closed: false,
      roughened: false,
    };

    for (const element of [
      { ...base, style: "scribble" },
      { ...base, enclosesFills: "yes" },
      { ...base, closed: "no" },
      { ...base, curves: [true, false] },
      { ...base, curves: "curved" },
      { ...base, roughened: 1 },
    ]) {
      const { store } = await oldMap([element]);
      expect(await store.load("m1")).toBeNull();
    }
  });
});

describe("Map Fills", () => {
  /** A Fill at (10, 10), in the default land colour unless the test says otherwise. */
  function fill(id: string, overrides: Partial<MapFillElement> = {}): MapFillElement {
    return {
      id,
      kind: "fill",
      name: id,
      hidden: false,
      locked: false,
      anchor: [10, 10],
      content: { color: DEFAULT_FILL_COLOR },
      ...overrides,
    };
  }

  /** The Map holding `elements` as written to storage and read back. */
  async function loadMap(elements: unknown[]) {
    const memory = memoryStorage();
    const store = storeOver(memory.storage);
    await store.create({ name: "Fills", bookId: null, preset: "square" });
    const created = memory.values.get(mapKey("m1")) as MapDocument;
    await memory.storage.set({ key: mapKey("m1"), value: { ...created, elements } });
    return store.load("m1");
  }

  it("keeps a Fill's anchor and colour", async () => {
    const stored = fill("land", { anchor: [20.5, 30.25], content: { color: "#a0522d" } });

    expect(await loadMap([stored])).toMatchObject({ elements: [stored] });
  });

  it("normalizes the old default land colour to the land role", async () => {
    const stored = fill("land", { content: { color: DEFAULT_FILL_COLOR } });

    const loaded = await loadMap([stored]);
    expect((loaded?.elements[0] as MapFillElement).content.color).toBe("land");
  });

  it("rejects a Fill whose anchor or colour is malformed", async () => {
    const base = fill("broken");

    for (const element of [
      { ...base, anchor: undefined },
      { ...base, anchor: [10] },
      { ...base, anchor: [10, Number.NaN] },
      { ...base, anchor: "10,10" },
      { ...base, content: undefined },
      { ...base, content: null },
      { ...base, content: { color: 7 } },
      { ...base, content: { color: null } },
    ]) {
      expect(await loadMap([element])).toBeNull();
    }
  });

  it("gives the default Fill colour a land tone that differs from the water", () => {
    expect(DEFAULT_FILL_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_FILL_COLOR).not.toBe(MAP_STYLES.atlas.water);
  });

  it("keeps an Area Fill's own outline and its texture", async () => {
    const area = fill("forest", {
      anchor: [10, 10],
      outline: {
        points: [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
        curves: [false, false, false, false],
        roughened: true,
      },
      content: { color: "#c8d5a3", texture: "grass" },
    });

    expect(await loadMap([area])).toMatchObject({
      elements: [{ ...area, content: { ...area.content, color: "land" } }],
    });
  });

  it("keeps a Fill of scattered Stamps, or of a texture alone, with no colour", async () => {
    const scatter = { stamp: "base:tree", spacing: 6, seed: 12 };
    const [textured] = [fill("grass", { content: { texture: "marsh" } })];
    const [scattered] = [fill("trees", { content: { scatter } })];

    expect((await loadMap([textured]))?.elements[0]).toMatchObject({
      content: { texture: "marsh" },
    });
    expect((await loadMap([scattered]))?.elements[0]).toMatchObject({ content: { scatter } });
  });

  it("rejects a Fill with nothing to cover the area, or with malformed content", async () => {
    const base = fill("broken");

    for (const element of [
      { ...base, content: {} },
      { ...base, content: { color: undefined } },
      { ...base, content: { texture: "forest" } },
      { ...base, content: { color: "#c8d5a3", texture: 7 } },
      { ...base, content: { scatter: { stamp: "", spacing: 6, seed: 1 } } },
      { ...base, content: { scatter: { stamp: 7, spacing: 6, seed: 1 } } },
      { ...base, content: { scatter: { stamps: ["base:tree"], spacing: 6, seed: 1 } } },
      { ...base, content: { scatter: { stamp: "base:tree", spacing: 0, seed: 1 } } },
      { ...base, content: { scatter: { stamp: "base:tree", spacing: 6, seed: Number.NaN } } },
    ]) {
      expect(await loadMap([element])).toBeNull();
    }
  });

  it("rejects a Fill whose own outline, or Soft Edge, cannot be one", async () => {
    const base = fill("broken");
    const outline = {
      points: [
        [0, 0],
        [20, 0],
        [20, 20],
      ],
      curves: [false, false, false],
      roughened: false,
    };

    for (const element of [
      { ...base, outline: null },
      { ...base, outline: { ...outline, points: [[0, 0]] } },
      {
        ...base,
        outline: {
          ...outline,
          points: [
            [0, 0],
            [20, 0],
          ],
        },
      },
      { ...base, outline: { ...outline, curves: [false, false] } },
      { ...base, outline: { ...outline, curves: [false, false, "no"] } },
      { ...base, outline: { ...outline, roughened: "yes" } },
      {
        ...base,
        outline: {
          ...outline,
          points: [
            [0, 0],
            [20, 0],
            [Number.NaN, 20],
          ],
        },
      },
      { ...base, softEdge: -1 },
      { ...base, softEdge: "2" },
    ]) {
      expect(await loadMap([element])).toBeNull();
    }
  });

  it("keeps a Soft Edge on a Fill and on a Map Line, and reads a stored 0 back as sharp", async () => {
    const soft = fill("soft", { softEdge: 2.5 });
    const line = {
      id: "coast",
      kind: "line",
      name: "Coast",
      hidden: false,
      locked: false,
      points: [
        [0, 0],
        [10, 0],
      ],
      style: "plain",
      enclosesFills: true,
      closed: false,
      curves: [false],
      roughened: false,
      softEdge: 1.25,
    };

    const loaded = await loadMap([soft, line]);
    expect(loaded?.elements[0]).toMatchObject({ softEdge: 2.5 });
    expect(loaded?.elements[1]).toMatchObject({ softEdge: 1.25 });

    // 0 and absent draw the same sharp edge, so 0 is not stored.
    const sharp = await loadMap([{ ...soft, softEdge: 0 }]);
    expect(sharp?.elements[0]).not.toHaveProperty("softEdge");
  });
});

describe("Map Shapes", () => {
  /** A rectangle Shape (#747) 40 by 20 mm centred on (30, 20), its outline drawn out. */
  const RECTANGLE = {
    kind: "rectangle",
    cx: 30,
    cy: 20,
    width: 40,
    height: 20,
    rotation: 0,
    sides: 6,
    cornerRadius: 0,
  };

  /** A Map Line carrying `shape`, as #747 stores it. */
  function shapeLine(shape: unknown) {
    return {
      id: "shape",
      kind: "line",
      name: "Rectangle 1",
      hidden: false,
      locked: false,
      points: [
        [10, 10],
        [50, 10],
        [50, 30],
        [10, 30],
      ],
      style: "plain",
      enclosesFills: true,
      closed: true,
      curves: [false, false, false, false],
      roughened: false,
      shape,
    };
  }

  /** The lines a stored Map holding `elements` loads, as written to storage and read back. */
  async function loadLines(elements: unknown[]): Promise<MapLineElement[]> {
    const memory = memoryStorage();
    const store = storeOver(memory.storage);
    await store.create({ name: "Shapes", bookId: null, preset: "square" });
    const created = memory.values.get(mapKey("m1")) as MapDocument;
    await memory.storage.set({ key: mapKey("m1"), value: { ...created, elements } });
    const doc = await store.load("m1");
    if (doc === null) throw new Error("the Map did not load");
    return doc.elements as MapLineElement[];
  }

  it("keeps the exact Shape a line stores", async () => {
    const exact = { ...RECTANGLE, kind: "ellipse", rotation: 15 };
    const [line] = await loadLines([shapeLine(exact)]);

    expect(line.shape).toEqual(exact);
    expect(line.convertedFrom).toBeUndefined();
  });

  it("clamps the numbers of a Shape it can keep", async () => {
    const [sides, radius, fraction] = await loadLines([
      shapeLine({ ...RECTANGLE, kind: "polygon", sides: 20 }),
      shapeLine({ ...RECTANGLE, cornerRadius: 100 }),
      shapeLine({ ...RECTANGLE, kind: "polygon", sides: 2.6, cornerRadius: -4 }),
    ]);

    expect(sides.shape?.sides).toBe(12);
    // Half the shorter side of a 40 by 20 mm rectangle.
    expect(radius.shape?.cornerRadius).toBe(10);
    expect(fraction.shape).toMatchObject({ sides: 3, cornerRadius: 0 });
  });

  it("drops a Shape that cannot be one, and keeps the line", async () => {
    const lines = await loadLines(
      [
        { ...RECTANGLE, kind: "star" },
        { ...RECTANGLE, width: 0 },
        { ...RECTANGLE, height: -5 },
        { ...RECTANGLE, cx: "30" },
        { ...RECTANGLE, rotation: null },
        { ...RECTANGLE, sides: null },
        "rectangle",
      ].map((shape) => shapeLine(shape))
    );

    expect(lines).toHaveLength(7);
    for (const line of lines) expect(line.shape).toBeUndefined();
  });

  it("keeps the kind a line was converted from, and drops an unknown one", async () => {
    const [converted, junk] = await loadLines([
      { ...shapeLine(undefined), convertedFrom: "rectangle" },
      { ...shapeLine(undefined), convertedFrom: "star" },
    ]);

    expect(converted.convertedFrom).toBe("rectangle");
    expect(junk.convertedFrom).toBeUndefined();
  });
});

describe("Map Stamps", () => {
  /** A marker Stamp centred on (10, 20), 12 mm wide and upright. */
  function stamp(overrides: Partial<MapStampElement> = {}): MapStampElement {
    return {
      id: "marker",
      kind: "stamp",
      name: "City",
      hidden: false,
      locked: false,
      stampRef: "base:marker",
      transform: { x: 10, y: 20, size: 12, rotation: 0 },
      color: MAP_STYLES.atlas.ink,
      ...overrides,
    };
  }

  /** The Elements a stored Map holding `elements` loads, or null when it refuses them. */
  async function loadElements(elements: unknown[]): Promise<MapElement[] | null> {
    const memory = memoryStorage();
    const store = storeOver(memory.storage);
    await store.create({ name: "Stamps", bookId: null, preset: "square" });
    const created = memory.values.get(mapKey("m1")) as MapDocument;
    await memory.storage.set({ key: mapKey("m1"), value: { ...created, elements } });
    const doc = await store.load("m1");
    return doc === null ? null : doc.elements;
  }

  it("gives a new Stamp the map ink, the default size, and the scale bar its scale", () => {
    const marker = newStamp({
      id: "marker",
      name: "City",
      stampRef: "base:marker",
      point: [30, 40],
    });

    expect(marker).toMatchObject({
      id: "marker",
      kind: "stamp",
      name: "City",
      hidden: false,
      locked: false,
      stampRef: "base:marker",
      transform: { x: 30, y: 40, size: DEFAULT_STAMP_SIZE_MM, rotation: 0 },
    });
    expect(marker.color).toBeUndefined();
    expect(marker.scale).toBeUndefined();

    const bar = newStamp({
      id: "bar",
      name: "Scale",
      stampRef: SCALE_BAR_STAMP_REF,
      point: [0, 0],
    });
    // The scale bar's size is the room its bar may take, so it starts wider
    // than a picture at the same spot.
    expect(bar.transform).toEqual({
      x: 0,
      y: 0,
      size: DEFAULT_SCALE_BAR_SIZE_MM,
      rotation: 0,
    });
    expect(bar.scale).toEqual({ unit: "km", span: 1000 });
  });

  it("keeps a Stamp's ref, transform, colour, and scale", async () => {
    const stored = stamp({
      stampRef: "base:scale-bar",
      transform: { x: 80, y: 190, size: 40, rotation: 15 },
      color: "#8b1a1a",
      scale: { unit: "mi", span: 500 },
    });

    expect(await loadElements([stored])).toEqual([stored]);
  });

  it("drops the old atlas ink from a Stamp, so it follows the Map Style", async () => {
    const [legacy] = (await loadElements([stamp({ color: "#1f2933" })])) as MapStampElement[];

    expect(legacy.color).toBeUndefined();
  });

  it("rejects a Stamp whose ref, transform, colour, or scale is malformed", async () => {
    const base = stamp();

    for (const element of [
      { ...base, stampRef: undefined },
      { ...base, stampRef: "" },
      { ...base, stampRef: 7 },
      { ...base, color: null },
      { ...base, transform: undefined },
      { ...base, transform: null },
      { ...base, transform: { x: 10, y: 20, size: 12 } },
      { ...base, transform: { ...base.transform, x: Number.NaN } },
      { ...base, transform: { ...base.transform, size: 0 } },
      { ...base, transform: { ...base.transform, size: -2 } },
      { ...base, transform: { ...base.transform, rotation: "45" } },
      { ...base, scale: null },
      { ...base, scale: { unit: "ft", span: 1000 } },
      { ...base, scale: { unit: "km", span: 0 } },
      { ...base, scale: { unit: "km", span: Number.POSITIVE_INFINITY } },
      { ...base, scale: { span: 1000 } },
    ]) {
      expect(await loadElements([element])).toBeNull();
    }
  });
});

describe("Map Labels", () => {
  /** A Map Label reading "The Reach" at (20, 30), 40 mm wide, upright, and flat. */
  function label(overrides: Partial<MapLabelElement> = {}): MapLabelElement {
    return {
      id: "reach",
      kind: "label",
      name: "The Reach",
      hidden: false,
      locked: false,
      text: "The Reach",
      x: 20,
      y: 30,
      rotation: 0,
      width: DEFAULT_LABEL_WIDTH_MM,
      bend: 0,
      font: DEFAULT_LABEL_FONT,
      size: DEFAULT_LABEL_SIZE_MM,
      letterSpacing: 0,
      halo: DEFAULT_LABEL_HALO_MM,
      ...overrides,
    };
  }

  /** The Elements a stored Map holding `elements` loads, or null when it refuses them. */
  async function loadElements(elements: unknown[]): Promise<MapElement[] | null> {
    const memory = memoryStorage();
    const store = storeOver(memory.storage);
    await store.create({ name: "Labels", bookId: null, preset: "square" });
    const created = memory.values.get(mapKey("m1")) as MapDocument;
    await memory.storage.set({ key: mapKey("m1"), value: { ...created, elements } });
    const doc = await store.load("m1");
    return doc === null ? null : doc.elements;
  }

  it("gives a new Label the text its caller localized, and the default shape", () => {
    const created = newLabel({
      id: "reach",
      name: "The Reach",
      text: "El Alcance",
      point: [20, 30],
    });

    // The model never names the label in English: the caller supplies the text.
    expect(created).toEqual(label({ text: "El Alcance" }));
  });

  it("keeps a Label's text, shape, font, spacing, halo, and colour through a save", async () => {
    const stored = label({
      id: "curved",
      text: "The Whisperwood",
      x: 60,
      y: 90,
      rotation: 15,
      width: 60,
      bend: 6,
      font: "cinzel",
      size: 4,
      letterSpacing: 0.4,
      halo: 1.5,
      color: "#8b1a1a",
    });

    expect(await loadElements([stored])).toEqual([stored]);
  });

  it("keeps a Label with no colour override and no halo", async () => {
    const plain = label({ halo: 0 });

    const [loaded] = (await loadElements([plain])) as MapLabelElement[];
    expect(loaded.color).toBeUndefined();
    expect(loaded.halo).toBe(0);
  });

  it("rejects a Label with no text, no width, or a bend that is not a number", async () => {
    const base = label();

    for (const element of [
      { ...base, text: undefined },
      { ...base, text: null },
      { ...base, text: 7 },
      { ...base, width: 0 },
      { ...base, width: -10 },
      { ...base, width: "40" },
      { ...base, bend: null },
      { ...base, bend: "6" },
      { ...base, bend: Number.NaN },
      { ...base, x: Number.NaN },
      { ...base, y: "30" },
      { ...base, rotation: "15" },
      { ...base, size: 0 },
      { ...base, letterSpacing: null },
      { ...base, halo: -1 },
      { ...base, color: 7 },
      { ...base, font: 7 },
    ]) {
      expect(await loadElements([element])).toBeNull();
    }
  });

  it("normalizes an unknown font to IM Fell English, and keeps the PDF Font", async () => {
    const [unknown, pdf] = (await loadElements([
      { ...label(), font: "papyrus" },
      label({ id: "pdf", font: "pdf" }),
    ])) as MapLabelElement[];

    expect(unknown.font).toBe(DEFAULT_LABEL_FONT);
    expect(pdf.font).toBe("pdf");
  });

  it("names the family each font id draws in", () => {
    expect(MAP_LABEL_FONTS).toEqual([
      "im-fell-english",
      "cinzel",
      "uncial-antiqua",
      "medieval-sharp",
    ]);
    expect(MAP_LABEL_FONT_FAMILIES).toEqual({
      "im-fell-english": "IM Fell English",
      cinzel: "Cinzel",
      "uncial-antiqua": "Uncial Antiqua",
      "medieval-sharp": "MedievalSharp",
      pdf: "Maibuk PDF Font",
    });
  });

  it("draws a label's baseline as a quadratic, bowed by its bend", () => {
    expect(labelBaselinePath(label())).toBe("M 0 30 Q 20 30 40 30");
    // A bend of 8 lifts the apex 8 mm above the chord, so the control point,
    // which a quadratic only reaches half way to, sits 16 mm above it.
    expect(labelBaselinePath(label({ bend: 8 }))).toBe("M 0 30 Q 20 14 40 30");
    expect(labelBaselinePath(label({ bend: -3 }))).toBe("M 0 30 Q 20 36 40 30");
  });

  it("turns the baseline about the label's centre", () => {
    // A quarter turn clockwise: the chord runs down the page from the centre,
    // the label's right-hand end becomes its bottom end, and its arch, which
    // lifts toward -y upright, now lifts toward +x.
    expect(labelBaselinePath(label({ rotation: 90 }))).toBe("M 20 10 Q 20 30 20 50");
    expect(labelBaselinePath(label({ rotation: 90, bend: 8 }))).toBe("M 20 10 Q 36 30 20 50");
  });

  it("reads a pointer's distance from the chord as the bend it asks for", () => {
    const flat = label();
    // Eight millimetres straight above the chord's middle is a bend of 8: the
    // same sagitta `labelBaselinePath` bows the name by.
    expect(bendFromPoint(flat, [20, 22])).toBe(8);
    // The other side of the chord bows the name the other way.
    expect(bendFromPoint(flat, [20, 38])).toBe(-8);
    // A point on the chord's line is a straight name, whether it sits between
    // the ends or past them: the handle measures the chord's line, not its ends.
    expect(bendFromPoint(flat, [20, 30])).toBe(0);
    expect(bendFromPoint(flat, [60, 22])).toBe(8);
  });

  it("reads the bend in the label's own turned frame, not the page's", () => {
    // A quarter turn clockwise makes the label's top face page +x, so eight
    // millimetres that way is the bend, exactly as the baseline bows it.
    const turned = label({ rotation: 90 });
    expect(bendFromPoint(turned, [28, 30])).toBe(8);
    expect(bendFromPoint(turned, [12, 30])).toBe(-8);
    expect(bendFromPoint(turned, [20, 30])).toBe(0);
    // The apex the baseline draws reads back as the bend it was drawn from.
    const angle = (turned.rotation * Math.PI) / 180;
    const apex: [number, number] = [turned.x + 8 * Math.sin(angle), turned.y - 8 * Math.cos(angle)];
    expect(bendFromPoint(turned, apex)).toBe(8);
  });

  it("rounds the bend to a tenth of a millimetre", () => {
    const flat = label();
    expect(bendFromPoint(flat, [20, 30 - 15.37])).toBe(15.4);
    expect(bendFromPoint(flat, [20, 30 + 15.34])).toBe(-15.3);
  });

  it("snaps a bend too small to see back to straight", () => {
    const flat = label();
    expect(bendFromPoint(flat, [20, 30 - 0.4])).toBe(0);
    expect(bendFromPoint(flat, [20, 30 + 0.4])).toBe(0);
    // Half a millimetre is already a bend the author asked for.
    expect(bendFromPoint(flat, [20, 30 - 0.5])).toBe(0.5);
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
