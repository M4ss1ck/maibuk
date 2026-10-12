// Builds the E2E lane's source-built fixture Plugins into e2e/.output/plugins/
// at global setup. Each Plugin is one self-contained ESM bundle plus its
// manifest, so the seed hashes the folder exactly as the app reads it from
// OPFS. The output is derived from the committed sources under
// e2e/fixtures/plugin-sources/ and is never committed: e2e/.output/ is ignored.

import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

export const REPO_ROOT = resolve(import.meta.dirname, "../..");
export const PLUGIN_SOURCES_DIR = resolve(REPO_ROOT, "e2e/fixtures/plugin-sources");
export const PLUGIN_BUILD_DIR = resolve(REPO_ROOT, "e2e/.output/plugins");

/** The source-built fixture Plugins, by folder name in the Plugin Directory. */
const FIXTURE_PLUGINS = ["remote-ui"] as const;

/** Builds every source-built fixture Plugin the seed can read from `.output`. */
export async function buildPluginFixtures(): Promise<void> {
  await mkdir(PLUGIN_BUILD_DIR, { recursive: true });
  await Promise.all(FIXTURE_PLUGINS.map(buildPlugin));
}

async function buildPlugin(name: string): Promise<void> {
  const sourceDir = resolve(PLUGIN_SOURCES_DIR, name);
  const outDir = resolve(PLUGIN_BUILD_DIR, name);
  await build({
    configFile: false,
    logLevel: "warn",
    // No `public/` copy: the folder must hold only the bundle and its manifest,
    // or the app would hash assets the Plugin never declares.
    publicDir: false,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: { alias: [{ find: "@", replacement: resolve(REPO_ROOT, "src") }] },
    // A Plugin bundle is React/JSX, but the app's React plugin is not loaded
    // here; esbuild's automatic runtime resolves `react/jsx-runtime` instead.
    esbuild: { jsx: "automatic" },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      // One self-contained ESM file: the host module loader refuses a bare
      // import, so nothing may stay external and nothing may be code-split.
      lib: {
        entry: resolve(sourceDir, "index.tsx"),
        formats: ["es"],
        fileName: "index",
      },
      rollupOptions: {
        external: [],
        output: { inlineDynamicImports: true },
      },
    },
  });
  await cp(resolve(sourceDir, "manifest.json"), resolve(outDir, "manifest.json"));
}
