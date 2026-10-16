/**
 * How the conformance route obtains the fixture Plugins' bytes (#447, D3; #516).
 *
 * Decision: each built fixture is **embedded into the conformance chunk at build
 * time** via `import.meta.glob`, not served by the collector. The globs below
 * this module are the whole mechanism: Vite inlines `e2e/.output/plugins/
 * fixture-hostile/**` and `fixture-healthy/**` as raw strings only when the
 * conformance module is part of the build, and the conformance module is only
 * part of the build when `VITE_PLUGIN_CONFORMANCE=1` (App.tsx imports it lazily
 * under that flag). A normal production build never imports this module, so the
 * globs never run and not one fixture byte reaches `dist/`. The collector
 * alternative would have invented a fixture-serving endpoint in the lane's Node
 * server and made the route depend on it; embedding keeps the whole test-only
 * path inside the test-only chunk and off the production build entirely.
 *
 * The `conformance:plugins` lane must build the fixtures (`e2e/support/
 * plugin-fixtures-build.ts`) before `VITE_PLUGIN_CONFORMANCE=1 pnpm build ...`,
 * exactly as the E2E global setup does. If a folder is absent its glob matches
 * nothing, the build still succeeds, and `loadFixture` throws so every check is
 * reported `unmeasured` rather than the build failing.
 */

import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import type { PluginFolder, PluginFolderFile } from "@/features/plugins/types";

/** The hostile fixture Plugin's id, which is also its folder name in the build output. */
export const FIXTURE_HOSTILE_ID = "fixture-hostile";

/** The healthy neighbour fixture Plugin's id (#516); it keeps answering beside the hostile one. */
export const FIXTURE_HEALTHY_ID = "fixture-healthy";

/** The built hostile fixture's files, inlined as raw text at build time (see above). */
const RAW_HOSTILE_FILES = import.meta.glob("../../../../e2e/.output/plugins/fixture-hostile/**/*", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** The built healthy fixture's files, inlined as raw text at build time (see above). */
const RAW_HEALTHY_FILES = import.meta.glob("../../../../e2e/.output/plugins/fixture-healthy/**/*", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** The glob holding one fixture id's raw files. */
function fixtureGlob(pluginId: string): Record<string, string> {
  return pluginId === FIXTURE_HEALTHY_ID ? RAW_HEALTHY_FILES : RAW_HOSTILE_FILES;
}

/** A fixture folder's files as the runtime reads a Plugin folder. */
function toPluginFiles(glob: Record<string, string>, pluginId: string): PluginFolderFile[] {
  const marker = `/plugins/${pluginId}/`;
  const encoder = new TextEncoder();
  return Object.entries(glob).map(([key, source]) => {
    const normalized = key.replace(/\\/g, "/");
    const at = normalized.lastIndexOf(marker);
    if (at === -1) throw new Error(`Unexpected fixture path: ${key}`);
    return { path: normalized.slice(at + marker.length), bytes: encoder.encode(source) };
  });
}

/** One fixture folder's files, as the runtime reads a Plugin folder. */
export function loadFixtureFiles(pluginId: string): PluginFolderFile[] {
  return toPluginFiles(fixtureGlob(pluginId), pluginId);
}

/**
 * The folder and pinned hash to start one fixture with. The hash is computed
 * over the very bytes fed to the runtime, so it always matches; the route does
 * not compare against the on-disk build's hash.
 */
export async function loadFixture(
  pluginId: string
): Promise<{ folder: PluginFolder; pinnedHash: string }> {
  const files = loadFixtureFiles(pluginId);
  if (files.length === 0) {
    throw new Error(
      `The ${pluginId} fixture is not built; build e2e fixtures before the conformance build`
    );
  }
  return {
    folder: { name: pluginId, files },
    pinnedHash: await hashPluginDirectory(files),
  };
}

/** The hostile fixture's folder and pinned hash. */
export function loadFixtureHostile(): Promise<{ folder: PluginFolder; pinnedHash: string }> {
  return loadFixture(FIXTURE_HOSTILE_ID);
}

/** The healthy neighbour fixture's folder and pinned hash (#516). */
export function loadFixtureHealthy(): Promise<{ folder: PluginFolder; pinnedHash: string }> {
  return loadFixture(FIXTURE_HEALTHY_ID);
}
