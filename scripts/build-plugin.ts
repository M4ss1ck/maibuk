/**
 * The shared Vite build for one Plugin source folder: one self-contained ESM
 * file, with the manifest, `assets/`, and `locales/` copied beside it, so the
 * folder is exactly what the app installs. A Plugin that declares `frameEntry`
 * also gets a second Vite pass that bundles its TypeScript Frame entry into one
 * classic script beside the entry. The Built-in build
 * (`scripts/build-builtin-plugins.ts`) and the E2E fixture build
 * (`e2e/support/plugin-fixtures-build.ts`) both call it, so a fixture takes the
 * same path a shipped Built-in does.
 *
 * This module deliberately imports no `@/` code. The E2E global setup loads it
 * through Playwright's ESM loader, which refuses the bare JSON imports the
 * manifest validator and its dictation vocabulary pull in
 * (`lucide-icon-names.json`, `src/locales/*.json`). Validating a manifest is the
 * caller's job: the Built-in build validates before it calls `buildPlugin`, and
 * the fixture sources are validated by `src/test/unit/plugins/`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Alias, build } from "vite";

/** The repo root, from this script's own location (`scripts/`). */
const REPO_ROOT = resolve(import.meta.dirname, "..");

/** The Plugin entry source, `index.tsx` preferred over `index.ts`. */
function resolveEntry(sourceDir: string): string {
  for (const name of ["index.tsx", "index.ts"]) {
    const candidate = join(sourceDir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`no entry (index.ts or index.tsx) in ${sourceDir}`);
}

/** How to build one Plugin source folder. */
export interface BuildPluginOptions {
  /** The folder holding the entry source (`index.tsx` preferred over `index.ts`). */
  sourceDir: string;
  /** The manifest file to read and copy into the output folder as `manifest.json`. */
  manifestPath: string;
  /** Where the built folder lands; emptied first. */
  outDir: string;
  /** Minify the built entry; the Built-in build does, the E2E fixtures keep it readable. */
  minify?: boolean;
  /**
   * Extra Vite `define` constants, merged over the defaults. The E2E fixture
   * build injects the recorder origin (`__REQUEST_LOG_ORIGIN__`) this way; the
   * Built-in build passes none.
   */
  define?: Record<string, string>;
  /**
   * Extra resolve aliases, appended after the default `@` -> `<repo>/src`
   * entry. The external Plugin build (`scripts/plugin/cli.ts`, issue #455)
   * passes the SDK, test-kit, and React aliases here; the Built-in and E2E
   * fixture builds pass none and keep the default resolution.
   */
  alias?: Alias[];
}

/** The Frame entry a manifest may declare: its TypeScript source and built script. */
interface BuildPluginFrameEntry {
  /** A relative path to the .ts or .tsx source in the Plugin folder. */
  source: string;
  /** A relative path to the built classic script in the Plugin folder. */
  bundle: string;
}

/** The manifest fields `buildPlugin` reads; the caller validates the rest. */
interface BuildPluginManifest {
  id?: string;
  entry: string;
  frameEntry?: BuildPluginFrameEntry;
}

/**
 * Bundles one Frame entry as a single self-contained classic script at the
 * manifest-declared path. A Frame runs at an opaque origin, where relative ES
 * module imports cannot resolve, so the output is an IIFE with nothing external
 * and no code splitting. The entry build already filled `outDir`, so emptying
 * it would wipe the Plugin entry.
 */
async function buildFrameEntry(options: {
  id: string | undefined;
  sourceDir: string;
  outDir: string;
  frameEntry: BuildPluginFrameEntry;
  minify: boolean;
  define: Record<string, string>;
  alias: Alias[] | undefined;
}): Promise<void> {
  const { id, sourceDir, outDir, frameEntry, minify, define, alias } = options;
  const source = join(sourceDir, frameEntry.source);
  if (!existsSync(source)) {
    throw new Error(
      `${id ?? sourceDir} declares frameEntry.source ${frameEntry.source}, but that file is missing`
    );
  }
  await build({
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    define: { "process.env.NODE_ENV": JSON.stringify("production"), ...define },
    resolve: {
      alias: [{ find: "@", replacement: join(REPO_ROOT, "src") }, ...(alias ?? [])],
    },
    // A Frame entry is Preact/JSX; esbuild's automatic runtime resolves
    // `preact/jsx-runtime`. `jsxDev` is pinned off for the same reason as the
    // entry build: this Node process never sets `NODE_ENV`, so the transform
    // would otherwise emit `jsxDEV`, which Preact's production runtime ships as
    // `undefined`.
    esbuild: { jsx: "automatic", jsxImportSource: "preact", jsxDev: false },
    build: {
      outDir,
      // The entry build already wrote the folder; the bundle lands inside it.
      emptyOutDir: false,
      minify,
      lib: {
        entry: source,
        formats: ["iife"],
        // IIFE requires a global name; the Frame never reads it.
        name: "MaibukFrame",
        fileName: () => frameEntry.bundle,
      },
      rollupOptions: {
        external: [],
        output: { inlineDynamicImports: true },
      },
    },
  });
  const bundlePath = join(outDir, frameEntry.bundle);
  if (!existsSync(bundlePath)) {
    throw new Error(
      `built ${id ?? sourceDir} but ${frameEntry.bundle} is missing; the manifest frameEntry.bundle must match`
    );
  }
  // Minification drops a Rollup banner, so the file says where it came from
  // after the build: the bundle lives in the source tree during tests, and a
  // reader there must know not to edit it.
  const banner = `// Generated from ${frameEntry.source} by scripts/build-plugin.ts; do not edit.\n`;
  const bundled = readFileSync(bundlePath, "utf8");
  if (!bundled.startsWith(banner)) writeFileSync(bundlePath, banner + bundled);
}

/**
 * Builds one Plugin source into `outDir` as one self-contained ESM file, then
 * copies the manifest, `assets/`, `locales/`, and a `LICENSES` notice when the
 * Plugin carries one, beside it. The bundle is named
 * exactly what the manifest's `entry` declares, and nothing is left external or
 * code-split, so the host module loader can read it. When the manifest declares
 * `frameEntry`, its TypeScript source is bundled to the declared path as one
 * classic script for the Frame's HTML to load.
 */
export async function buildPlugin(options: BuildPluginOptions): Promise<void> {
  const { sourceDir, manifestPath, outDir, minify = true, define = {}, alias } = options;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BuildPluginManifest;
  if (typeof manifest.entry !== "string" || manifest.entry === "") {
    throw new Error(`${manifestPath} declares no entry`);
  }
  await build({
    configFile: false,
    logLevel: "warn",
    // No `public/` copy: the folder must hold only what the manifest declares,
    // or the app would hash assets the Plugin never lists.
    publicDir: false,
    define: { "process.env.NODE_ENV": JSON.stringify("production"), ...define },
    resolve: {
      alias: [{ find: "@", replacement: join(REPO_ROOT, "src") }, ...(alias ?? [])],
    },
    // A Plugin bundle is React/JSX; esbuild's automatic runtime resolves
    // `react/jsx-runtime`. `jsxDev` is pinned off: this Node entry never sets
    // `NODE_ENV`, so the transform would otherwise emit `jsxDEV`, which React's
    // production runtime ships as `undefined`.
    esbuild: { jsx: "automatic", jsxDev: false },
    build: {
      outDir,
      emptyOutDir: true,
      minify,
      // One self-contained ESM file named exactly what the manifest declares.
      lib: {
        entry: resolveEntry(sourceDir),
        formats: ["es"],
        fileName: () => manifest.entry,
      },
      rollupOptions: {
        external: [],
        output: { inlineDynamicImports: true },
      },
    },
  });
  if (!existsSync(join(outDir, manifest.entry))) {
    throw new Error(
      `built ${manifest.id ?? sourceDir} but ${manifest.entry} is missing; the manifest entry must match`
    );
  }
  await cp(manifestPath, join(outDir, "manifest.json"));
  for (const folder of ["assets", "locales"]) {
    const from = join(sourceDir, folder);
    if (existsSync(from)) await cp(from, join(outDir, folder), { recursive: true });
  }
  const frameEntry = manifest.frameEntry;
  if (frameEntry !== undefined) {
    if (
      typeof frameEntry?.source !== "string" ||
      frameEntry.source === "" ||
      typeof frameEntry.bundle !== "string" ||
      frameEntry.bundle === ""
    ) {
      throw new Error(`${manifestPath} declares an invalid frameEntry`);
    }
    await buildFrameEntry({
      id: manifest.id,
      sourceDir,
      outDir,
      frameEntry,
      minify,
      define,
      alias,
    });
  }
  // Third-party art the Plugin derives from ships its notice beside the bundle.
  const licenses = join(sourceDir, "LICENSES");
  if (existsSync(licenses)) await cp(licenses, join(outDir, "LICENSES"));
}

/** How to build one Plugin's Frame entry without building the whole Plugin. */
export interface BuildPluginFrameEntryOptions {
  /** The Plugin source folder; both manifest paths are relative to it. */
  sourceDir: string;
  /** The manifest declaring `frameEntry`. */
  manifestPath: string;
  /** Where the bundle lands; defaults to `sourceDir`, the source tree. */
  outDir?: string;
  /** Minify the bundle; defaults to true, like the Built-in build. */
  minify?: boolean;
}

/**
 * Bundles one Plugin's Frame entry on its own. The Vitest global setup calls it
 * before the Frame tests read the built script from the source tree, so they
 * run the exact artifact the Plugin build ships at the manifest's `bundle`
 * path.
 */
export async function buildPluginFrameEntry(options: BuildPluginFrameEntryOptions): Promise<void> {
  const { sourceDir, manifestPath, outDir = sourceDir, minify = true } = options;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BuildPluginManifest;
  const frameEntry = manifest.frameEntry;
  if (
    frameEntry === undefined ||
    typeof frameEntry.source !== "string" ||
    frameEntry.source === "" ||
    typeof frameEntry.bundle !== "string" ||
    frameEntry.bundle === ""
  ) {
    throw new Error(`${manifestPath} declares no valid frameEntry`);
  }
  await buildFrameEntry({
    id: manifest.id,
    sourceDir,
    outDir,
    frameEntry,
    minify,
    define: {},
    alias: undefined,
  });
}
