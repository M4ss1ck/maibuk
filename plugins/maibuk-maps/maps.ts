/**
 * The Maps data model (#737, #744; ADR 0039). A Map is one JSON document under
 * its own Plugin storage key, `map:<id>`, and `index` lists every Map with just
 * what the list page draws (Book, name, page size, last change, a small
 * preview), so the list never loads a whole Map.
 *
 * Every write goes through one queue, so overlapping creates, renames, and
 * deletes never read a stale index. The index is the list's source of truth;
 * each write orders its two keys so a failure in the middle never lists a Map
 * that cannot be loaded:
 *
 * - create writes the Map, then the index, and removes the Map if the index
 *   write fails;
 * - rename writes the Map, then the index, and restores the old Map if the
 *   index write fails;
 * - delete removes the index entry first, then the Map. A failure between the
 *   two leaves an unlisted key, never a listed Map with no data.
 *
 * This module imports only its own files.
 */

/** The Plugin's data format version; `migrateData` owns every change to it. */
export const DATA_VERSION = 1;

/** The storage key of the list the Maps page reads. */
export const INDEX_KEY = "index";

/** The storage key of one Map. */
export function mapKey(id: string): string {
  return `map:${id}`;
}

/** The page sizes a Map is created with; print size and DPI come at export. */
export const PAGE_PRESETS = ["portrait", "landscape", "spread", "square"] as const;
export type PagePreset = (typeof PAGE_PRESETS)[number];

/**
 * Each preset's page in millimetres: a 6×9 in trade page upright or on its
 * side, a 12×9 in double-page spread, and an 8×8 in square.
 */
const PAGE_SIZES: Readonly<Record<PagePreset, { widthMm: number; heightMm: number }>> = {
  portrait: { widthMm: 152.4, heightMm: 228.6 },
  landscape: { widthMm: 228.6, heightMm: 152.4 },
  spread: { widthMm: 304.8, heightMm: 228.6 },
  square: { widthMm: 203.2, heightMm: 203.2 },
};

export interface MapPage {
  preset: PagePreset;
  widthMm: number;
  heightMm: number;
}

/** The five element kinds a Map holds (#737 Decision 6). */
export type MapElementKind = "line" | "fill" | "stamp" | "label" | "image";

/**
 * What every element shares. Each kind's own fields (points, anchor, stamp,
 * text, asset) arrive with the tickets that draw it; z-order is array order.
 */
export interface MapElement {
  id: string;
  kind: MapElementKind;
  name: string;
  hidden: boolean;
  locked: boolean;
}

/** One stored Map, exactly as `map:<id>` holds it. */
export interface MapDocument {
  id: string;
  bookId: string | null;
  name: string;
  page: MapPage;
  styleId: string;
  overrides: Record<string, unknown>;
  elements: MapElement[];
  createdAt: number;
  updatedAt: number;
  dataVersion: number;
}

/** One row of `index`: what the list page draws, without the Map's elements. */
export interface MapIndexEntry {
  id: string;
  bookId: string | null;
  name: string;
  preset: PagePreset;
  updatedAt: number;
  /** A small `data:image/svg+xml` picture of the Map. */
  preview: string;
}

/** The Map Style a new Map starts in. */
export const DEFAULT_STYLE_ID = "atlas";

/** The Atlas Map Style's water, which an empty Map shows. */
const EMPTY_MAP_COLOR = "#d7e6ec";

/** The longest Map name the store keeps. */
export const MAX_NAME_LENGTH = 120;

/** The slice of the SDK storage API the store uses. */
export interface MapStorage {
  get(input: { key: string }): Promise<unknown>;
  set(input: { key: string; value: unknown }): Promise<null>;
  delete(input: { key: string }): Promise<null>;
}

export interface NewMap {
  name: string;
  bookId: string | null;
  preset: PagePreset;
}

export interface MapStore {
  /** Every Map, most recently changed first, from the index alone. */
  list(): Promise<MapIndexEntry[]>;
  create(input: NewMap): Promise<MapIndexEntry>;
  rename(id: string, name: string): Promise<MapIndexEntry>;
  /** Deletes a Map; deleting one that is gone does nothing. */
  remove(id: string): Promise<void>;
}

