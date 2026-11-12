/**
 * The Maps asset library (#756): one storage key per uploaded picture plus the
 * `assets` index the Library reads, and `custom-fills` for the Fills the author
 * makes from them. Every test goes through `createAssetStore` over an
 * in-memory storage that records which keys were written, so "the index never
 * carries the bytes" and the write order are facts the test can see.
 */

import { describe, expect, it } from "vitest";
import {
  ASSET_MAX_BYTES,
  ASSETS_KEY,
  AssetTooLargeError,
  CUSTOM_FILLS_KEY,
  assetKey,
  createAssetStore,
  customStampRef,
  parseCustomStampRef,
  type AssetIndexEntry,
  type CustomFill,
  type MapAsset,
} from "./assets";
import type { MapStorage } from "./maps";

/** An in-memory storage that remembers every key it was asked to write. */
function memoryStorage(seed: Iterable<[string, unknown]> = []) {
  const values = new Map<string, unknown>(seed);
  const attempts: string[] = [];
  const failing = new Set<string>();
  const storage: MapStorage = {
    async get({ key }) {
      return values.has(key) ? structuredClone(values.get(key)) : null;
    },
    async set({ key, value }) {
      attempts.push(key);
      if (failing.has(key)) throw new Error(`write failed: ${key}`);
      values.set(key, structuredClone(value));
      return null;
    },
    async delete({ key }) {
      values.delete(key);
      return null;
    },
  };
  return { storage, values, attempts, failing };
}

/** An uploaded picture named `id`; the bytes are a placeholder, not a real image. */
function asset(overrides: Partial<MapAsset> = {}): MapAsset {
  return {
    id: "a1",
    name: "Compass",
    mime: "image/png",
    data: "iVBORw0KGgo=",
    width: 64,
    height: 64,
    recolorable: false,
    ...overrides,
  };
}

/** An asset whose JSON encoding is exactly `bytes` long, for the cap boundary. */
function assetOfBytes(bytes: number): MapAsset {
  const base = asset({ data: "" });
  const overhead = new TextEncoder().encode(JSON.stringify(base)).byteLength;
  return asset({ data: "A".repeat(bytes - overhead) });
}

function entry(overrides: Partial<AssetIndexEntry> = {}): AssetIndexEntry {
  return {
    id: "a1",
    name: "Compass",
    mime: "image/png",
    width: 64,
    height: 64,
    recolorable: false,
    use: "stamp",
    ...overrides,
  };
}

describe("createAssetStore", () => {
  it("writes an asset under its own key and an index entry without its bytes", async () => {
    const { storage, values } = memoryStorage();
    const store = createAssetStore(storage);

    const saved = await store.saveAsset(asset(), "stamp");

    expect(saved).toEqual(entry());
    expect(values.get(assetKey("a1"))).toEqual(asset());
    expect(values.get(ASSETS_KEY)).toEqual([entry()]);
    expect(await store.getAsset("a1")).toEqual(asset());
    expect(await store.listAssets()).toEqual([entry()]);
  });

  it("keeps one index row per asset, updating it in place", async () => {
    const { storage, values } = memoryStorage();
    const store = createAssetStore(storage);

    await store.saveAsset(asset({ id: "a1" }), "stamp");
    await store.saveAsset(asset({ id: "a2" }), "image");
    await store.saveAsset(asset({ id: "a1", name: "Rose" }), "texture");

    expect(values.get(ASSETS_KEY)).toEqual([
      entry({ name: "Rose", use: "texture" }),
      entry({ id: "a2", name: "Compass", use: "image" }),
    ]);
    expect(await store.listAssets()).toHaveLength(2);
  });

  it("accepts an asset just under the cap and refuses one just over it", async () => {
    const { storage, values } = memoryStorage();
    const store = createAssetStore(storage);

    const under = assetOfBytes(Math.floor(ASSET_MAX_BYTES));
    await store.saveAsset(under, "stamp");
    expect(values.get(assetKey(under.id))).toMatchObject({ id: under.id });

    // The ids are the same length, so swapping a1 for a2 keeps the encoding size.
    const over = assetOfBytes(Math.ceil(ASSET_MAX_BYTES));
    over.id = "a2";
    const failure = await store.saveAsset(over, "image").then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(AssetTooLargeError);
    expect((failure as AssetTooLargeError).limit).toBe(ASSET_MAX_BYTES);
    // The refused save was measured before any write.
    expect(values.has(assetKey("a2"))).toBe(false);
    expect(await store.listAssets()).toEqual([entry()]);
  });

  it("rolls the asset key back when the index write fails", async () => {
    const { storage, values, attempts, failing } = memoryStorage();
    const store = createAssetStore(storage);
    failing.add(ASSETS_KEY);

    await expect(store.saveAsset(asset(), "stamp")).rejects.toThrow("write failed");

    expect(attempts).toEqual([assetKey("a1"), ASSETS_KEY]);
    expect(values.has(assetKey("a1"))).toBe(false);
    expect(values.has(ASSETS_KEY)).toBe(false);
  });

  it("refuses an asset this build cannot read", async () => {
    const { storage, values } = memoryStorage();
    const store = createAssetStore(storage);

    for (const broken of [
      asset({ id: "" }),
      asset({ name: 7 } as unknown as MapAsset),
      asset({ mime: "image/gif" } as unknown as MapAsset),
      asset({ data: "" }),
      asset({ width: 0 }),
      asset({ height: -1 }),
      asset({ recolorable: "no" } as unknown as MapAsset),
    ]) {
      await expect(store.saveAsset(broken, "stamp")).rejects.toThrow("invalid-asset");
    }
    await expect(store.saveAsset(asset(), "wallpaper" as never)).rejects.toThrow("invalid-asset");
    expect(values.size).toBe(0);
  });

  it("drops malformed index rows and unreadable stored assets", async () => {
    const { storage, values } = memoryStorage([
      [
        ASSETS_KEY,
        [
          entry(),
          null,
          7,
          { ...entry({ id: "a2" }), id: 7 },
          { ...entry({ id: "a3" }), use: "wallpaper" },
          { ...entry({ id: "a4" }), width: 0 },
          { ...entry({ id: "a5" }), mime: "image/gif" },
        ],
      ],
      [assetKey("a1"), asset()],
      [assetKey("a2"), { id: "a2" }],
    ]);
    const store = createAssetStore(storage);

    expect(await store.listAssets()).toEqual([entry()]);
    expect(await store.getAsset("a1")).toEqual(asset());
    expect(await store.getAsset("a2")).toBeNull();
    expect(await store.getAsset("missing")).toBeNull();
    expect(values.get(ASSETS_KEY)).toHaveLength(7);
  });

  it("reads no index at all when the stored value is not a list", async () => {
    const { storage } = memoryStorage([[ASSETS_KEY, { rows: [entry()] }]]);
    const store = createAssetStore(storage);

    expect(await store.listAssets()).toEqual([]);
  });
});

