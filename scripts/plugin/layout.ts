/**
 * The layout a packaged Plugin must have (issue #455). The same rules run on a
 * built folder (the Built-in equivalence check) and on its `.zip` (what an
 * author installs): `manifest.json` sits at the root, every file the manifest
 * declares is present, nothing a package must never ship is inside (source
 * files, source maps, test files, `node_modules`), and no file leaks one of the
 * absolute paths the caller forbids (the Maibuk checkout, the Plugin source).
 *
 * The declared files are the manifest's relative-file fields: `entry`, each
 * page's `frame`, and a sidebar entry's or toolbar button's `icon` when it is a
 * relative `.svg` path rather than a Lucide icon name.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { unzipSync } from "fflate";

/** The `.ts`, `.tsx`, and `.map` files a package must never ship. */
const FORBIDDEN_EXTENSION_PATTERN = /\.(ts|tsx|map)$/;

/** Test files beside the source, never built and never shipped. */
const TEST_FILE_PATTERN = /(\.test\.[cm]?[jt]sx?$)|((^|\/)test-support\.[cm]?[jt]sx?$)/;

/**
 * The manifest fields the layout check reads. The full type is `PluginManifest`
 * (`src/features/plugins/types.ts`); this keeps the check a leaf with no `@/`
 * import while naming every relative-file field.
 */
interface LayoutManifest {
  entry?: unknown;
  contributes?: {
    pages?: ReadonlyArray<{ frame?: unknown }>;
    sidebarEntries?: ReadonlyArray<{ icon?: unknown }>;
    toolbarButtons?: ReadonlyArray<{ icon?: unknown }>;
  };
}

/** What {@link checkFolderLayout} and {@link checkPackageLayout} read. */
export interface LayoutCheckOptions {
  /** Absolute paths no packaged file may contain, such as the Maibuk checkout. */
  forbiddenStrings: string[];
}

/** The layout problems the check found. */
export interface LayoutCheckResult {
  /** One plain-language message per problem, in a stable order. */
  problems: string[];
}

/** Strips `.` and empty segments, like the shared `normalizeRelativePath`. */
function normalizeRelativePath(value: string): string {
  return value
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}

/** Every file the manifest declares relative to the Plugin folder. */
function declaredFiles(manifest: LayoutManifest): string[] {
  const declared: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === "string" && value !== "") declared.push(normalizeRelativePath(value));
  };

  add(manifest.entry);
  for (const page of manifest.contributes?.pages ?? []) add(page.frame);
  const icons = [
    ...(manifest.contributes?.sidebarEntries ?? []),
    ...(manifest.contributes?.toolbarButtons ?? []),
  ];
  for (const entry of icons) {
    if (typeof entry.icon === "string" && entry.icon.endsWith(".svg")) add(entry.icon);
  }
  return declared;
}

/** Every file under `dir`, keyed by its Plugin-relative POSIX path. */
function readFolder(dir: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    files.set(relative(dir, absolute).replace(/\\/g, "/"), readFileSync(absolute));
  }
  return files;
}

/** The layout problems of a Plugin folder read as `path -> bytes`. */
function layoutProblems(files: Map<string, Uint8Array>, opts: LayoutCheckOptions): string[] {
  const problems: string[] = [];
  const decoder = new TextDecoder();

  const manifestBytes = files.get("manifest.json");
  let manifest: LayoutManifest | null = null;
  if (manifestBytes === undefined) {
    problems.push("manifest.json is missing from the package root");
  } else {
    try {
      manifest = JSON.parse(decoder.decode(manifestBytes)) as LayoutManifest;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      problems.push(`manifest.json is not valid JSON: ${detail}`);
    }
  }

  if (manifest !== null) {
    const declared = declaredFiles(manifest);
    if (declared.length === 0) problems.push("manifest.json declares no entry file");
    const seen = new Set<string>();
    for (const file of declared) {
      if (seen.has(file)) continue;
      seen.add(file);
      if (!files.has(file)) problems.push(`declared file "${file}" is missing`);
    }
  }

  const forbidden = opts.forbiddenStrings.filter((value) => value !== "");
  for (const path of [...files.keys()].sort()) {
    const bytes = files.get(path) as Uint8Array;
    if (FORBIDDEN_EXTENSION_PATTERN.test(path)) {
      problems.push(`"${path}" must not ship .ts, .tsx, or .map files`);
    }
    if (TEST_FILE_PATTERN.test(path)) problems.push(`"${path}" is a test file`);
    if (path.split("/").includes("node_modules")) {
      problems.push(`"${path}" is inside node_modules`);
    }
    if (forbidden.length > 0) {
      const text = decoder.decode(bytes);
      const leaked = forbidden.find((value) => text.includes(value));
      if (leaked !== undefined) problems.push(`"${path}" contains the forbidden path "${leaked}"`);
    }
  }
  return problems;
}

/** Checks the built Plugin folder at `dir` against the layout rules. */
export function checkFolderLayout(dir: string, opts: LayoutCheckOptions): LayoutCheckResult {
  return { problems: layoutProblems(readFolder(dir), opts) };
}

/** Checks the packaged Plugin `.zip` at `zipPath` against the layout rules. */
export function checkPackageLayout(zipPath: string, opts: LayoutCheckOptions): LayoutCheckResult {
  const unzipped = unzipSync(readFileSync(zipPath));
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(unzipped)) {
    // A zip may carry directory entries; only the files matter.
    if (name.endsWith("/")) continue;
    files.set(name, bytes);
  }
  return { problems: layoutProblems(files, opts) };
}
