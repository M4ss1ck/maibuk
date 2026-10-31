/**
 * The Built-in Plugins the app ships (#442, #444). A Built-in takes the same
 * path as any other Plugin (ADR 0019): the same loader, sandbox, manifest,
 * Plugin Permissions, and public API. The only difference is that it ships
 * pre-granted, and those grants are still listed and revocable.
 *
 * The store reads this source on every refresh to pre-grant an untouched
 * Built-in, to spot a modified copy, and to offer a shipped update. A release
 * build ships `plugins/index.json` beside the app (the list
 * `scripts/build-builtin-plugins.ts` writes); this source fetches it relative
 * to the app base once per session and maps each entry to the copy Maibuk
 * bundles. On the web it also reads each shipped file's bytes, so a replace can
 * write them; on Tauri it lists no files, because Rust copies the shipped
 * folder from the bundled resources (ADR 0020). The list is best-effort: a
 * missing, malformed, or unreadable index leaves it empty, and a single entry
 * that does not fit is dropped, so the app always runs with whatever shipped,
 * even with none.
 *
 * The E2E lane needs a Built-in to prove the Keep my copy / Update available
 * rows, and to prove a Reinstall or Replace writes the shipped copy, and it
 * drives the production web build, so it seeds this one seam: a device-local
 * list the seed writes into IndexedDB before the app boots. The seam exists only
 * in the E2E lane's build: `VITE_E2E_BUILTIN_SEED` is set by e2e/run-steps.mjs
 * alone, so every shipped build compiles the read away and no storage a
 * user or page writes can mark a folder Built-in (and so pre-granted). The seed
 * carries the seeded folder's own bytes, so a Reinstall writes a real shipped
 * copy; a shipped build never reads any of it, so it can never write Plugin code
 * into a real install.
 */

import { IS_WEB } from "@/lib/platform/target";
import type {
  BuiltInPlugin,
  BuiltInPluginIndexEntry,
  BuiltInPluginSource,
  PluginFolderFile,
  PluginManifest,
} from "@/features/plugins/types";

/**
 * The IndexedDB database the E2E seed writes the Built-in list into: one store,
 * one record. Exported so `e2e/support/storage.ts` writes exactly what this
 * reads; no shipped path writes it. It is IndexedDB, not localStorage, because
 * the seed carries every shipped byte: Reader's are 3 MB, past WebKit's
 * localStorage quota, which charges a non-Latin-1 string two bytes a character.
 */
export const E2E_BUILTIN_PLUGINS_DB = "maibuk-e2e-built-in-plugins";
/** The one object store, and the key of the one record in it. */
export const E2E_BUILTIN_PLUGINS_STORE = "seed";
export const E2E_BUILTIN_PLUGINS_RECORD = "list";

/** One seeded file of the Built-in's shipped copy, its bytes stored as-is. */
interface E2EBuiltInFile {
  path: string;
  bytes: Uint8Array;
}

/** One Built-in the E2E seed injects: identity, manifest, shipped hash, and bytes. */
interface E2EBuiltInSeed {
  id: string;
  manifest: PluginManifest;
  hash: string;
  /** The shipped copy's files, so a replace can write them; absent carries none. */
  files?: E2EBuiltInFile[];
}

function isSeed(value: unknown): value is E2EBuiltInSeed {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.hash === "string" &&
    typeof record.manifest === "object" &&
    record.manifest !== null
  );
}

/** One seeded file as the bytes a replace writes, or null when it does not fit. */
function seedFile(entry: E2EBuiltInFile): PluginFolderFile | null {
  // `isView`, not `instanceof`: a structured clone may hand back another
  // realm's Uint8Array.
  const { path, bytes } = entry;
  if (typeof path !== "string" || !ArrayBuffer.isView(bytes)) return null;
  return { path, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}

/** The seeded shipped files, or none when the seed carries no files. */
function seedFiles(files: unknown): PluginFolderFile[] {
  if (!Array.isArray(files)) return [];
  return files.flatMap((entry) => {
    const file =
      typeof entry === "object" && entry !== null ? seedFile(entry as E2EBuiltInFile) : null;
    return file === null ? [] : [file];
  });
}

/**
 * The E2E seed's Built-in list, or none. Only the E2E lane's build defines
 * `VITE_E2E_BUILTIN_SEED`, so a shipped build always lists none regardless of
 * any IndexedDB a user could write.
 */
async function readE2EBuiltIns(): Promise<BuiltInPlugin[]> {
  if (import.meta.env.VITE_E2E_BUILTIN_SEED !== "1") return [];
  if (typeof indexedDB === "undefined") return [];
  try {
    return decodeE2EBuiltIns(await readE2ESeedRecord());
  } catch {
    return [];
  }
}

/** The seed record, or undefined when no spec seeded one. */
function readE2ESeedRecord(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(E2E_BUILTIN_PLUGINS_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(E2E_BUILTIN_PLUGINS_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db
        .transaction(E2E_BUILTIN_PLUGINS_STORE, "readonly")
        .objectStore(E2E_BUILTIN_PLUGINS_STORE)
        .get(E2E_BUILTIN_PLUGINS_RECORD);
      read.onsuccess = () => {
        db.close();
        resolve(read.result);
      };
      read.onerror = () => {
        db.close();
        reject(read.error);
      };
    };
  });
}

/**
 * The E2E seed read once per page load, like the shipped index: the launch asks
 * for the list several times (the sync, the scan), and the seed carries every
 * shipped byte, so reading it per call costs a Plugin's start-up time again
 * (issue #653, gate 1). The seed is written before the app boots, so one load
 * always sees the seed the spec wrote.
 */