/** A random id from the Worker's `getRandomValues` (a sandboxed Worker may lack `randomUUID`). */
export function randomMapId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The picture the index carries for a Map. Elements join it as their tickets land. */
export function mapPreview(map: Pick<MapDocument, "page">): string {
  const { widthMm, heightMm } = map.page;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthMm} ${heightMm}"><rect width="${widthMm}" height="${heightMm}" fill="${EMPTY_MAP_COLOR}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function indexEntryFor(map: MapDocument): MapIndexEntry {
  return {
    id: map.id,
    bookId: map.bookId,
    name: map.name,
    preset: map.page.preset,
    updatedAt: map.updatedAt,
    preview: mapPreview(map),
  };
}

function isPagePreset(value: unknown): value is PagePreset {
  return typeof value === "string" && (PAGE_PRESETS as readonly string[]).includes(value);
}

function isIndexEntry(value: unknown): value is MapIndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    (entry.bookId === null || typeof entry.bookId === "string") &&
    typeof entry.name === "string" &&
    isPagePreset(entry.preset) &&
    typeof entry.updatedAt === "number" &&
    typeof entry.preview === "string"
  );
}

function isMapDocument(value: unknown): value is MapDocument {
  if (typeof value !== "object" || value === null) return false;
  const map = value as Record<string, unknown>;
  const page = map.page as Record<string, unknown> | null | undefined;
  return (
    typeof map.id === "string" &&
    typeof map.name === "string" &&
    Array.isArray(map.elements) &&
    typeof page === "object" &&
    page !== null &&
    typeof page.widthMm === "number" &&
    typeof page.heightMm === "number"
  );
}

/** The trimmed name, or a throw the page shows as "Give the Map a name". */
function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  if (trimmed === "") throw new Error("empty-name");
  return trimmed;
}

function newestFirst(entries: MapIndexEntry[]): MapIndexEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createMapStore(
  storage: MapStorage,
  options: { now?: () => number; newId?: () => string } = {}
): MapStore {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomMapId;
  let queue: Promise<unknown> = Promise.resolve();

  /** Runs `task` after every earlier write, whether it succeeded or not. */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function readIndex(): Promise<MapIndexEntry[]> {
    const value = await storage.get({ key: INDEX_KEY });
    return Array.isArray(value) ? value.filter(isIndexEntry) : [];
  }

  async function writeIndex(entries: MapIndexEntry[]): Promise<void> {
    await storage.set({ key: INDEX_KEY, value: entries });
  }

  return {
    async list() {
      return newestFirst(await readIndex());
    },

    create(input) {
      return serial(async () => {
        const name = cleanName(input.name);
        const at = now();
        const map: MapDocument = {
          id: newId(),
          bookId: input.bookId,
          name,
          page: { preset: input.preset, ...PAGE_SIZES[input.preset] },
          styleId: DEFAULT_STYLE_ID,
          overrides: {},
          elements: [],
          createdAt: at,
          updatedAt: at,
          dataVersion: DATA_VERSION,
        };
        const entry = indexEntryFor(map);
        const index = await readIndex();
        await storage.set({ key: mapKey(map.id), value: map });
        try {
          await writeIndex([...index, entry]);
        } catch (error) {
          await storage.delete({ key: mapKey(map.id) }).catch(() => null);
          throw error;
        }
        return entry;
      });
    },

    rename(id, nextName) {
      return serial(async () => {
        const name = cleanName(nextName);
        const stored = await storage.get({ key: mapKey(id) });
        if (!isMapDocument(stored)) throw new Error("not-found");
        const map: MapDocument = { ...stored, name, updatedAt: now() };
        const entry = indexEntryFor(map);
        const index = await readIndex();
        await storage.set({ key: mapKey(id), value: map });
        try {
          await writeIndex([...index.filter((row) => row.id !== id), entry]);
        } catch (error) {
          await storage.set({ key: mapKey(id), value: stored }).catch(() => null);
          throw error;
        }
        return entry;
      });
    },

    remove(id) {
      return serial(async () => {
        const index = await readIndex();
        if (index.some((row) => row.id === id)) {
          await writeIndex(index.filter((row) => row.id !== id));
        }
        await storage.delete({ key: mapKey(id) });
      });
    },
  };
}

/**
 * Answers the host's `migrateData` request (`packaging.md`): rewrites stored
 * data written by `from` into the current `DATA_VERSION`. Version 1 is the
 * first, so there is nothing to rewrite yet; a version this build does not
 * know throws, which leaves the data untouched and refuses activation.
 */
export async function migrateMapsData(_storage: MapStorage, from: number): Promise<void> {
  if (from === DATA_VERSION) return;
  throw new Error(`Maps cannot migrate data from version ${from}`);
}
