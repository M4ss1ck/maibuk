/**
 * Builds the Built-in Plugins into installable folders plus the shipped
 * `index.json` (issue #444). Each Plugin builds with Vite through `buildPlugin`,
 * the same routine the E2E fixture Plugins call
 * (`e2e/support/plugin-fixtures-build.ts`): one self-contained ESM file with
 * nothing left external and no code splitting, so the host module loader can
 * read it. The SDK from `@/plugin-sdk` bundles in; the built entry is the Plugin
 * plus the SDK together.
 *
 * The output is `<outRoot>/<id>/` (manifest, entry, copied assets and locales)
 * and `<outRoot>/index.json`, which the app installs from. Fixture Plugins are
 * never bundled: the CLI reads ids from `plugins/builtins.json` alone.
 *
 * A Built-in ships only for the platforms its manifest declares. A Plugin whose
 * `platforms` exclude the build target is skipped with a log line, the way a
 * Release build drops it silently for the platforms it does not cover. The
 * Android target ships only the Built-ins whose manifest lists "android" (#517).
 *
 *   tsx scripts/build-builtin-plugins.ts [--target web|desktop|android]
 */
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { compareUtf8, hashPluginDirectory } from "@/features/plugins/directory-hash";
import { manifestRunsOn } from "@/features/plugins/host-platform";
import { PLUGIN_PLATFORMS } from "@/features/plugins/manifest-schema";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import type {
  BuiltInPluginIndex,
  BuiltInPluginIndexEntry,
  PluginFolderFile,
  PluginManifest,
} from "@/features/plugins/types";
import { buildPlugin } from "./build-plugin";

/** The repo root, from this script's own location (`scripts/`). */
const REPO_ROOT = resolve(import.meta.dirname, "..");

/** A target a Built-in can be built for, matching the manifest's `platforms`. */
export type PluginTarget = (typeof PLUGIN_PLATFORMS)[number];

/** The gzip budget for one built entry: the SDK plus the Plugin (issue #444). */
export const BUNDLE_SIZE_LIMIT_BYTES = 150 * 1024;

/**
 * A per-Built-in budget above the default, keyed by Plugin id. Only a Plugin
 * whose weight is mostly a third-party runtime needs one: maibuk-mcp carries
 * the MCP SDK plus zod, which alone exceed 150 KB gzip, and maibuk-reader
 * carries pdf.js and the foliate-js parsers as raw source strings.
 */
export const BUNDLE_SIZE_LIMIT_OVERRIDES: Readonly<Record<string, number>> = {
  "maibuk-mcp": 240 * 1024,
  // Reader carries pdf.js's core worker and display module and the foliate-js
  // parsers as raw source strings (plugins/maibuk-reader/loaders.ts, vendored
  // under plugins/maibuk-reader/vendor/): about 653 KB gzip on their own, and
  // 668,642 bytes with the Plugin and SDK. Rounded up to the next 50 KB.
  "maibuk-reader": 700 * 1024,
};

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

/** Every file under `dir`, keyed by its POSIX-relative path. */
function readFolderFiles(dir: string): PluginFolderFile[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = relative(dir, join(entry.parentPath, entry.name)).replace(/\\/g, "/");
      return { path, bytes: readFileSync(join(dir, path)) };
    });
}

/** Reads and validates one manifest file, throwing every problem at once. */
function validateManifestFile(manifestPath: string, builtIn: boolean): PluginManifest {
  const manifestText = readFileSync(manifestPath, "utf8");
  const validation = parsePluginManifest(manifestText, { builtIn });
  if (!validation.ok) {
    const problems = validation.problems
      .map(
        (problem) => `${problem.path === "" ? "<manifest>" : problem.path}: ${problem.message}`
      )
      .join("; ");
    throw new Error(`${manifestPath} is not a valid Plugin manifest: ${problems}`);
  }
  return validation.manifest;
}

/**
 * Builds every Plugin id into `<outRoot>/<id>/` and writes `<outRoot>/index.json`.
 * A Plugin whose manifest excludes the target is skipped. `outRoot` is emptied
 * first, so an id excluded for this target (or dropped from the list) never
 * survives from a previous run of another target. `index.json` is written even
 * when nothing ships.
 */
export async function buildBuiltInPlugins(
  options: BuildBuiltInPluginsOptions
): Promise<BuiltInPluginIndex> {
  const { sourceRoot, ids, outRoot, target } = options;
  // A stale folder from a previous target's run would otherwise ship an id this
  // target excludes, so the output folder starts empty every time.
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });

  const plugins: BuiltInPluginIndexEntry[] = [];
  for (const id of ids) {
    const sourceDir = join(sourceRoot, id);
    const manifestPath = join(sourceDir, "manifest.json");
    const manifest = validateManifestFile(manifestPath, true);

    // The Plugin Platforms rule (#517): the host rule first, then the
    // manifest's list, so Android needs "android" listed explicitly.
    if (!manifestRunsOn(manifest.platforms, target)) {
      console.log(`omitted ${id}: platforms exclude ${target}`);
      continue;
    }

    const outDir = join(outRoot, id);
    await buildPlugin({ sourceDir, manifestPath, outDir });

    const files = readFolderFiles(outDir);
    const hash = await hashPluginDirectory(files);
    plugins.push({
      id,
      manifest,
      hash,
      files: files.map((file) => file.path).sort(compareUtf8),
    });
  }

  const index: BuiltInPluginIndex = { plugins };
  await writeFile(join(outRoot, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

/**
 * The gzip byte size of each built Plugin entry in `<outRoot>/index.json`,
 * against `limitBytes`, or that Plugin's override when `overrides` names it.
 * The entry already carries the SDK, so this measures the SDK plus the Plugin
 * together.
 */
export function checkBundleSize(
  outRoot: string,
  limitBytes: number = BUNDLE_SIZE_LIMIT_BYTES,
  overrides: Readonly<Record<string, number>> = BUNDLE_SIZE_LIMIT_OVERRIDES
): BundleSizeResult[] {
  const index = JSON.parse(readFileSync(join(outRoot, "index.json"), "utf8")) as BuiltInPluginIndex;
  return index.plugins.map((plugin) => {
    const entry = readFileSync(join(outRoot, plugin.id, plugin.manifest.entry));
    const bytes = gzipSync(entry, { level: 9 }).length;
    const limit = overrides[plugin.id] ?? limitBytes;
    return { id: plugin.id, bytes, limitBytes: limit, ok: bytes <= limit };
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

/** The target a build ships for from the argv, or `undefined` when absent. */
export function parseTargetArg(argv: readonly string[]): PluginTarget | undefined {
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
      console.error(`  ${size.id}: ${kb} KB gzip, over the ${size.limitBytes / 1024} KB budget`);
      overBudget = true;
    }
  }
  if (overBudget) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
