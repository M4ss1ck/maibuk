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
//
// `fixture-frame` (issue #454 unit U6) also ships a Frame: its `ui/` folder
// holds HTML, CSS, JS, and an image the Frame loads, which `buildPlugin` does
// not copy (it copies `assets/` and `locales/` only, the shipped-Built-in
// layout). The fixture entry lists `copyFolders: ["ui"]` and this file copies
// those folders verbatim after the bundle, then substitutes the recorder origin
// into their text files: a Frame's static files are never bundled, so a Vite
// `define` cannot reach them, and the frame's network probes must target this
// run's recorder.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildPlugin } from "../../scripts/build-plugin";

export const REPO_ROOT = resolve(import.meta.dirname, "../..");
export const PLUGIN_SOURCES_DIR = resolve(REPO_ROOT, "e2e/fixtures/plugin-sources");
export const PLUGIN_BUILD_DIR = resolve(REPO_ROOT, "e2e/.output/plugins");

/**
 * The build-time placeholder the Worker bundles and the Frame's copied files
 * carry. The Vite `define` replaces it in a bundle; `substituteOrigin` replaces
 * it in a Frame's verbatim files.
 */
const REQUEST_LOG_ORIGIN_PLACEHOLDER = "__REQUEST_LOG_ORIGIN__";

/** One source-built fixture: where it reads from and the folder the seed reads. */
interface FixturePlugin {
  /** The source folder, under `plugin-sources/` unless `repoSource` is true. */
  source: string;
  /** When true, `source` is resolved against the repo root instead of `plugin-sources/`. */
  repoSource?: boolean;
  /** The manifest file inside that source folder. */
  manifest: string;
  /** The folder name under `.output/plugins` the seed reads from. */
  output: string;
  /** Extra source folders copied verbatim beside the bundle (a Frame's `ui/`). */
  copyFolders?: readonly string[];
}

/** The source-built fixture Plugins, by folder name in the Plugin Directory. */
const FIXTURE_PLUGINS: readonly FixturePlugin[] = [
  { source: "remote-ui", manifest: "manifest.json", output: "remote-ui" },
  { source: "fixture-hostile", manifest: "manifest.json", output: "fixture-hostile" },
  { source: "fixture-healthy", manifest: "manifest.json", output: "fixture-healthy" },
  { source: "fixture-everything", manifest: "manifest.json", output: "fixture-everything" },
  {
    source: "fixture-everything",
    manifest: "manifest.on-demand.json",
    output: "fixture-everything-on-demand",
  },
  { source: "fixture-bench", manifest: "manifest.json", output: "fixture-bench" },
  { source: "fixture-endpoint", manifest: "manifest.json", output: "fixture-endpoint" },
  {
    source: "fixture-frame",
    manifest: "manifest.json",
    output: "fixture-frame",
    copyFolders: ["ui"],
  },
  {
    source: "plugins/maibuk-echoes",
    repoSource: true,
    manifest: "manifest.json",
    output: "maibuk-echoes",
  },
];

/** The folder names under `.output/plugins` the seeds read, for a build check. */
export const PLUGIN_FIXTURE_FOLDERS: readonly string[] = FIXTURE_PLUGINS.map(
  (fixture) => fixture.output
);

/** Builds every source-built fixture Plugin the seed can read from `.output`. */
export async function buildPluginFixtures(requestLog: { origin: string }): Promise<void> {
  await mkdir(PLUGIN_BUILD_DIR, { recursive: true });
  await Promise.all(FIXTURE_PLUGINS.map((fixture) => buildFixturePlugin(fixture, requestLog)));
}

async function buildFixturePlugin(
  fixture: FixturePlugin,
  requestLog: { origin: string }
): Promise<void> {
  const sourceDir = fixture.repoSource
    ? resolve(REPO_ROOT, fixture.source)
    : resolve(PLUGIN_SOURCES_DIR, fixture.source);
  const outDir = resolve(PLUGIN_BUILD_DIR, fixture.output);
  await buildPlugin({
    sourceDir,
    manifestPath: resolve(sourceDir, fixture.manifest),
    outDir,
    // The fixtures keep the bundle readable, as the lane always has.
    minify: false,
    // Only the hostile fixture's Worker reaches the network: it gets the
    // recorder's origin, which the global setup bound on a free port this run.
    define:
      fixture.source === "fixture-hostile"
        ? { [REQUEST_LOG_ORIGIN_PLACEHOLDER]: JSON.stringify(requestLog.origin) }
        : undefined,
  });
  await copyFixtureFolders(fixture, sourceDir, outDir, requestLog.origin);
}

/** Copies a fixture's extra folders beside the bundle and substitutes the origin. */
async function copyFixtureFolders(
  fixture: FixturePlugin,
  sourceDir: string,
  outDir: string,
  origin: string
): Promise<void> {
  for (const folder of fixture.copyFolders ?? []) {
    const to = resolve(outDir, folder);
    await cp(resolve(sourceDir, folder), to, { recursive: true });
    substituteOrigin(to, origin);
  }
}

/** Replaces the recorder-origin placeholder in every text file under `dir`. */
function substituteOrigin(dir: string, origin: string): void {
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    const text = readFileSync(file, "utf8");
    if (!text.includes(REQUEST_LOG_ORIGIN_PLACEHOLDER)) continue;
    writeFileSync(file, text.split(REQUEST_LOG_ORIGIN_PLACEHOLDER).join(origin));
  }
}
