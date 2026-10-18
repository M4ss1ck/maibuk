// Setup-only storage helpers. With fault.ts, the only code in the suite
// allowed to touch IndexedDB or localStorage (keyboard contract, AC5).
// They prepare the device before the app boots; they never stand in for the
// behavior a spec is testing.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page, PlaywrightWorkerOptions } from "@playwright/test";
import { WEB_PLUGIN_DIRECTORY_NAME } from "@/lib/platform/web/plugins";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  serializePluginApprovals,
} from "@/features/plugins/approvals";
import { hashPluginDirectory, pluginFileDigests } from "@/features/plugins/directory-hash";
import type { PluginApproval, PluginFolderFile, PluginManifest } from "@/features/plugins/types";
import { PASTE_CLEANUP_PRESETS, type PasteCleanupPreset } from "@/features/settings/types";
import { readFolderFiles } from "@/test/support/plugin-fixtures";
import type { FramePage } from "../frames/frame-page";
import type { SeedName } from "./seed/libraries";
import { REPO_ROOT, SEED_DIR } from "./seed/seeds";

/**
 * The localStorage key `src/features/plugins/builtin.ts` reads (it exports the
 * same string as `E2E_BUILTIN_PLUGINS_STORAGE_KEY`). Kept as a literal here
 * because that module imports app code that reads `import.meta.env`, which the
 * Playwright runner does not define: importing it at module load aborts every
 * spec (the seeds avoid it the same way; see `e2e/support/seed/backups-present.ts`).
 */
const E2E_BUILTIN_PLUGINS_STORAGE_KEY = "maibuk-e2e-built-in-plugins";

/** `empty` is a fresh device: no Library in IndexedDB at all. */
export type LibrarySeed = SeedName | "empty";

/** `dismissed`: the first-launch Tutorial offer was already answered "Not now". */
export type TutorialProgressSeed = "dismissed" | "clean";

/**
 * A fixture Plugin the seed can write into the web Plugin Directory (OPFS). The
 * `tracer` and `approvals` folders are committed and used as-is; `remote-ui`,
 * `fixture-hostile`, `fixture-everything`, `fixture-everything-on-demand`,
 * `fixture-bench`, and `fixture-frame` are built from source at global setup.
 */
export type PluginSeed =
  | "tracer"
  | "remote-ui"
  | "approvals"
  | "fixture-hostile"
  | "fixture-everything"
  | "fixture-everything-on-demand"
  | "fixture-bench"
  | "fixture-frame"
  | "maibuk-echoes";

/**
 * One Plugin the seed installs: a named Plugin Directory folder (`name`), the
 * fixture its bytes are read from (`from`, defaulting to `name`), and any files
 * replaced or added by POSIX-relative path. A plain `PluginSeed` string is the
 * simple case; a clone (`clonePluginSeeds`) is an entry whose `name` is the
 * clone id and whose `from` is the fixture it copies.
 */
export interface PluginSeedEntry {
  /** The Plugin id and Plugin Directory folder name. */
  name: string;
  /** The fixture folder the files are read from; defaults to `name`. */
  from?: PluginSeed;
  /** Replaces or adds files by POSIX-relative path, e.g. a rewritten manifest. */
  files?: Record<string, string>;
}

/**
 * A seeded folder with files overridden (path -> UTF-8 text), never committed.
 * @deprecated A `PluginSeedEntry` whose `name` is a known fixture; kept for the
 * existing call sites.
 */
export type PluginSeedOverride = PluginSeedEntry & { name: PluginSeed };

/**
 * The approval record the seed writes for a Plugin, matching the v2 payload
 * (#442). Omitted fields default from the seeded folder and the fixture, so a
 * spec states only what it changes: a stale pin (changed files), a grant list,
 * a permission snapshot (a permission that became required), or a Built-in
 * shipped hash.
 */
