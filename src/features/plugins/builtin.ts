/**
 * The Built-in Plugins the app ships (#442, plan decision 5). A Built-in takes
 * the same path as any other Plugin (ADR 0019): the same loader, sandbox,
 * manifest, Plugin Permissions, and public API. The only difference is that it
 * ships pre-granted, and those grants are still listed and revocable.
 *
 * The store reads this source on every refresh to pre-grant an untouched
 * Built-in, to spot a modified copy, and to offer a shipped update. No
 * Built-in ships yet, so the production source lists none and the app runs
 * with zero Built-ins; a test injects its own source to exercise the paths.
 *
 * The E2E lane needs a Built-in to prove the Keep my copy / Update available
 * rows, and it drives the production web build, so it seeds this one seam: a
 * device-local list the seed writes before the app boots. The seam exists only
 * in the E2E lane's build: `VITE_E2E_BUILTIN_SEED` is set by e2e/run-steps.mjs
 * alone, so every shipped build compiles the read away and no localStorage a
 * user or page writes can mark a folder Built-in (and so pre-granted). It also
 * carries no shipped bytes (`files: []`), so it can never write Plugin code
 * into a real install. A folder must already sit in the Plugin Directory for
 * the seam to have any effect at all.
 */

import type { BuiltInPlugin, BuiltInPluginSource, PluginManifest } from "@/features/plugins/types";

/**
 * The localStorage key the E2E seed writes the Built-in list under. Exported so
 * `e2e/support/storage.ts` writes exactly what this reads; no shipped path
 * writes it.
 */
export const E2E_BUILTIN_PLUGINS_STORAGE_KEY = "maibuk-e2e-built-in-plugins";

/** One Built-in the E2E seed injects: identity, manifest, and shipped hash. */
interface E2EBuiltInSeed {
  id: string;
  manifest: PluginManifest;
  hash: string;
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

/**
 * The E2E seed's Built-in list, or none. Only the E2E lane's build defines
 * `VITE_E2E_BUILTIN_SEED`, so a shipped build always lists none regardless of
 * any localStorage a user could write.
 */
function readE2EBuiltIns(): BuiltInPlugin[] {
  if (import.meta.env.VITE_E2E_BUILTIN_SEED !== "1") return [];
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(E2E_BUILTIN_PLUGINS_STORAGE_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as { plugins?: unknown };
    if (!Array.isArray(parsed.plugins)) return [];
    return parsed.plugins.flatMap((entry) =>
      isSeed(entry) ? [{ id: entry.id, manifest: entry.manifest, hash: entry.hash, files: [] }] : []
    );
  } catch {
    return [];
  }
}

/**
 * The production Built-in source: no Built-in Plugin ships yet. The array is
 * empty, so a refresh has nothing to pre-grant and the Plugin Directory is
 * read exactly as before. The E2E lane's seed is the only thing that ever makes
 * this list non-empty (see the module comment).
 */
export function createBuiltInPluginSource(): BuiltInPluginSource {
  return {
    async list(): Promise<BuiltInPlugin[]> {
      return readE2EBuiltIns();
    },
  };
}
