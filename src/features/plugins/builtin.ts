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
 */

import type { BuiltInPlugin, BuiltInPluginSource } from "@/features/plugins/types";

/**
 * The production Built-in source: no Built-in Plugin ships yet. The array is
 * empty, so a refresh has nothing to pre-grant and the Plugin Directory is
 * read exactly as before.
 */
export function createBuiltInPluginSource(): BuiltInPluginSource {
  return {
    async list(): Promise<BuiltInPlugin[]> {
      return [];
    },
  };
}
