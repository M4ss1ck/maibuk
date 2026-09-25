// Setup-only storage helpers. With fault.ts, the only code in the suite
// allowed to touch IndexedDB or localStorage (keyboard contract, AC5).
// They prepare the device before the app boots; they never stand in for the
// behavior a spec is testing.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { PASTE_CLEANUP_PRESETS, type PasteCleanupPreset } from "@/features/settings/types";
import type { SeedName } from "./seed/libraries";
import { SEED_DIR } from "./seed/seeds";

/** `empty` is a fresh device: no Library in IndexedDB at all. */
export type LibrarySeed = SeedName | "empty";

/** `dismissed`: the first-launch Tutorial offer was already answered "Not now". */
export type TutorialProgressSeed = "dismissed" | "clean";

const BLANK_PATH = "/__e2e__/blank";

/**
 * Writes the seed into the web adapter's IndexedDB store and the Tutorial
 * progress into localStorage from a blank same-origin page, before any app
 * code runs. The page is left on the blank page; the spec navigates.
 */
export async function prepareDevice(
  page: Page,
  { library, tutorial }: { library: LibrarySeed; tutorial: TutorialProgressSeed }
): Promise<void> {
  const bytes =
    library === "empty"
      ? null
      : (await readFile(resolve(SEED_DIR, `${library}.sqlite`))).toString("base64");

  await page.route(`**${BLANK_PATH}`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>e2e</title>" })
  );
  await page.goto(BLANK_PATH);
  await page.evaluate(
    async ({ bytes, dismissed }) => {
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
    { bytes, dismissed: tutorial === "dismissed" }
  );
  await page.unroute(`**${BLANK_PATH}`);
}

/**
 * Seeds persisted Settings (localStorage `maibuk-settings`) before the app
 * boots, e.g. a toolbar already expanded so a spec need not navigate there.
 */
export async function seedSettings(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.addInitScript((partial) => {
    const key = "maibuk-settings";
    const raw = localStorage.getItem(key);
    const parsed = raw
      ? (JSON.parse(raw) as { state: Record<string, unknown>; version: number })
      : { state: {}, version: 0 };
    parsed.state = { ...parsed.state, ...partial };
    localStorage.setItem(key, JSON.stringify(parsed));
  }, state);
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

/** The raw Library bytes the web adapter persisted, for byte-identity checks. */
export async function readLibraryBytes(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open("maibuk-db-storage", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("database");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result
            .transaction("database", "readonly")
            .objectStore("database")
            .get("main");
          get.onsuccess = () => {
            open.result.close();
            const value = get.result as Uint8Array | undefined;
            resolve(value ? btoa(String.fromCharCode(...value)) : null);
          };
          get.onerror = () => reject(get.error);
        };
      })
  );
}
