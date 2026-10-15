/**
 * The shared Vite build for one Plugin source folder: one self-contained ESM
 * file, with the manifest, `assets/`, and `locales/` copied beside it, so the
 * folder is exactly what the app installs. The Built-in build
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
import { existsSync, readFileSync } from "node:fs";
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

/** The manifest fields `buildPlugin` reads; the caller validates the rest. */
interface BuildPluginManifest {
  id?: string;
  entry: string;
}

/**
 * Builds one Plugin source into `outDir` as one self-contained ESM file, then
 * copies the manifest, `assets/`, and `locales/` beside it. The bundle is named
 * exactly what the manifest's `entry` declares, and nothing is left external or
 * code-split, so the host module loader can read it.
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
}
