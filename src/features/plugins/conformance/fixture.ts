/**
 * How the conformance route obtains the fixture-hostile Plugin's bytes (#447,
 * D3).
 *
 * Decision: the built fixture is **embedded into the conformance chunk at build
 * time** via `import.meta.glob`, not served by the collector. The glob above
 * this module is the whole mechanism: Vite inlines `e2e/.output/plugins/
 * fixture-hostile/**` as raw strings only when the conformance module is part
 * of the build, and the conformance module is only part of the build when
 * `VITE_PLUGIN_CONFORMANCE=1` (App.tsx imports it lazily under that flag). A
 * normal production build never imports this module, so the glob never runs and
 * not one fixture byte reaches `dist/`. The collector alternative would have
 * invented a fixture-serving endpoint in the lane's Node server and made the
 * route depend on it; embedding keeps the whole test-only path inside the
 * test-only chunk and off the production build entirely.
 *
 * The `conformance:plugins` lane must build the fixture (`e2e/support/
 * plugin-fixtures-build.ts`) before `VITE_PLUGIN_CONFORMANCE=1 pnpm build ...`,
 * exactly as the E2E global setup does. If the folder is absent the glob
 * matches nothing, the build still succeeds, and `loadFixtureHostile` throws so
 * every check is reported `unmeasured` rather than the build failing.
 */

import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import type { PluginFolder, PluginFolderFile } from "@/features/plugins/types";

/** The fixture Plugin's id, which is also its folder name in the build output. */
export const FIXTURE_HOSTILE_ID = "fixture-hostile";

/** The built fixture's files, inlined as raw text at build time (see above). */
const RAW_FIXTURE_FILES = import.meta.glob("../../../../e2e/.output/plugins/fixture-hostile/**/*", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** The Plugin-folder path from one glob key (`.../fixture-hostile/index.js`). */
function pluginPath(globKey: string): string {
  const marker = `/plugins/${FIXTURE_HOSTILE_ID}/`;
  const normalized = globKey.replace(/\\/g, "/");
  const at = normalized.lastIndexOf(marker);
  if (at === -1) throw new Error(`Unexpected fixture path: ${globKey}`);
  return normalized.slice(at + marker.length);
}

/** The fixture-hostile folder's files as the runtime reads a Plugin folder. */
export function loadFixtureHostileFiles(): PluginFolderFile[] {
  const encoder = new TextEncoder();
  return Object.entries(RAW_FIXTURE_FILES).map(([key, source]) => ({
    path: pluginPath(key),
    bytes: encoder.encode(source),
  }));
}

/**
 * The folder and pinned hash to start the fixture with. The hash is computed
 * over the very bytes fed to the runtime, so it always matches; the route does
 * not compare against the on-disk build's hash.
 */
export async function loadFixtureHostile(): Promise<{
  folder: PluginFolder;
  pinnedHash: string;
}> {
  const files = loadFixtureHostileFiles();
  if (files.length === 0) {
    throw new Error(
      `The ${FIXTURE_HOSTILE_ID} fixture is not built; build e2e fixtures before the conformance build`
    );
  }
  return {
    folder: { name: FIXTURE_HOSTILE_ID, files },
    pinnedHash: await hashPluginDirectory(files),
  };
}
