// Setup-only storage helpers. With fault.ts, the only code in the suite
// allowed to touch IndexedDB or localStorage (keyboard contract, AC5).
// They prepare the device before the app boots; they never stand in for the
// behavior a spec is testing.

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { WEB_PLUGIN_DIRECTORY_NAME } from "@/lib/platform/web/plugins";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  serializePluginApprovals,
} from "@/features/plugins/approvals";
import { PASTE_CLEANUP_PRESETS, type PasteCleanupPreset } from "@/features/settings/types";
import { readFolderFiles } from "@/test/support/plugin-fixtures";
import type { SeedName } from "./seed/libraries";
import { REPO_ROOT, SEED_DIR } from "./seed/seeds";

/** `empty` is a fresh device: no Library in IndexedDB at all. */
export type LibrarySeed = SeedName | "empty";

/** `dismissed`: the first-launch Tutorial offer was already answered "Not now". */
export type TutorialProgressSeed = "dismissed" | "clean";

/** A fixture Plugin the seed writes into the web Plugin Directory (OPFS). */
export type PluginSeed = "tracer";

const PLUGIN_FIXTURES_DIR = resolve(REPO_ROOT, "e2e/fixtures/plugins");

const BLANK_PATH = "/__e2e__/blank";

interface PluginSeedData {
  name: PluginSeed;
  files: { path: string; base64: string }[];
  /** The fixture's committed pin; the app must compute the same h1: from OPFS. */
  pinnedHash: string;
}

function readPluginSeed(name: PluginSeed): PluginSeedData {
  const dir = resolve(PLUGIN_FIXTURES_DIR, name);
  const expected = JSON.parse(
    readFileSync(resolve(PLUGIN_FIXTURES_DIR, `${name}.expected.json`), "utf8")
  ) as { hash: string };
  const files = readFolderFiles(dir).map((file) => ({
    path: file.path,
    base64: Buffer.from(file.bytes).toString("base64"),
  }));
  return { name, files, pinnedHash: expected.hash };
}

/**
 * Writes the seed into the web adapter's IndexedDB store, the Tutorial
 * progress into localStorage, and any fixture Plugins into the web Plugin
 * Directory (OPFS) with the approval record the runtime reads, from a blank
 * same-origin page, before any app code runs. The page is left on the blank
 * page; the spec navigates.
 */
export async function prepareDevice(
  page: Page,
  {
    library,
    tutorial,
    plugins = [],
  }: { library: LibrarySeed; tutorial: TutorialProgressSeed; plugins?: PluginSeed[] }
): Promise<void> {
  const bytes =
    library === "empty"
      ? null
      : (await readFile(resolve(SEED_DIR, `${library}.sqlite`))).toString("base64");
  const seeds = plugins.map(readPluginSeed);
  const approvals = serializePluginApprovals(
    seeds.map((seed) => ({ pluginId: seed.name, pinnedHash: seed.pinnedHash, granted: [] }))
  );

  await page.route(`**${BLANK_PATH}`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>e2e</title>" })
  );
  await page.goto(BLANK_PATH);
  await page.evaluate(
    async ({ bytes, dismissed, seeds, approvals, approvalsKey, directoryName }) => {
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
      approvals,
      approvalsKey: PLUGIN_APPROVALS_STORAGE_KEY,
      directoryName: WEB_PLUGIN_DIRECTORY_NAME,
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
