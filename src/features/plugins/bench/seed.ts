/**
 * The Plugins bench driver's seed loader (issue #448, unit 4b).
 *
 * `main.tsx` calls `preparePluginsBench()` before it installs the Plugin
 * lifecycle, only in a build made with `VITE_PLUGIN_BENCH_DRIVER=1`. It reads
 * the seed file the runner wrote into the app config dir, writes the approval
 * records it carries into the device (the same `savePluginApproval` the install
 * flow uses), and keeps the seed for the driver. Reading before the lifecycle
 * install is what lets the seeded Plugins be approved when the launch scan runs.
 *
 * The seed lives in the app **config** dir, not the app data dir: the product's
 * `fs:default` only grants `read-text-file` inside a scope this bench build does
 * not extend, while `fs:allow-appconfig-write-recursive` already grants the
 * config dir (a bench launch writes no Library there of its own). The read goes
 * through the platform layer (`FileSystemAdapter.readAppConfigTextFile`), never
 * a Tauri API here. A missing or malformed seed is not fatal: the driver then
 * does nothing, so a mis-launched app is a normal app, never a crashed one.
 */

import { savePluginApproval } from "@/features/plugins/approvals";
import { BENCH_SEED_FILE } from "@/features/plugins/bench/protocol";
import { type PluginsBenchSeed, isPluginsBenchSeed } from "@/features/plugins/bench/types";
import { useTutorialStore } from "@/features/tutorial/store";
import { getFileSystem } from "@/lib/platform";

let currentSeed: PluginsBenchSeed | null = null;

/** The seed this launch runs, or null when none was written. */
export function getPluginsBenchSeed(): PluginsBenchSeed | null {
  return currentSeed;
}

async function readVia(
  run: () => Promise<string | null>
): Promise<{ text: string | null; error: string | null }> {
  try {
    return { text: await run(), error: null };
  } catch (error) {
    return { text: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The seed file's parsed contents, or null when it is missing or malformed. The
 * adapter tries the app config dir first (the one the scope permits) and the app
 * data dir second, so a harmless fallback location needs no work here.
 */
export async function readBenchSeed(): Promise<PluginsBenchSeed | null> {
  const fileSystem = await getFileSystem();
  const { text, error } = await readVia(() => fileSystem.readAppConfigTextFile(BENCH_SEED_FILE));
  if (text === null) {
    console.warn("[plugins-bench] no seed file", error);
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isPluginsBenchSeed(parsed) ? parsed : null;
  } catch {
    // A malformed seed reads as no seed: the driver then does nothing.
    return null;
  }
}

/**
 * Reads the seed and writes its approvals, so the lifecycle's launch scan sees
 * the seeded Plugins as enabled and approved.
 */
export async function preparePluginsBench(): Promise<void> {
  const seed = await readBenchSeed();
  currentSeed = seed;
  if (seed === null) return;
  // The first-launch Tutorial offer is a modal, and a modal hides the Shortcut
  // listeners the command measurement needs. Mark the offer dismissed before
  // the offer decides, so a fresh bench device never shows it.
  useTutorialStore.getState().dismiss();
  for (const approval of seed.approvals) savePluginApproval(approval);
}