export interface PluginApprovalSeed {
  pluginId: string;
  /** The pinned `h1:`; defaults to the folder's own hash. A stale value means changed files. */
  pinnedHash?: string;
  /** The granted Plugin Permissions; defaults to none. */
  granted?: string[];
  /** Whether the Plugin starts; defaults to true. */
  enabled?: boolean;
  /** The approved manifest version; defaults to the folder manifest's version. */
  approvedVersion?: string;
  /** The permission snapshot; defaults to the folder manifest's permissions. */
  approvedPermissions?: { required: string[]; optional: string[] };
  /** The approved per-file digests; defaults to the folder's own. */
  approvedFiles?: Record<string, string>;
  /** Replaces this path's approved digest, so a re-review shows it Changed. */
  changedFile?: string;
  /** Present for a Built-in Plugin; the shipped copy its record pins. */
  builtIn?: { shippedHash: string; keptModifiedHash?: string };
  /** The changed-files hash already notified, so it never notifies again. */
  notifiedHash?: string;
  /** The shipped hash already offered, so it never prompts again. */
  notifiedBuiltInHash?: string;
}

/**
 * A Built-in Plugin the E2E lane injects (the seam `createBuiltInPluginSource`
 * reads). `id` must name a seeded folder; the manifest is read from it.
 */
export interface BuiltInPluginSeed {
  id: PluginSeed;
  /**
   * The shipped copy's `h1:` hash the source reports. Defaults to the seeded
   * folder's own hash, so a spec that wants the untouched shipped copy (an
   * install, a remove, then a Reinstall that restores it) omits it; a spec that
   * wants a newer or older shipped copy states a different one.
   */
  hash?: string;
}

const PLUGIN_FIXTURES_DIR = resolve(REPO_ROOT, "e2e/fixtures/plugins");
/** The source-built fixture Plugins `buildPluginFixtures` leaves at global setup. */
const PLUGIN_BUILD_DIR = resolve(REPO_ROOT, "e2e/.output/plugins");

/** The fixture Plugins that live under `.output/plugins`, not the committed fixtures. */
const BUILT_PLUGIN_SEEDS: ReadonlySet<PluginSeed> = new Set([
  "remote-ui",
  "fixture-hostile",
  "fixture-everything",
  "fixture-everything-on-demand",
  "fixture-bench",
  "fixture-frame",
  "maibuk-echoes",
]);

const BLANK_PATH = "/__e2e__/blank";

export interface PluginSeedData {
  /** The Plugin id and Plugin Directory folder name (a clone id for a clone). */
  name: string;
  files: { path: string; base64: string }[];
  /** The fixture's committed pin; the app must compute the same h1: from OPFS. */
  pinnedHash: string;
}

/** The source folder a fixture's bytes are read from, built or committed. */
function pluginSeedDir(name: PluginSeed): string {
  return BUILT_PLUGIN_SEEDS.has(name)
    ? resolve(PLUGIN_BUILD_DIR, name)
    : resolve(PLUGIN_FIXTURES_DIR, name);
}

/**
 * The clone id for the `index`-th (1-based) copy of `from`, e.g.
 * `fixture-everything-on-demand-clone-01`. Pure, so it is unit-tested.
 */
export function clonePluginId(from: PluginSeed, index: number): string {
  return `${from}-clone-${String(index).padStart(2, "0")}`;
}

/**
 * Rewrites a fixture manifest for a clone: its `id` and `name` become the
 * clone's, and every Command drops its `defaults` (and `web` override) so no
 * clone's Shortcuts collide with its siblings'. Pure, so it is unit-tested; the
 * clone's pinned hash is recomputed from these rewritten bytes at seed time.
 */
export function clonePluginManifest(manifestText: string, id: string, name: string): string {
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  manifest.id = id;
  manifest.name = name;
  const contributes = manifest.contributes as { commands?: Record<string, unknown>[] } | undefined;
  for (const command of contributes?.commands ?? []) {
    delete command.defaults;
    delete command.web;
  }
  return JSON.stringify(manifest, null, 2);
}

