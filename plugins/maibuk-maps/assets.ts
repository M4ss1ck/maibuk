/**
 * The Maps asset library (#756): the pictures an author uploads, and the
 * Custom Fills they build from them. Everything here is Library-wide, so every
 * Map reads the same index:
 *
 * - `asset:<id>` holds one whole picture, `MapAsset`, bytes and all;
 * - `assets` lists every picture with just what a picker draws, so the Library
 *   never loads the bytes until an Element draws one;
 * - `custom-fills` lists the Custom Fills, each naming a texture asset or
 *   Custom Stamps, so a Fill can point at one by id.
 *
 * Every write goes through one queue, so overlapping uploads never read a stale
 * index. `saveAsset` writes the picture first, then the index, and removes the
 * picture again if the index write fails: a failure in the middle never leaves
 * a listed asset that cannot be loaded. The index is the Library's source of
 * truth, and a malformed row is dropped on read rather than kept.
 *
 * This module imports only its own files.
 */

import type { MapStorage } from "./maps";

/** The largest an uploaded picture may be, measured on its JSON encoding. */
export const ASSET_MAX_BYTES = 3.9 * 1024 * 1024;

/** The storage key of the Library's asset index. */
export const ASSETS_KEY = "assets";

/** The storage key of the Library's Custom Fills. */
export const CUSTOM_FILLS_KEY = "custom-fills";

/** The storage key of one uploaded picture. */
export function assetKey(id: string): string {
  return `asset:${id}`;
}

/** The picture types the Library keeps. */
export const ASSET_MIMES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export type MapAssetMime = (typeof ASSET_MIMES)[number];

/** What an uploaded picture is used for: a Custom Stamp, a Map Image, or a Fill's texture. */
export const ASSET_USES = ["stamp", "image", "texture"] as const;
export type AssetUse = (typeof ASSET_USES)[number];

/** One uploaded picture, exactly as `asset:<id>` holds it. */
export interface MapAsset {
  id: string;
  name: string;
  mime: MapAssetMime;
  /** The picture's bytes, base64-encoded. */
  data: string;
  /** The picture's intrinsic width in pixels. */
  width: number;
  /** The picture's intrinsic height in pixels. */
  height: number;
  /** Whether the picture draws in one paint, so a Custom Stamp can tint it. */
  recolorable: boolean;
}

/** One row of `assets`: what a picker draws, without the picture's bytes. */
export interface AssetIndexEntry {
  id: string;
  name: string;
  mime: MapAssetMime;
  width: number;
  height: number;
  recolorable: boolean;
  use: AssetUse;
}

/**
 * A Fill the author built from an uploaded texture, from Custom Stamps, or
 * both: `texture` names an asset, `stamps` name Stamp refs to scatter. At
 * least one of the two is present.
 */
export interface CustomFill {
  id: string;
  name: string;
  /** The uploaded picture painted over the area, as an asset id. */
  texture?: string;
  /** The Stamps scattered over the area, as Stamp refs such as `base:tree` or `custom:<assetId>`. */
  stamps?: string[];
}

/** A Custom Stamp's ref: the Library asset it draws, rather than a `base:<id>` Stamp. */
export function customStampRef(assetId: string): string {
  return `custom:${assetId}`;
}

/** The asset id a Custom Stamp ref names, or null when the ref is a base Stamp or malformed. */
export function parseCustomStampRef(ref: string): string | null {
  const prefix = "custom:";
  if (!ref.startsWith(prefix)) return null;
  const id = ref.slice(prefix.length);
  return id === "" ? null : id;
}

/** The page localizes this with the limit, since only it knows the wording. */
export class AssetTooLargeError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`asset-too-large:${limit}`);
    this.name = "AssetTooLargeError";
    this.limit = limit;
  }
}

/** The slice of the SDK storage API the Library uses, as `createMapStore` does. */
export type AssetStorage = MapStorage;

