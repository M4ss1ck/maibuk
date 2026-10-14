import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Plugins bench's in-app driver (issue #448) is test-only: it
 * exists only in a build made with `VITE_PLUGIN_BENCH_DRIVER=1`, and a shipped
 * bundle must not carry it. This follows the conformance route-gate test: it
 * walks the static value-import graph from `main.tsx` and proves the bench
 * module is never statically reachable, then pins the guarded `main.tsx` shape
 * the production build tree-shakes.
 */

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BENCH_DIR = resolve(SRC_ROOT, "features/plugins/bench");

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

describe("the Plugins bench driver is absent from a shipped build", () => {
  const reachable = walkEntryGraph();

  it("reaches the app entry to prove the walk works", () => {
    expect([...reachable].some((file) => file.endsWith("/App.tsx"))).toBe(true);
  });

  it("never statically imports the bench driver module", () => {
    const imported = [...reachable].filter((file) => file.startsWith(`${BENCH_DIR}/`));
    expect(imported).toEqual([]);
  });

  it("gates the seed and the driver behind the statically replaceable flag", () => {
    const main = readFileSync(resolve(SRC_ROOT, "main.tsx"), "utf8");
    expect(main).toContain('import.meta.env.VITE_PLUGIN_BENCH_DRIVER === "1"');
    // Both imports are dynamic, so a normal build tree-shakes them away.
    expect(main).toContain('import("@/features/plugins/bench")');
    expect(main).not.toMatch(/\bimport\s+[^;]*?from\s+["']@\/features\/plugins\/bench["']/);
  });
});