/**
 * `count` clones of the built fixture `from`, each under its own Plugin id
 * (`clonePluginId`) with its manifest id and name rewritten and its default
 * Shortcuts dropped, so one spec can seed twenty Plugins that never collide.
 * Reads the built fixture's manifest, which global setup wrote before any spec
 * loads, so it must be called after global setup (a spec's `test.use` is).
 *
 * Returns a `Set`, not an array: Playwright's `test.use` reads an array whose
 * second element is an object as a fixture tuple (`isFixtureTuple`), so
 * `plugins: [clone1, clone2, …]` would seed one clone, not `count`.
 */
export function clonePluginSeeds(from: PluginSeed, count: number): Set<PluginSeedEntry> {
  const manifestPath = resolve(pluginSeedDir(from), "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `the fixture Plugin "${from}" has no built manifest at ${manifestPath}; run the E2E global setup`
    );
  }
  const sourceManifest = readFileSync(manifestPath, "utf8");
  const sourceName = (JSON.parse(sourceManifest) as { name: string }).name;
  // A locale file's `name` overrides the manifest name on screen, so each clone
  // renames it too; otherwise every clone would read as the source Plugin.
  const localesDir = resolve(pluginSeedDir(from), "locales");
  const sourceLocales = existsSync(localesDir)
    ? readdirSync(localesDir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => ({ file, text: readFileSync(resolve(localesDir, file), "utf8") }))
    : [];
  const entries = new Set<PluginSeedEntry>();
  for (let index = 0; index < count; index++) {
    const id = clonePluginId(from, index + 1);
    const files: Record<string, string> = {
      "manifest.json": clonePluginManifest(sourceManifest, id, `${sourceName} Clone ${index + 1}`),
    };
    for (const { file, text } of sourceLocales) {
      const locale = JSON.parse(text) as Record<string, unknown>;
      if (typeof locale.name === "string") locale.name = `${locale.name} Clone ${index + 1}`;
      files[`locales/${file}`] = `${JSON.stringify(locale, null, 2)}\n`;
    }
    entries.add({ name: id, from, files });
  }
  return entries;
}

async function readPluginSeed(seed: PluginSeed | PluginSeedEntry): Promise<PluginSeedData> {
  const entry: PluginSeedEntry = typeof seed === "string" ? { name: seed } : seed;
  const name = entry.name;
  const from = entry.from ?? name;
  const overrides = entry.files;
  // `tracer` is committed and used as-is, pinned by its committed
  // `tracer.expected.json`. `approvals` is committed without a pinned file:
  // its folder hash is computed here, so a single fixture serves approved,
  // changed, and Built-in seeds. The built fixtures are built from source at
  // global setup, so their pin is computed from the built bytes the app will
  // hash. A clone reads its source fixture's bytes and recomputes the pin from
  // the rewritten files, so the app hashes exactly what it installs.
  const dir = BUILT_PLUGIN_SEEDS.has(from as PluginSeed)
    ? await builtPluginSeed(from as PluginSeed)
    : { dir: resolve(PLUGIN_FIXTURES_DIR, from) };
  let files = readFolderFiles(dir.dir);
  if (overrides !== undefined) {
    files = files.filter((file) => !(file.path in overrides));
    for (const [path, text] of Object.entries(overrides)) {
      files.push({ path, bytes: new TextEncoder().encode(text) });
    }
  }
  const pinnedHash =
    name === "tracer"
      ? (
          JSON.parse(
            readFileSync(resolve(PLUGIN_FIXTURES_DIR, `${name}.expected.json`), "utf8")
          ) as { hash: string }
        ).hash
      : await hashPluginDirectory(files);
  return {
    name,
    files: files.map((file) => ({
      path: file.path,
      base64: Buffer.from(file.bytes).toString("base64"),
    })),
    pinnedHash,
  };
}

/** The folder and pinned hash of a source-built fixture Plugin under `.output`. */
async function builtPluginSeed(name: PluginSeed): Promise<{ dir: string }> {
  const dir = resolve(PLUGIN_BUILD_DIR, name);
  if (!existsSync(dir)) {
    throw new Error(
      `the built fixture Plugin "${name}" is missing at ${dir}; run the E2E global setup`
    );
  }
  return { dir };
}

