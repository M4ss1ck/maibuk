// Builds the E2E lane's source-built fixture Plugins into e2e/.output/plugins/
// at global setup. Each fixture is built by the real Built-in build
// (`scripts/build-plugin.ts` `buildPlugin`, re-exported by
// `scripts/build-builtin-plugins.ts`), so a fixture takes the same path a
// shipped Built-in does: one self-contained ESM bundle, the manifest, and the
// copied `assets/` and `locales/`, hashed exactly as the app reads the folder
// from OPFS. The output is derived from the committed sources under
// e2e/fixtures/plugin-sources/ and is never committed: e2e/.output/ is ignored.
//
// The import is the JSON-free `build-plugin.ts`, not `build-builtin-plugins.ts`:
// Playwright's ESM loader (which runs this global setup) refuses the bare JSON
// imports that file's manifest validation pulls in. `fixture-everything` builds
// twice from one source: `manifest.json` is the persistent lifecycle and
// `manifest.on-demand.json` the on-demand one, each into its own folder. Fixture
// Plugins are never added to `plugins/builtins.json` and never land in a product
// bundle.

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildPlugin } from "../../scripts/build-plugin";

export const REPO_ROOT = resolve(import.meta.dirname, "../..");
export const PLUGIN_SOURCES_DIR = resolve(REPO_ROOT, "e2e/fixtures/plugin-sources");
export const PLUGIN_BUILD_DIR = resolve(REPO_ROOT, "e2e/.output/plugins");

/** One source-built fixture: where it reads from and the folder the seed reads. */
interface FixturePlugin {
  /** The source folder under `plugin-sources/`. */
  source: string;
  /** The manifest file inside that source folder. */
  manifest: string;
  /** The folder name under `.output/plugins` the seed reads from. */
  output: string;
}

/** The source-built fixture Plugins, by folder name in the Plugin Directory. */
const FIXTURE_PLUGINS: readonly FixturePlugin[] = [
  { source: "remote-ui", manifest: "manifest.json", output: "remote-ui" },
  { source: "fixture-everything", manifest: "manifest.json", output: "fixture-everything" },
  {
    source: "fixture-everything",
    manifest: "manifest.on-demand.json",
    output: "fixture-everything-on-demand",
  },
];

/** Builds every source-built fixture Plugin the seed can read from `.output`. */
export async function buildPluginFixtures(): Promise<void> {
  await mkdir(PLUGIN_BUILD_DIR, { recursive: true });
  await Promise.all(FIXTURE_PLUGINS.map(buildFixturePlugin));
}

function buildFixturePlugin(fixture: FixturePlugin): Promise<void> {
  const sourceDir = resolve(PLUGIN_SOURCES_DIR, fixture.source);
  return buildPlugin({
    sourceDir,
    manifestPath: resolve(sourceDir, fixture.manifest),
    outDir: resolve(PLUGIN_BUILD_DIR, fixture.output),
    // The fixtures keep the bundle readable, as the lane always has.
    minify: false,
  }).then(() => undefined);
}
