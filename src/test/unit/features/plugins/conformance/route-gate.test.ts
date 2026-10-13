import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import es from "@/locales/es.json";

/**
 * The conformance route is test-only (#447, D3): it exists only in a build that
 * sets `VITE_PLUGIN_CONFORMANCE=1`, and a shipped bundle must not carry it. This
 * follows the `entry-chunk.test.ts` pattern: it walks the static value-import
 * graph from `main.tsx` and proves the conformance module is never statically
 * reachable, then pins the guarded App.tsx shape the production build
 * tree-shakes. The real end-to-end proof is the lane's
 * `pnpm build:web && ! grep -rl "__conformance" dist/`; this test is the cheap
 * standing guard that fails on the obvious regression.
 */

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const CONFORMANCE_DIR = resolve(SRC_ROOT, "features/plugins/conformance");

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

describe("the conformance route is absent from a shipped build", () => {
  const reachable = walkEntryGraph();

  it("reaches the app entry to prove the walk works", () => {
    expect([...reachable].some((file) => file.endsWith("/App.tsx"))).toBe(true);
  });

  it("never statically imports the conformance module", () => {
    const imported = [...reachable].filter((file) => file.startsWith(`${CONFORMANCE_DIR}/`));
    expect(imported).toEqual([]);
  });

  it("guards the route and the redirect with the statically replaceable flag", () => {
    const app = readFileSync(resolve(SRC_ROOT, "App.tsx"), "utf8");
    expect(app).toContain('import.meta.env.VITE_PLUGIN_CONFORMANCE === "1"');
    // The path is a dropped constant, never a literal the always-bundled route
    // registries (ROUTE_CONTEXTS, the E2E coverage matrix) would enumerate.
    expect(app).toContain('const CONFORMANCE_ROUTE = "/__conformance/plugins"');
    expect(app).toContain("path={CONFORMANCE_ROUTE}");
    expect(app).toContain("to={CONFORMANCE_ROUTE}");
    // The import is dynamic, so a normal build tree-shakes it away.
    expect(app).toContain('import("@/features/plugins/conformance")');
    // And no static import sneaks the module into the entry chunk.
    expect(app).not.toMatch(/\bimport\s+[^;]*?from\s+["']@\/features\/plugins\/conformance["']/);
  });

  it("redirects `/` at render time, not as a route the home branch outranks", () => {
    const app = readFileSync(resolve(SRC_ROOT, "App.tsx"), "utf8");
    // The redirect must run before the home `<Route path="/">`; a sibling flat
    // `/` route loses the ranking to the Layout branch and never renders, which
    // is exactly the regression that made the lane measure nothing.
    expect(app).toMatch(
      /if \(CONFORMANCE_ENABLED && pathname === "\/"\) \{\s*return <Navigate to=\{CONFORMANCE_ROUTE\} replace \/>;/
    );
    expect(app).not.toContain('path="/" element={<Navigate');
  });

  it("wraps the lazy conformance route in a Suspense boundary", () => {
    const app = readFileSync(resolve(SRC_ROOT, "App.tsx"), "utf8");
    expect(app).toMatch(/<Suspense fallback=\{null\}>\s*<ConformancePage \/>/);
  });
});

describe("the conformance status copy", () => {
  it("defines the status strings in both locales", () => {
    for (const locale of [en, es]) {
      for (const key of ["running", "done", "error"] as const) {
        expect(locale.plugins.conformance[key].length, key).toBeGreaterThan(0);
      }
    }
  });
});
