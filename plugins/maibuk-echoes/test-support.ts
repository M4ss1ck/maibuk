/**
 * Test-only helpers shared by the Echoes suites (`plugin.test.tsx`,
 * `report-page.test.tsx`). It drives the host through the same kit the tests
 * use, so it is never imported by the runtime: the Built-in build bundles only
 * the entry and its import graph, and the import-boundary test skips this file
 * the way it skips a `.test` file.
 *
 * Keyboard focus is reached with `user-event` key presses, never a pointer, and
 * the manifest is the `manifest.json` the build ships, parsed the way the host
 * validates it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type userEvent from "@testing-library/user-event";
import type { PluginManifest } from "@/features/plugins/types";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";

/** A `user-event` instance, as `userEvent.setup()` returns it. */
export type User = ReturnType<typeof userEvent.setup>;

/** Tabs forward until `element` has focus, so every action is reached by keyboard. */
export async function tabTo(user: User, element: HTMLElement, max = 40): Promise<void> {
  for (let i = 0; i < max && document.activeElement !== element; i++) await user.tab();
}

/** Tabs backward until `element` has focus. */
export async function shiftTabTo(user: User, element: HTMLElement, max = 5): Promise<void> {
  for (let i = 0; i < max && document.activeElement !== element; i++) {
    await user.tab({ shift: true });
  }
}

/** The Echoes manifest the build ships, parsed with the host's Built-in rules. */
export function echoesManifest(): PluginManifest {
  const result = parsePluginManifest(readFileSync(join(__dirname, "manifest.json"), "utf8"), {
    builtIn: true,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

/** A fresh in-memory storage with no Echoes settings written yet. */
export function settingsStorage(): Map<string, unknown> {
  return new Map();
}