/** The decoded files of one seeded fixture folder, for building an approval record. */
function seedFolderFiles(seed: PluginSeedData): PluginFolderFile[] {
  return seed.files.map((file) => ({
    path: file.path,
    bytes: Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0)),
  }));
}

function manifestOf(seed: PluginSeedData): PluginManifest {
  const file = seed.files.find((entry) => entry.path === "manifest.json");
  if (!file) throw new Error(`fixture Plugin "${seed.name}" has no manifest.json`);
  return JSON.parse(Buffer.from(file.base64, "base64").toString("utf8")) as PluginManifest;
}

/**
 * Builds one approval record from the seed's defaults and the folder's own
 * bytes, then applies the spec's overrides. The per-file snapshot defaults to
 * the folder's digests, so a stale `pinnedHash` alone reads as "files changed".
 *
 * Exported so the seed-record test (`src/test/unit/e2e-plugin-seed.test.ts`)
 * proves the record a spec seeds is exactly the one the approval flow writes
 * (`approvePluginCopy`). The default grant list is empty, so a spec that wants
 * the UI-written record for a Plugin with required Plugin Permissions states
 * them (`granted`), like `plugins: ["fixture-everything"]` with
 * `pluginApprovals: [{ pluginId, granted: [...required] }]`.
 */
export async function buildApproval(
  seed: PluginSeedData,
  overrides: PluginApprovalSeed
): Promise<PluginApproval> {
  const files = seedFolderFiles(seed);
  const manifest = manifestOf(seed);
  const digests = Object.fromEntries(await pluginFileDigests(files));
  const approvedFiles = { ...(overrides.approvedFiles ?? digests) };
  if (overrides.changedFile !== undefined) {
    approvedFiles[overrides.changedFile] = "0".repeat(64);
  }
  return {
    pluginId: overrides.pluginId,
    pinnedHash: overrides.pinnedHash ?? seed.pinnedHash,
    granted: (overrides.granted ?? []) as PluginApproval["granted"],
    enabled: overrides.enabled ?? true,
    approvedVersion: overrides.approvedVersion ?? manifest.version,
    approvedPermissions: overrides.approvedPermissions ?? {
      required: [...manifest.permissions.required],
      optional: [...manifest.permissions.optional],
    },
    approvedFiles,
    ...(overrides.builtIn !== undefined ? { builtIn: overrides.builtIn } : {}),
    ...(overrides.notifiedHash !== undefined ? { notifiedHash: overrides.notifiedHash } : {}),
    ...(overrides.notifiedBuiltInHash !== undefined
      ? { notifiedBuiltInHash: overrides.notifiedBuiltInHash }
      : {}),
  };
}

/**
 * Whether a test needs a persistent browser context to use the web Plugin
 * Directory: it seeds Plugins, or (`usesPluginDirectory`) installs one through
 * the app. WebKit has OPFS only there: in Playwright's default ephemeral
 * context `navigator.storage.getDirectory()` throws UnknownError, as in a
 * Safari Private window (#479). Chromium and Firefox have OPFS in either.
 */
export function needsPersistentContext({
  browserName,
  plugins,
  unapprovedPlugins,
  usesPluginDirectory = false,
}: {
  browserName: PlaywrightWorkerOptions["browserName"];
  plugins: Iterable<PluginSeed | PluginSeedEntry>;
  unapprovedPlugins: Iterable<PluginSeed>;
  usesPluginDirectory?: boolean;
}): boolean {
  if (browserName !== "webkit") return false;
  return usesPluginDirectory || [...plugins, ...unapprovedPlugins].length > 0;
}

/**
 * Writes the seed into the web adapter's IndexedDB store, the Tutorial
 * progress into localStorage, and any fixture Plugins into the web Plugin
 * Directory (OPFS) with the approval records the runtime reads, from a blank
 * same-origin page, before any app code runs. The page is left on the blank
 * page; the spec navigates.
 */
