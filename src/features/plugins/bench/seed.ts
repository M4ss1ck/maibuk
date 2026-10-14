/**
 * The Plugins bench driver's seed loader (issue #448, unit 4b).
 *
 * `main.tsx` calls `preparePluginsBench()` before it installs the Plugin
 * lifecycle, only in a build made with `VITE_PLUGIN_BENCH_DRIVER=1`. It reads
 * the seed file the runner wrote into the app data dir, writes the approval
 * records it carries into the device (the same `savePluginApproval` the install
 * flow uses), and keeps the seed for the driver. Reading before the lifecycle
 * install is what lets the seeded Plugins be approved when the launch scan runs.
 *
 * A missing or malformed seed is not fatal: the driver then does nothing, so a
 * mis-launched app is a normal app, never a crashed one.
 */

import { BaseDirectory, readTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

import { savePluginApproval } from "@/features/plugins/approvals";
import { diag } from "@/features/plugins/bench/diag";
import { BENCH_SEED_FILE } from "@/features/plugins/bench/protocol";
import { type PluginsBenchSeed, isPluginsBenchSeed } from "@/features/plugins/bench/types";
import { useTutorialStore } from "@/features/tutorial/store";

let currentSeed: PluginsBenchSeed | null = null;

/** The seed this launch runs, or null when none was written. */
export function getPluginsBenchSeed(): PluginsBenchSeed | null {
  return currentSeed;
}

async function readVia(run: () => Promise<string>): Promise<{ text: string | null; error: string | null }> {
  try {
    return { text: await run(), error: null };
  } catch (error) {
    return { text: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The seed file's parsed contents, or null when it is missing or malformed. */
export async function readBenchSeed(): Promise<PluginsBenchSeed | null> {
  const attempts: { where: string; run: () => Promise<string> }[] = [];
  attempts.push({
    where: "appData absolute",
    run: async () => readTextFile(await join(await appDataDir(), BENCH_SEED_FILE)),
  });
  attempts.push({
    where: "appData baseDir",
    run: () => readTextFile(BENCH_SEED_FILE, { baseDir: BaseDirectory.AppData }),
  });
  attempts.push({
    where: "appConfig baseDir",
    run: () => readTextFile(BENCH_SEED_FILE, { baseDir: BaseDirectory.AppConfig }),
  });
  for (const attempt of attempts) {
    const { text, error } = await readVia(attempt.run);
    await diag(`readBenchSeed[${attempt.where}]: ${error === null ? `ok ${text?.length ?? 0}b` : error}`);
    if (text === null) continue;
    const parsed: unknown = JSON.parse(text);
    if (isPluginsBenchSeed(parsed)) return parsed;
    await diag(`readBenchSeed[${attempt.where}]: malformed`);
  }
  return null;
}

/**
 * Reads the seed and writes its approvals, so the lifecycle's launch scan sees
 * the seeded Plugins as enabled and approved.
 */
export async function preparePluginsBench(): Promise<void> {
  await diag("prepare: enter");
  const seed = await readBenchSeed();
  currentSeed = seed;
  if (seed === null) return;
  // The first-launch Tutorial offer is a modal, and a modal hides the Shortcut
  // listeners the command measurement needs. Mark the offer dismissed before
  // the offer decides, so a fresh bench device never shows it.
  useTutorialStore.getState().dismiss();
  for (const approval of seed.approvals) savePluginApproval(approval);
  await diag(`prepare: done approvals=${seed.approvals.length}`);
}
