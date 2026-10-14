/**
 * The Echoes import boundary (#450). Echoes must build the way a third-party
 * Plugin does: every non-test `.ts`/`.tsx` under `plugins/maibuk-echoes/` may
 * import from Maibuk only through `@/plugin-sdk` (and its subpaths), plus its
 * own relative files. Any other `@/` import, or a relative import that leaves
 * the folder, fails here.
 *
 * `vendor/` holds third-party source. It is skipped only while none of its
 * files carries an import; once one does, its `.ts`/`.tsx` files are checked
 * like any other so a vendored import cannot quietly reach into Maibuk.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = __dirname;
const VENDOR_DIR = join(ROOT, "vendor");
const SOURCE_PATTERN = /\.(ts|tsx)$/;
const TEST_PATTERN = /\.test\.(ts|tsx)$/;
/** Test-only support beside the tests, like `test-support.ts`: never built, never shipped. */
const TEST_SUPPORT_PATTERN = /(^|\/)test-support\.(ts|tsx)$/;

/** Every file under `dir`, as absolute paths. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Every module specifier a source file imports or re-exports. */
function importSpecifiers(text: string): string[] {
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
  ];
  const specifiers: string[] = [];
  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match !== null) {
      specifiers.push(match[1]);
      match = pattern.exec(text);
    }
  }
  return specifiers;
}

/** Whether any file under `vendor/` carries an import. */
function vendorHasImports(): boolean {
  return listFiles(VENDOR_DIR).some((file) => {
    if (!/\.(ts|tsx|js|mjs)$/.test(file)) return false;
    return importSpecifiers(readFileSync(file, "utf8")).length > 0;
  });
}

/** Whether a relative specifier stays inside the Plugin folder. */
function staysInside(fromFile: string, specifier: string): boolean {
  const target = resolve(dirname(fromFile), specifier);
  const inside = relative(ROOT, target);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
}

const skipVendor = !vendorHasImports();
const files = listFiles(ROOT).filter(
  (file) =>
    SOURCE_PATTERN.test(file) &&
    !TEST_PATTERN.test(file) &&
    !TEST_SUPPORT_PATTERN.test(file) &&
    !(skipVendor && file.startsWith(VENDOR_DIR))
);

describe("Echoes import boundary", () => {
  it("finds its own source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain(join(ROOT, "runtime.tsx"));
    expect(files).toContain(join(ROOT, "find-echoes.ts"));
  });

  it("imports Maibuk only through @/plugin-sdk and never leaves the folder", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        const where = relative(ROOT, file);
        if (specifier.startsWith("@/")) {
          if (specifier !== "@/plugin-sdk" && !specifier.startsWith("@/plugin-sdk/")) {
            violations.push(`${where} imports ${specifier}`);
          }
        } else if (specifier.startsWith(".") && !staysInside(file, specifier)) {
          violations.push(`${where} imports ${specifier}, which leaves the Plugin folder`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("loads the Worker's Remote DOM polyfill before any other SDK import", () => {
    // `@/plugin-sdk` touches HTMLElement when evaluated; imported first, the
    // Worker crashes at start with "HTMLElement is not defined".
    const entry = importSpecifiers(readFileSync(join(ROOT, "index.tsx"), "utf8"));
    expect(entry[0]).toBe("@/plugin-sdk/worker-ui");
  });
});