export async function prepareDevice(
  page: Page,
  {
    library,
    tutorial,
    plugins = [],
    unapprovedPlugins = [],
    pluginApprovals = [],
    builtInPlugins = [],
  }: {
    library: LibrarySeed;
    tutorial: TutorialProgressSeed;
    plugins?: Iterable<PluginSeed | PluginSeedEntry>;
    /** Folders seeded with no approval record at all (installed but unapproved). */
    unapprovedPlugins?: PluginSeed[];
    /** Approval records written as declared, overriding the default per Plugin. */
    pluginApprovals?: PluginApprovalSeed[];
    /** Built-in Plugins the E2E seam reports for the seeded folders. */
    builtInPlugins?: BuiltInPluginSeed[];
  }
): Promise<void> {
  const bytes =
    library === "empty"
      ? null
      : (await readFile(resolve(SEED_DIR, `${library}.sqlite`))).toString("base64");
  const seeds = await Promise.all(
    [...plugins, ...unapprovedPlugins].map((seed) => readPluginSeed(seed))
  );
  const byId = new Map(seeds.map((seed) => [seed.name, seed]));
  const custom = new Map(pluginApprovals.map((approval) => [approval.pluginId, approval]));
  const unapproved = new Set<string>(unapprovedPlugins);
  const builtInIds = new Set(builtInPlugins.map((entry) => entry.id as string));

  const approvals: PluginApproval[] = [];
  for (const seed of seeds) {
    if (unapproved.has(seed.name)) continue;
    const override = custom.get(seed.name);
    if (override !== undefined) {
      approvals.push(await buildApproval(seed, override));
      custom.delete(seed.name);
      continue;
    }
    // A Built-in starts disabled with its Plugin Permissions pre-granted
    // (`approveBuiltInCopy`), so a spec that seeds one without an explicit
    // approval leaves it to the app's own first-sight path instead of the
    // third-party default below (which is enabled but grants nothing).
    if (builtInIds.has(seed.name)) continue;
    // A folder seeded without a spec record keeps the historic shape: enabled
    // and pinned to the current bytes, no grants (`plugins: ["tracer"]`).
    approvals.push({
      pluginId: seed.name,
      pinnedHash: seed.pinnedHash,
      granted: [],
      enabled: true,
      approvedVersion: "",
      approvedPermissions: { required: [], optional: [] },
      approvedFiles: {},
    });
  }
  const orphan = [...custom.keys()][0];
  if (orphan !== undefined) {
    throw new Error(`plugin approval seed "${orphan}" names no seeded (approved) Plugin folder`);
  }
  const serialized = serializePluginApprovals(approvals);

  const builtIns = builtInPlugins.map((entry) => {
    const seed = byId.get(entry.id);
    if (seed === undefined) {
      throw new Error(`built-in "${entry.id}" names no seeded Plugin folder`);
    }
    return {
      id: entry.id,
      manifest: manifestOf(seed),
      hash: entry.hash ?? seed.pinnedHash,
      // The shipped bytes a Reinstall or a Replace writes; the seeded folder's
      // own bytes, so the written copy hashes to `hash` above.
      files: seed.files,
    };
  });

  await page.route(`**${BLANK_PATH}`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>e2e</title>" })
  );
  await page.goto(BLANK_PATH);
  await page.evaluate(
    async ({
      bytes,
      dismissed,
      seeds,
      approvals,
      approvalsKey,
      directoryName,
      builtIns,
      builtInsKey,
    }) => {
      if (dismissed) {
        const progress = {
          dismissedAt: 1,
          completedAt: null,
          lastSection: null,
          lastStep: null,
          skippedAt: null,
          sections: {},
        };
        localStorage.setItem(
          "maibuk-tutorial",
          JSON.stringify({ state: { progress }, version: 1 })
        );
      }
      if (seeds.length > 0) {
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle(directoryName, { create: true });
        for (const seed of seeds) {
          const folder = await directory.getDirectoryHandle(seed.name, { create: true });
          for (const file of seed.files) {
            const parts = file.path.split("/");
            let current = folder;
            for (const part of parts.slice(0, -1)) {
              current = await current.getDirectoryHandle(part, { create: true });
            }
            const handle = await current.getFileHandle(parts[parts.length - 1], { create: true });
            const writable = await handle.createWritable();
            await writable.write(Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0)));
            await writable.close();
          }
        }
        localStorage.setItem(approvalsKey, approvals);
      }
      if (builtIns.length > 0) {
        localStorage.setItem(builtInsKey, JSON.stringify({ version: 1, plugins: builtIns }));
      }
      if (bytes === null) return;
      const data = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("maibuk-db-storage", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("database");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("database", "readwrite");
          tx.objectStore("database").put(data, "main");
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    {
      bytes,
      dismissed: tutorial === "dismissed",
      seeds,
      approvals: serialized,
      approvalsKey: PLUGIN_APPROVALS_STORAGE_KEY,
      directoryName: WEB_PLUGIN_DIRECTORY_NAME,
      builtIns,
      builtInsKey: E2E_BUILTIN_PLUGINS_STORAGE_KEY,
    }
  );
  await page.unroute(`**${BLANK_PATH}`);
}