describe("custom fills", () => {
  it("saves a texture fill and a stamps fill, and lists them in order", async () => {
    const { storage, values } = memoryStorage();
    const store = createAssetStore(storage);

    const texture: CustomFill = { id: "meadow", name: "Meadow", texture: "a1" };
    const stamps: CustomFill = {
      id: "trees",
      name: "Trees",
      stamps: ["base:tree", "custom:copse"],
    };
    await store.saveCustomFill(texture);
    await store.saveCustomFill(stamps);

    expect(values.get(CUSTOM_FILLS_KEY)).toEqual([texture, stamps]);
    expect(await store.listCustomFills()).toEqual([texture, stamps]);
  });

  it("updates a fill in place when its id is already there", async () => {
    const { storage } = memoryStorage();
    const store = createAssetStore(storage);

    await store.saveCustomFill({ id: "meadow", name: "Meadow", texture: "a1" });
    await store.saveCustomFill({ id: "meadow", name: "Meadow Two", texture: "a2" });

    expect(await store.listCustomFills()).toEqual([
      { id: "meadow", name: "Meadow Two", texture: "a2" },
    ]);
  });

  it("refuses a fill with neither a texture nor any Stamp", async () => {
    const { storage, values } = memoryStorage();
    const store = createAssetStore(storage);

    for (const broken of [
      { id: "empty", name: "Empty" },
      { id: "no-texture", name: "None", stamps: [] },
      { id: "blank-texture", name: "Blank", texture: "" },
      { id: "bad-stamps", name: "Bad", stamps: [7] },
      { id: "blank-stamp", name: "Bad", stamps: [""] },
      { id: "", name: "Nameless", texture: "a1" },
      { id: "no-name", name: 7 },
    ]) {
      await expect(store.saveCustomFill(broken as unknown as CustomFill)).rejects.toThrow(
        "invalid-custom-fill"
      );
    }
    expect(values.has(CUSTOM_FILLS_KEY)).toBe(false);
  });

  it("drops malformed stored fills", async () => {
    const { storage } = memoryStorage([
      [
        CUSTOM_FILLS_KEY,
        [
          { id: "meadow", name: "Meadow", texture: "a1" },
          null,
          7,
          { id: "empty", name: "Empty" },
          { id: "bad", name: "Bad", stamps: [] },
          { id: "blank", name: "Blank", texture: "" },
          { id: "bad-stamp", name: "Bad", stamps: [7] },
          { id: 7, name: "Bad", texture: "a1" },
        ],
      ],
    ]);
    const store = createAssetStore(storage);

    expect(await store.listCustomFills()).toEqual([
      { id: "meadow", name: "Meadow", texture: "a1" },
    ]);
  });

  it("lists no fills when the stored value is not a list", async () => {
    const { storage } = memoryStorage([[CUSTOM_FILLS_KEY, "meadow"]]);
    const store = createAssetStore(storage);

    expect(await store.listCustomFills()).toEqual([]);
  });
});

describe("custom stamp refs", () => {
  it("names a Custom Stamp's asset as custom:<id>", () => {
    expect(customStampRef("a1")).toBe("custom:a1");
  });

  it("reads the asset id back, and nothing for a base or malformed ref", () => {
    expect(parseCustomStampRef("custom:a1")).toBe("a1");
    expect(parseCustomStampRef("base:marker")).toBeNull();
    expect(parseCustomStampRef("custom:")).toBeNull();
    expect(parseCustomStampRef("a1")).toBeNull();
  });
});