let e2eSeedOnce: Promise<BuiltInPlugin[]> | null = null;

function e2eSeedOnceList(): Promise<BuiltInPlugin[]> {
  e2eSeedOnce ??= readE2EBuiltIns();
  return e2eSeedOnce;
}

function decodeE2EBuiltIns(record: unknown): BuiltInPlugin[] {
  if (typeof record !== "object" || record === null) return [];
  const plugins = (record as { plugins?: unknown }).plugins;
  if (!Array.isArray(plugins)) return [];
  return plugins.flatMap((entry) =>
    isSeed(entry)
      ? [{ id: entry.id, manifest: entry.manifest, hash: entry.hash, files: seedFiles(entry.files) }]
      : []
  );
}

/**
 * The shipped list's path under the app base, the file the build writes.
 */
const BUILT_IN_INDEX_PATH = "plugins/index.json";

function isIndexEntry(value: unknown): value is BuiltInPluginIndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id !== "" &&
    typeof record.hash === "string" &&
    typeof record.manifest === "object" &&
    record.manifest !== null &&
    Array.isArray(record.files) &&
    record.files.every((path) => typeof path === "string")
  );
}

/** The app-base URL of one shipped path, so a sub-path base is respected. */
function builtInUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/** One shipped file's bytes; a throw the caller turns into a dropped entry. */
async function fetchShippedBytes(fetchImpl: typeof fetch, url: string): Promise<Uint8Array> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * One index entry as a Built-in Plugin, or null when it does not fit (a shape
 * the index should never ship, an invalid manifest, or (on the web) a shipped
 * file this install cannot read). Dropping one entry leaves the rest intact.
 */
async function readIndexEntry(
  entry: BuiltInPluginIndexEntry,
  fetchImpl: typeof fetch
): Promise<BuiltInPlugin | null> {
  // Loaded here, not at module scope: the entry chunk must stay free of the
  // manifest validator (entry-chunk.test.ts, #437).
  const { validateManifestValue } = await import("@/features/plugins/manifest-validate");
  const validation = validateManifestValue(entry.manifest, { builtIn: true });
  if (!validation.ok) {
    console.warn(`Built-in Plugin ${entry.id} ships an invalid manifest; skipping it`);
    return null;
  }
  const manifest: PluginManifest = validation.manifest;
  if (!IS_WEB) {
    // Rust copies the shipped folder from the bundled resources (ADR 0020), so
    // the bytes never cross the IPC boundary and the source lists none.
    return { id: entry.id, manifest, hash: entry.hash, files: [] };
  }
  try {
    const files: PluginFolderFile[] = [];
    for (const path of entry.files) {
      files.push({
        path,
        bytes: await fetchShippedBytes(fetchImpl, builtInUrl(`plugins/${entry.id}/${path}`)),
      });
    }
    return { id: entry.id, manifest, hash: entry.hash, files };
  } catch (error) {
    console.warn(`Built-in Plugin ${entry.id} could not be read; skipping it`, error);
    return null;
  }
}

/**
 * The shipped list read once: `index.json` parsed, then every entry validated
 * and (on the web) its bytes read. A missing, HTML, or malformed index yields
 * an empty list; an entry that does not fit is dropped. Never throws.
 */
async function loadBuiltInPlugins(fetchImpl: typeof fetch): Promise<BuiltInPlugin[]> {
  let parsed: unknown;
  try {
    const response = await fetchImpl(builtInUrl(BUILT_IN_INDEX_PATH));
    if (!response.ok) {
      console.warn(`No Built-in Plugins index (${response.status}); shipping none`);
      return [];
    }
    parsed = await response.json();
  } catch (error) {
    // A dev server answers an unknown path with HTML, and a read-only or
    // missing file rejects: either way the app runs with no Built-ins.
    console.warn("No Built-in Plugins index; shipping none", error);
    return [];
  }
  const list =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { plugins?: unknown }).plugins
      : undefined;
  if (!Array.isArray(list)) {
    console.warn("Built-in Plugins index carries no plugin list; shipping none");
    return [];
  }
  const read = await Promise.all(
    list.map((entry) =>
      isIndexEntry(entry) ? readIndexEntry(entry, fetchImpl) : Promise.resolve(null)
    )
  );
  return read.filter((plugin): plugin is BuiltInPlugin => plugin !== null);
}

/**
 * The shipped list, loaded once per session: every default source the app wires
 * shares this promise, so however often a refresh lists Built-ins the index is
 * fetched exactly once. A test injects its own `fetch` and gets its own source.
 */
let shippedBuiltIns: Promise<BuiltInPlugin[]> | null = null;

function shippedBuiltInsOnce(fetchImpl: typeof fetch): Promise<BuiltInPlugin[]> {
  shippedBuiltIns ??= loadBuiltInPlugins(fetchImpl);
  return shippedBuiltIns;
}

/**
 * The production Built-in source: the shipped Built-ins this platform installs
 * from, read from `plugins/index.json` once per session (see the module
 * comment). `fetchImpl` is injectable for tests; the app call sites pass
 * nothing.
 */
export function createBuiltInPluginSource(
  fetchImpl: typeof fetch = globalThis.fetch
): BuiltInPluginSource {
  return {
    async list(): Promise<BuiltInPlugin[]> {
      // The E2E lane's device-local seed, compiled in only there; every shipped
      // build takes the fetch path below.
      if (import.meta.env.VITE_E2E_BUILTIN_SEED === "1") return e2eSeedOnceList();
      return shippedBuiltInsOnce(fetchImpl);
    },
  };
}