/**
 * Seeds persisted Settings (localStorage `maibuk-settings`) before the app
 * boots, e.g. a toolbar already expanded so a spec need not navigate there.
 * By default it re-applies on every load; `once` seeds only the first load of
 * the tab, so a setting the author then changes survives a reload.
 */
export async function seedSettings(
  page: Page,
  state: Record<string, unknown>,
  { once = false }: { once?: boolean } = {}
): Promise<void> {
  await page.addInitScript(
    ({ partial, once }) => {
      const marker = "e2e-settings-seeded";
      if (once && sessionStorage.getItem(marker)) return;
      const key = "maibuk-settings";
      const raw = localStorage.getItem(key);
      const parsed = raw
        ? (JSON.parse(raw) as { state: Record<string, unknown>; version: number })
        : { state: {}, version: 0 };
      parsed.state = { ...parsed.state, ...partial };
      localStorage.setItem(key, JSON.stringify(parsed));
      if (once) sessionStorage.setItem(marker, "1");
    },
    { partial: state, once }
  );
}

/** Persists a Paste Cleanup preset so paste rows do not have to walk Settings. */
export async function seedPasteCleanupPreset(
  page: Page,
  preset: Exclude<PasteCleanupPreset, "custom">
): Promise<void> {
  await seedSettings(page, {
    pasteCleanup: { preset, options: { ...PASTE_CLEANUP_PRESETS[preset] }, rules: [] },
  });
}

/** Reads one localStorage value, e.g. a device-local store a run must not touch. */
export async function readStorageValue(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

/**
 * How many web Backups a trigger made (`pre-sync`, `daily`...), read from the
 * filenames the adapter keys them by. The Sync lane counts `pre-sync` ones,
 * which a launch "Daily" Backup landing mid-test cannot disturb.
 */
export async function countBackupsByTrigger(page: Page, trigger: string): Promise<number> {
  return page.evaluate(
    (prefix) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("maibuk-backups");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("backups")) {
            db.close();
            resolve(0);
            return;
          }
          const keys = db.transaction("backups", "readonly").objectStore("backups").getAllKeys();
          keys.onsuccess = () => {
            db.close();
            resolve(keys.result.filter((key) => String(key).startsWith(prefix)).length);
          };
          keys.onerror = () => reject(keys.error);
        };
      }),
    `maibuk-backup-${trigger}-`
  );
}

/** How many Backups the web adapter holds; a Tutorial run must add none. */
export async function countBackups(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("maibuk-backups");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("backups")) {
            db.close();
            resolve(0);
            return;
          }
          const count = db.transaction("backups", "readonly").objectStore("backups").count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => reject(count.error);
        };
      })
  );
}

