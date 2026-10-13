/**
 * Builds the Built-in Plugins into installable folders plus the shipped
 * `index.json` (issue #444). Each Plugin builds with Vite the same way the E2E
 * fixture Plugins do (`e2e/support/plugin-fixtures-build.ts`): one self-contained
 * ESM file with nothing left external and no code splitting, so the host module
 * loader can read it. The SDK from `@/plugin-sdk` bundles in; the built entry is
 * the Plugin plus the SDK together.
 *
 * The output is `<outRoot>/<id>/` (manifest, entry, copied assets and locales)
 * and `<outRoot>/index.json`, which the app installs from. Fixture Plugins are
 * never bundled: the CLI reads ids from `plugins/builtins.json` alone.
 *
 * A Built-in ships only for the platforms its manifest declares. A Plugin whose
 * `platforms` exclude the build target is skipped with a log line, the way a
 * Release build drops it silently for the platforms it does not cover.
 *
 *   tsx scripts/build-builtin-plugins.ts [--target web|desktop|android]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { PLUGIN_PLATFORMS } from "@/features/plugins/manifest-schema";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import type { PluginFolderFile, PluginManifest } from "@/features/plugins/types";

/** The repo root, from this script's own location (`scripts/`). */
export const REPO_ROOT = resolve(import.meta.dirname, "..");

/** A target a Built-in can be built for, matching the manifest's `platforms`. */
export type PluginTarget = (typeof PLUGIN_PLATFORMS)[number];

/** The gzip budget for one built entry: the SDK plus the Plugin (issue #444). */
export const BUNDLE_SIZE_LIMIT_BYTES = 150 * 1024;

/** One Built-in in `index.json`: its manifest, shipped hash, and file paths. */
export interface BuiltInPluginIndexEntry {
  id: string;
  manifest: PluginManifest;
  /** The `h1:` directory hash over the built folder, as the app pins it. */
  hash: string;
  /** The built folder's POSIX-relative paths, sorted. */
  files: string[];
}

/** The shipped list the app installs from (`<outRoot>/index.json`). */
export interface BuiltInPluginIndex {
  plugins: BuiltInPluginIndexEntry[];
}

export interface BuildBuiltInPluginsOptions {
  /** The folder holding `plugins/<id>/` sources. */
  sourceRoot: string;
  /** The Plugin ids to build, in order. */
  ids: readonly string[];
  /** Where the installable folders and `index.json` are written. */
  outRoot: string;
  /** The platform this build ships for. */
  target: PluginTarget;
}

/** One built entry's gzip size against the budget. */
export interface BundleSizeResult {
  id: string;
  /** The gzip byte size of the built entry JS. */
  bytes: number;
  limitBytes: number;
  ok: boolean;
}

const encoder = new TextEncoder();

// Byte order over UTF-8, matching the order `directory-hash.ts` sorts by.
function comparePaths(left: string, right: string): number {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** Every file under `dir`, keyed by its POSIX-relative path. */
function readFolderFiles(dir: string): PluginFolderFile[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = relative(dir, join(entry.parentPath, entry.name)).replace(/\\/g, "/");
      return { path, bytes: readFileSync(join(dir, path)) };
    });
}

