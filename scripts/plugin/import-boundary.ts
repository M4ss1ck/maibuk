/**
 * The import boundary every third-party Plugin must respect (issues #450, #455).
 * One non-test `.ts`/`.tsx`/`.mts`/`.cts`/`.js`/`.mjs`/`.cjs`/`.jsx` under the
 * Plugin root may import only a relative file that stays inside the folder,
 * `@maibuk/plugin-sdk` and a single safe subpath segment, or a bare npm package;
 * anything else is a violation reported with its file, line, specifier, and
 * reason.
 * `@maibuk/plugin-test-kit` is allowed in test files (`*.test.*`,
 * `test-support.*`), and Node builtins are allowed only there, never in shipped
 * source. The bare `maibuk` package, and (when `maibukRoot` is given) a relative
 * specifier that resolves inside the checkout but outside the Plugin folder,
 * are refused as reaching into Maibuk. `node_modules`, `dist`, `.git`,
 * `.maibuk`, and the root-level `scripts/` are never walked, so a repo with a
 * large `node_modules` scans fast.
 *
 * A Built-in (`builtIn: true`) ships with the checkout, so its shipped files
 * may also import `@/plugin-sdk` and one safe subpath segment of it (the same
 * shape the public subpaths allow), and its test files may import any `@/...`
 * module (they run inside the checkout's own test suite). Shipped files still
 * may not import other `@/...` modules, and every other rule is unchanged.
 *
 * The specifier extraction matches `plugins/maibuk-echoes/import-boundary.test.ts`
 * (static `from`, side-effect `import`, dynamic `import()`, `export ... from`,
 * and `require()`), extended to track each specifier's line.
 */
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { listFiles, TEST_FILE_PATTERN } from "./files";

const SOURCE_PATTERN = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
const SDK_PACKAGE = "@maibuk/plugin-sdk";
const TEST_KIT_PACKAGE = "@maibuk/plugin-test-kit";
/** The SDK entry a Built-in imports from the checkout: `@/plugin-sdk`. */
const BUILT_IN_SDK = "@/plugin-sdk";
const MAIBUK_CHECKOUT_REASON = "reaches into the Maibuk checkout";
/** Directories the walk never descends into; `scripts/` is pruned at the root only. */
const PRUNED_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".maibuk"]);
const BUILTINS: ReadonlySet<string> = new Set(builtinModules);

/** The specifier patterns to scan for; the `from` one covers `export ... from`. */
const SPECIFIER_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** One refused import in a Plugin source file. */
export interface ImportViolation {
  /** The file, relative to the Plugin root, with forward slashes. */
  file: string;
  /** The 1-based line the specifier sits on. */
  line: number;
  /** The specifier as written. */
  specifier: string;
  /** Why it is refused, in plain language. */
  reason: string;
}

/** What {@link checkImportBoundary} found. */
export interface ImportBoundaryResult {
  /** Every refused import, ordered by file then line. */
  violations: ImportViolation[];
  /** The Plugin-relative paths that were scanned, sorted. */
  scanned: string[];
}

/** What the caller may inject; reserved for a Maibuk root a later check needs. */
export interface ImportBoundaryOptions {
  /** The Maibuk checkout path, when known. */
  maibukRoot?: string;
  /** Whether the Plugin is a Built-in shipping with the checkout. */
  builtIn?: boolean;
}

interface Specifier {
  value: string;
  index: number;
}

/** Every module specifier a source file imports or re-exports, with its offset. */
function importSpecifiers(text: string): Specifier[] {
  const found: Specifier[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      found.push({ value: match[1], index: match.index });
      match = pattern.exec(text);
    }
  }
  return found.sort((left, right) => left.index - right.index);
}

/** The 1-based line an offset sits on. */
function lineOf(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

/** Whether a specifier names a Node builtin (`node:fs` or a bare `fs`). */
function isBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  if (BUILTINS.has(specifier)) return true;
  const base = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  return BUILTINS.has(base);
}

/** Whether a relative specifier stays inside the Plugin root. */
function staysInside(fromFile: string, specifier: string, pluginRoot: string): boolean {
  const target = resolve(dirname(fromFile), specifier);
  const inside = relative(pluginRoot, target);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
}

/** Whether an absolute path sits inside `root`. */
function isInside(root: string, target: string): boolean {
  const inside = relative(root, target);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
}