/** The raw Library bytes the web adapter persisted, for byte-identity checks. */
export async function readLibraryBytes(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    // Chunked: a spread of a multi-hundred-KB dump would overflow the stack
    // and leave the promise pending.
    const toBase64 = (value: Uint8Array): string => {
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < value.length; i += chunk) {
        binary += String.fromCharCode(...value.subarray(i, i + chunk));
      }
      return btoa(binary);
    };

    const open = indexedDB.open("maibuk-db-storage", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("database");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const store = database.transaction("database", "readonly").objectStore("database");
    const value = await new Promise<Uint8Array | undefined>((resolve, reject) => {
      const get = store.get("main");
      get.onsuccess = () => resolve(get.result as Uint8Array | undefined);
      get.onerror = () => reject(get.error);
    });
    database.close();
    return value ? toBase64(value) : null;
  });
}

/**
 * Answers the first-launch Tutorial offer ("Not now") on a page whose app has
 * already loaded once: the frame-rate lane's desktop WebKitGTK app, where
 * WebDriver has no init scripts. The value takes effect on the next load, so
 * reload before measuring.
 */
export async function dismissTutorialOnLoadedPage(
  page: Pick<FramePage, "evaluate">
): Promise<void> {
  await page.evaluate(() => {
    const progress = {
      dismissedAt: 1,
      completedAt: null,
      lastSection: null,
      lastStep: null,
      skippedAt: null,
      sections: {},
    };
    localStorage.setItem("maibuk-tutorial", JSON.stringify({ state: { progress }, version: 1 }));
  });
}

/**
 * Resets the device-local state of an app that is already running (the
 * frame-rate lane's Android WebView, where no blank page can be served before
 * the app boots) to a fresh device whose Tutorial offer was answered, then
 * loads the app root. WebView localStorage outlives app restarts, so without
 * this the last scenario's path and settings would carry over. A reload would
 * not do: it keeps the restored path in the URL, which the app records again.
 * The reset runs as an init script, before any app code: clearing from the
 * running page races the app's persisted stores, which write their state
 * straight back. A sessionStorage flag keeps it to the first load of this
 * launch.
 */
export async function resetDeviceAndOpen(page: Page, rootUrl: string): Promise<void> {
  await page.addInitScript(() => {
    const marker = "frames-device-reset";
    if (sessionStorage.getItem(marker)) return;
    sessionStorage.setItem(marker, "1");
    localStorage.clear();
    const progress = {
      dismissedAt: 1,
      completedAt: null,
      lastSection: null,
      lastStep: null,
      skippedAt: null,
      sections: {},
    };
    localStorage.setItem("maibuk-tutorial", JSON.stringify({ state: { progress }, version: 1 }));
  });
  await page.goto(rootUrl);
}

/**
 * Seeds `count` rows into the web Backup adapter's IndexedDB store
 * (`maibuk-backups`), in the shape `WebBackupAdapter` writes, so the Backup
 * list renders a full page through the real `listBackupsPage` path. Call it
 * before the app boots (the fixture leaves the page on the blank page); the
 * list path itself only reads, so checksum bytes can stay dummy.
 */
export async function seedWebBackups(page: Page, count: number): Promise<void> {
  await page.evaluate(async (n) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("maibuk-backups", 2);
      open.onupgradeneeded = () => {
        const target = open.result;
        if (!target.objectStoreNames.contains("backups")) {
          const store = target.createObjectStore("backups", { keyPath: "filename" });
          store.createIndex("createdAt", "createdAt");
          return;
        }
        const store = open.transaction?.objectStore("backups");
        if (store && !store.indexNames.contains("createdAt")) {
          store.createIndex("createdAt", "createdAt");
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction("backups", "readwrite");
    const store = tx.objectStore("backups");
    for (let i = 0; i < n; i++) {
      const createdAt = new Date(Date.UTC(2026, 0, i + 1, 12, 0, i)).toISOString();
      store.put({
        filename: `maibuk-backup-manual-${createdAt}-${i}.sql`,
        sql: new Uint8Array([i & 0xff, 1, 2, 3]),
        trigger: "manual",
        createdAt,
        sizeBytes: 4,
        checksum: `seed-${i}`,
      });
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, count);
}