export interface AssetStore {
  /** Writes an uploaded picture and its index row; refuses one over `ASSET_MAX_BYTES`. */
  saveAsset(asset: MapAsset, use: AssetUse): Promise<AssetIndexEntry>;
  /** One whole picture, or null when it is absent or damaged. */
  getAsset(id: string): Promise<MapAsset | null>;
  /** Every picture, from the index alone. */
  listAssets(): Promise<AssetIndexEntry[]>;
  /** Every Custom Fill, from the list alone. */
  listCustomFills(): Promise<CustomFill[]>;
  /** Writes a Custom Fill; refuses one with neither a texture nor any Stamp. */
  saveCustomFill(fill: CustomFill): Promise<void>;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/** Whether a value names one of the picture types the Library keeps. */
export function isMapAssetMime(value: unknown): value is MapAssetMime {
  return typeof value === "string" && (ASSET_MIMES as readonly string[]).includes(value);
}

/** Whether a value names one of the uses a picture can have. */
export function isAssetUse(value: unknown): value is AssetUse {
  return typeof value === "string" && (ASSET_USES as readonly string[]).includes(value);
}

/** Whether a value is a stored picture this build can draw. */
export function isMapAsset(value: unknown): value is MapAsset {
  if (typeof value !== "object" || value === null) return false;
  const asset = value as Record<string, unknown>;
  return (
    isString(asset.id) &&
    typeof asset.name === "string" &&
    isMapAssetMime(asset.mime) &&
    isString(asset.data) &&
    isPositiveNumber(asset.width) &&
    isPositiveNumber(asset.height) &&
    typeof asset.recolorable === "boolean"
  );
}

/** Whether a value is an index row this build can draw. */
export function isAssetIndexEntry(value: unknown): value is AssetIndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    isString(entry.id) &&
    typeof entry.name === "string" &&
    isMapAssetMime(entry.mime) &&
    isPositiveNumber(entry.width) &&
    isPositiveNumber(entry.height) &&
    typeof entry.recolorable === "boolean" &&
    isAssetUse(entry.use)
  );
}

/** Whether a value is a stored Custom Fill this build can draw. */
export function isCustomFill(value: unknown): value is CustomFill {
  if (typeof value !== "object" || value === null) return false;
  const fill = value as Record<string, unknown>;
  if (!isString(fill.id) || typeof fill.name !== "string") return false;
  if (fill.texture !== undefined && !isString(fill.texture)) return false;
  if (fill.stamps !== undefined) {
    if (!Array.isArray(fill.stamps) || fill.stamps.length === 0) return false;
    if (!fill.stamps.every(isString)) return false;
  }
  return fill.texture !== undefined || fill.stamps !== undefined;
}

/** The UTF-8 byte length of `text`, which is how the cap is measured. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** `rows` with `row` replacing the same id, or appended when the id is new. */
function upsert<T extends { id: string }>(rows: T[], row: T): T[] {
  return rows.some((candidate) => candidate.id === row.id)
    ? rows.map((candidate) => (candidate.id === row.id ? row : candidate))
    : [...rows, row];
}

export function createAssetStore(storage: AssetStorage): AssetStore {
  let queue: Promise<unknown> = Promise.resolve();

  /** Runs `task` after every earlier write, whether it succeeded or not. */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function readIndex(): Promise<AssetIndexEntry[]> {
    const value = await storage.get({ key: ASSETS_KEY });
    return Array.isArray(value) ? value.filter(isAssetIndexEntry) : [];
  }

  async function readCustomFills(): Promise<CustomFill[]> {
    const value = await storage.get({ key: CUSTOM_FILLS_KEY });
    return Array.isArray(value) ? value.filter(isCustomFill) : [];
  }

  return {
    saveAsset(asset, use) {
      return serial(async () => {
        if (!isMapAsset(asset) || !isAssetUse(use)) throw new Error("invalid-asset");
        if (utf8Bytes(JSON.stringify(asset)) > ASSET_MAX_BYTES) {
          throw new AssetTooLargeError(ASSET_MAX_BYTES);
        }
        const entry: AssetIndexEntry = {
          id: asset.id,
          name: asset.name,
          mime: asset.mime,
          width: asset.width,
          height: asset.height,
          recolorable: asset.recolorable,
          use,
        };
        const index = await readIndex();
        await storage.set({ key: assetKey(asset.id), value: asset });
        try {
          await storage.set({ key: ASSETS_KEY, value: upsert(index, entry) });
        } catch (error) {
          await storage.delete({ key: assetKey(asset.id) }).catch(() => null);
          throw error;
        }
        return entry;
      });
    },

    async getAsset(id) {
      const stored = await storage.get({ key: assetKey(id) });
      return isMapAsset(stored) && stored.id === id ? stored : null;
    },

    async listAssets() {
      return readIndex();
    },

    async listCustomFills() {
      return readCustomFills();
    },

    saveCustomFill(fill) {
      return serial(async () => {
        if (!isCustomFill(fill)) throw new Error("invalid-custom-fill");
        const fills = await readCustomFills();
        await storage.set({ key: CUSTOM_FILLS_KEY, value: upsert(fills, fill) });
      });
    },
  };
}
