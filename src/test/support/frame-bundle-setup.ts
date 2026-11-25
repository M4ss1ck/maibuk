/**
 * Builds every Built-in Plugin's Frame entry into the source tree before any
 * test runs. A Plugin's Frame tests read the built script from the manifest's
 * `frameEntry.bundle` path and evaluate it, so that path holds a build
 * artifact; this setup runs the same bundling the Plugin build runs, from
 * `plugins/builtins.json` and each manifest, so a test always sees the script
 * the app ships.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildPluginFrameEntry } from "../../../scripts/build-plugin";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const PLUGINS_DIR = join(REPO_ROOT, "plugins");

/** The Plugin ids Built-ins ship, in build order. */
function builtinIds(): string[] {
  const path = join(PLUGINS_DIR, "builtins.json");
  if (!existsSync(path)) return [];
  const builtins = JSON.parse(readFileSync(path, "utf8")) as { plugins?: unknown };
  if (!Array.isArray(builtins.plugins)) return [];
  return builtins.plugins.filter((id): id is string => typeof id === "string");
}

/** Whether a manifest declares a Frame entry, without trusting its shape. */
function declaresFrameEntry(manifestPath: string): boolean {
  if (!existsSync(manifestPath)) return false;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { frameEntry?: unknown };
  return manifest.frameEntry !== undefined;
}

export default async function setup(): Promise<void> {
  for (const id of builtinIds()) {
    const sourceDir = join(PLUGINS_DIR, id);
    const manifestPath = join(sourceDir, "manifest.json");
    // A partial checkout or a Plugin without a Frame skips cleanly.
    if (!declaresFrameEntry(manifestPath)) continue;
    await buildPluginFrameEntry({ sourceDir, manifestPath });
  }
}