/** Whether an SDK subpath is one safe segment: no `.`, `..`, empty, `/`, or `\`. */
function isSafeSubpath(subpath: string): boolean {
  return (
    subpath !== "" &&
    subpath !== "." &&
    subpath !== ".." &&
    !subpath.includes("/") &&
    !subpath.includes("\\")
  );
}

/** Why a specifier is refused, or null when it is allowed. */
function refusalReason(
  specifier: string,
  isTestFile: boolean,
  fromFile: string,
  pluginRoot: string,
  maibukRoot: string | undefined,
  builtIn: boolean
): string | null {
  if (specifier === SDK_PACKAGE) return null;
  if (specifier.startsWith(`${SDK_PACKAGE}/`)) {
    const subpath = specifier.slice(SDK_PACKAGE.length + 1);
    return isSafeSubpath(subpath)
      ? null
      : `${specifier} is not an allowed ${SDK_PACKAGE} subpath; import only ${SDK_PACKAGE} or a relative file inside the Plugin`;
  }
  if (specifier === TEST_KIT_PACKAGE) {
    return isTestFile ? null : `${TEST_KIT_PACKAGE} is only allowed in test files`;
  }
  if (specifier.startsWith("@maibuk/")) {
    return `${specifier} is not an allowed package; only ${SDK_PACKAGE} and ${TEST_KIT_PACKAGE} resolve`;
  }
  if (specifier.startsWith("@/")) {
    if (builtIn) {
      if (specifier === BUILT_IN_SDK) return null;
      if (specifier.startsWith(`${BUILT_IN_SDK}/`)) {
        const subpath = specifier.slice(BUILT_IN_SDK.length + 1);
        return isSafeSubpath(subpath)
          ? null
          : `${specifier} is not an allowed ${BUILT_IN_SDK} subpath; import only ${BUILT_IN_SDK} or a relative file inside the Plugin`;
      }
      if (isTestFile) return null;
    }
    return `${specifier} is private; import only ${SDK_PACKAGE} or a relative file inside the Plugin`;
  }
  if (isAbsolute(specifier) || /^[a-zA-Z]:[\\/]/.test(specifier)) {
    return `${specifier} is an absolute path; import only ${SDK_PACKAGE} or a relative file inside the Plugin`;
  }
  if (specifier === "maibuk" || specifier.startsWith("maibuk/")) {
    return `${specifier} ${MAIBUK_CHECKOUT_REASON}`;
  }
  if (specifier.startsWith(".")) {
    const target = resolve(dirname(fromFile), specifier);
    if (
      maibukRoot !== undefined &&
      isInside(maibukRoot, target) &&
      !isInside(pluginRoot, target)
    ) {
      return `${specifier} ${MAIBUK_CHECKOUT_REASON}`;
    }
    return staysInside(fromFile, specifier, pluginRoot)
      ? null
      : `${specifier} leaves the Plugin folder`;
  }
  if (isBuiltin(specifier)) {
    return isTestFile
      ? null
      : `${specifier} is a Node builtin; Plugin source may not import Node builtins`;
  }
  return null;
}

/**
 * Checks every import in the Plugin folder at `pluginRoot` against the
 * boundary, returning the refusals and the files it scanned. `node_modules`,
 * `dist`, `.git`, `.maibuk`, and the root-level `scripts/` are never walked.
 */
export function checkImportBoundary(
  pluginRoot: string,
  options: ImportBoundaryOptions = {}
): ImportBoundaryResult {
  const { maibukRoot, builtIn = false } = options;
  const files = listFiles(pluginRoot, { prune: PRUNED_DIRECTORIES, pruneRootScripts: true }).filter(
    (relPath) => SOURCE_PATTERN.test(relPath)
  );

  const violations: ImportViolation[] = [];
  for (const relPath of files) {
    const text = readFileSync(join(pluginRoot, relPath), "utf8");
    const isTestFile = TEST_FILE_PATTERN.test(relPath);
    for (const specifier of importSpecifiers(text)) {
      const reason = refusalReason(
        specifier.value,
        isTestFile,
        join(pluginRoot, relPath),
        pluginRoot,
        maibukRoot,
        builtIn
      );
      if (reason !== null) {
        violations.push({
          file: relPath,
          line: lineOf(text, specifier.index),
          specifier: specifier.value,
          reason,
        });
      }
    }
  }

  return { violations, scanned: files };
}