/** The Plugin entry source, `index.tsx` preferred over `index.ts`. */
function resolveEntry(sourceDir: string): string {
  for (const name of ["index.tsx", "index.ts"]) {
    const candidate = join(sourceDir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`no entry (index.ts or index.tsx) in ${sourceDir}`);
}

/** Builds one Plugin source into `<outRoot>/<id>/` as one self-contained ESM file. */
async function buildPlugin(sourceDir: string, outDir: string, manifest: PluginManifest) {
  await build({
    configFile: false,
    logLevel: "warn",
    // No `public/` copy: the folder must hold only what the manifest declares,
    // or the app would hash assets the Plugin never lists.
    publicDir: false,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: { alias: [{ find: "@", replacement: join(REPO_ROOT, "src") }] },
    // A Plugin bundle is React/JSX; esbuild's automatic runtime resolves
    // `react/jsx-runtime`. `jsxDev` is pinned off for the same reason as the E2E
    // fixtures: this Node entry never sets `NODE_ENV`, so the transform would
    // otherwise emit `jsxDEV`, which React's production runtime ships as
    // `undefined`.
    esbuild: { jsx: "automatic", jsxDev: false },
    build: {
      outDir,
      emptyOutDir: true,
      minify: true,
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
}

/**
 * Builds every Plugin id into `<outRoot>/<id>/` and writes `<outRoot>/index.json`.
 * A Plugin whose manifest excludes the target is skipped. `outRoot` is created
 * and `index.json` is written even when nothing ships.
 */
export async function buildBuiltInPlugins(
  options: BuildBuiltInPluginsOptions
): Promise<BuiltInPluginIndex> {
  const { sourceRoot, ids, outRoot, target } = options;
  await mkdir(outRoot, { recursive: true });

  const plugins: BuiltInPluginIndexEntry[] = [];
  for (const id of ids) {
    const sourceDir = join(sourceRoot, id);
    const manifestText = readFileSync(join(sourceDir, "manifest.json"), "utf8");
    const validation = parsePluginManifest(manifestText, { builtIn: true });
    if (!validation.ok) {
      const problems = validation.problems
        .map(
          (problem) => `${problem.path === "" ? "<manifest>" : problem.path}: ${problem.message}`
        )
        .join("; ");
      throw new Error(`${id}/manifest.json is not a valid Plugin manifest — ${problems}`);
    }
    const manifest = validation.manifest;

    if (!manifest.platforms.includes(target)) {
      console.log(`omitted ${id}: platforms exclude ${target}`);
      continue;
    }

    const outDir = join(outRoot, id);
    await buildPlugin(sourceDir, outDir, manifest);
    if (!existsSync(join(outDir, manifest.entry))) {
      throw new Error(
        `built ${id} but ${manifest.entry} is missing; the manifest entry must match`
      );
    }
    await cp(join(sourceDir, "manifest.json"), join(outDir, "manifest.json"));
    for (const folder of ["assets", "locales"]) {
      const from = join(sourceDir, folder);
      if (existsSync(from)) await cp(from, join(outDir, folder), { recursive: true });
    }

    const files = readFolderFiles(outDir);
    const hash = await hashPluginDirectory(files);
    plugins.push({
      id,
      manifest,
      hash,
      files: files.map((file) => file.path).sort(comparePaths),
    });
  }

  const index: BuiltInPluginIndex = { plugins };
  await writeFile(join(outRoot, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

/**
 * The gzip byte size of each built Plugin entry in `<outRoot>/index.json`,
 * against `limitBytes`. The entry already carries the SDK, so this measures the
 * SDK plus the Plugin together.
 */
export function checkBundleSize(
  outRoot: string,
  limitBytes: number = BUNDLE_SIZE_LIMIT_BYTES
): BundleSizeResult[] {
  const index = JSON.parse(readFileSync(join(outRoot, "index.json"), "utf8")) as BuiltInPluginIndex;
  return index.plugins.map((plugin) => {
    const entry = readFileSync(join(outRoot, plugin.id, plugin.manifest.entry));
    const bytes = gzipSync(entry, { level: 9 }).length;
    return { id: plugin.id, bytes, limitBytes, ok: bytes <= limitBytes };
  });
}

/** The target a build ships for when `--target` is absent. */
export function defaultTarget(env: Record<string, string | undefined> = process.env): PluginTarget {
  const tauri = env.TAURI_ENV_PLATFORM;
  // Tauri sets the platform for its builds: Android is its own target, every
  // desktop platform shares the desktop Plugin platforms.
  if (tauri !== undefined && tauri !== "") return tauri === "android" ? "android" : "desktop";
  if (env.VITE_BUILD_TARGET === "web") return "web";
  return "desktop";
}

function parseTargetArg(argv: readonly string[]): PluginTarget | undefined {
  const flag = argv.findIndex((arg) => arg === "--target" || arg.startsWith("--target="));
  if (flag === -1) return undefined;
  const value = argv[flag].startsWith("--target=")
    ? argv[flag].slice("--target=".length)
    : argv[flag + 1];
  if (value !== undefined && (PLUGIN_PLATFORMS as readonly string[]).includes(value)) {
    return value as PluginTarget;
  }
  throw new Error(`--target must be one of ${PLUGIN_PLATFORMS.join(", ")} (got "${value}")`);
}

/** The Plugin ids `plugins/builtins.json` lists, validating its shape. */
function readBuiltInIds(builtinsPath: string): string[] {
  const parsed = JSON.parse(readFileSync(builtinsPath, "utf8")) as { plugins?: unknown };
  if (!Array.isArray(parsed.plugins) || parsed.plugins.some((id) => typeof id !== "string")) {
    throw new Error(`${builtinsPath} must be { "plugins": [<id>, ...] }`);
  }
  return parsed.plugins as string[];
}

async function main(): Promise<void> {
  const target = parseTargetArg(process.argv.slice(2)) ?? defaultTarget();
  const sourceRoot = join(REPO_ROOT, "plugins");
  const outRoot = join(REPO_ROOT, "dist/plugins");
  const ids = readBuiltInIds(join(sourceRoot, "builtins.json"));

  const index = await buildBuiltInPlugins({ sourceRoot, ids, outRoot, target });
  console.log(`built ${index.plugins.length} Built-in Plugin(s) for ${target}`);

  let overBudget = false;
  for (const size of checkBundleSize(outRoot)) {
    const kb = (size.bytes / 1024).toFixed(1);
    if (size.ok) {
      console.log(`  ${size.id}: ${kb} KB gzip`);
    } else {
      console.error(
        `  ${size.id}: ${kb} KB gzip — over the ${BUNDLE_SIZE_LIMIT_BYTES / 1024} KB budget`
      );
      overBudget = true;
    }
  }
  if (overBudget) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
