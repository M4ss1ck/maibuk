import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Plugin Endpoint seam is test-only (#586): it exists only in the E2E
 * lane's web build, whose compile-time flag `VITE_E2E_BUILTIN_SEED` is set by
 * `e2e/run-steps.mjs`, and a shipped bundle must not carry it. This follows the
 * conformance `route-gate.test.ts` pattern: it walks the static value-import
 * graph from `main.tsx` and proves the seam module is never statically
 * reachable, then pins the guarded `main.tsx` shape the production build
 * tree-shakes. The real end-to-end proof is `pnpm build:web` followed by a grep
 * of `dist/` for `__maibukEndpointSeam` (run by hand for #586); this test is the
 * cheap standing guard that fails on the obvious regression.
 */

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SEAM_FILE = resolve(SRC_ROOT, "features/plugins/endpoint-seam.ts");

const VALUE_IMPORT_PATTERNS = [
  /\bimport\s+(?!type\b)[^;]*?\bfrom\s+["']([^"']+)["']/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\bexport\s+(?!type\b)[^;]*?\bfrom\s+["']([^"']+)["']/g,
];

function stripQuery(specifier: string): string {
  return specifier.replace(/[?#].*$/, "");
}

function resolveTsModule(base: string): string | null {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (!candidate.endsWith(".ts") && !candidate.endsWith(".tsx")) continue;
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  }
  return null;
}

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  const clean = stripQuery(specifier);
  if (clean.startsWith(".")) return resolveTsModule(resolve(dirname(fromFile), clean));
  if (clean.startsWith("@/")) return resolveTsModule(resolve(SRC_ROOT, clean.slice(2)));
  return null;
}

function extractValueSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const pattern of VALUE_IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) specs.push(match[1]);
  }
  return specs;
}

function walkEntryGraph(): Set<string> {
  const entry = resolve(SRC_ROOT, "main.tsx");
  const files = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    for (const specifier of extractValueSpecifiers(readFileSync(file, "utf8"))) {
      const resolved = resolveSpecifier(specifier, file);
      if (resolved !== null && !files.has(resolved)) {
        files.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return files;
}

describe("the Plugin Endpoint seam is absent from a shipped build", () => {
  const reachable = walkEntryGraph();

  it("reaches the app entry to prove the walk works", () => {
    expect([...reachable].some((file) => file.endsWith("/App.tsx"))).toBe(true);
  });

  it("never statically imports the endpoint seam", () => {
    expect(reachable.has(SEAM_FILE)).toBe(false);
  });

  it("gates the seam behind the statically replaceable flag in main.tsx", () => {
    const main = readFileSync(resolve(SRC_ROOT, "main.tsx"), "utf8");
    expect(main).toContain('import.meta.env.VITE_E2E_BUILTIN_SEED === "1"');
    // The import is dynamic, so a normal build tree-shakes it away.
    expect(main).toContain('import("@/features/plugins/endpoint-seam")');
    // And no static import sneaks the module into the entry chunk.
    expect(main).not.toMatch(/\bimport\s+[^;]*?from\s+["']@\/features\/plugins\/endpoint-seam["']/);
  });

  it("only installs the seam inside the guarded block", () => {
    const main = readFileSync(resolve(SRC_ROOT, "main.tsx"), "utf8");
    // The flag is read into a module-level constant, and the install runs
    // inside `if (ENDPOINT_SEAM_ENABLED) { … }`, so Rollup folds both away.
    expect(main).toMatch(
      /const ENDPOINT_SEAM_ENABLED = import\.meta\.env\.VITE_E2E_BUILTIN_SEED === "1";/
    );
    expect(main).toMatch(
      /if \(ENDPOINT_SEAM_ENABLED\) \{\s*const \{ installEndpointSeam \} = await import\("@\/features\/plugins\/endpoint-seam"\);\s*installEndpointSeam\(\);\s*\}/
    );
    // Exactly one install site, so no unguarded call can be added beside it.
    expect(main.match(/installEndpointSeam\(\)/g)).toHaveLength(1);
  });
});
