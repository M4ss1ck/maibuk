import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Android QuickJS engine (#516) is compile-time gated: on web and desktop
 * `QUICKJS_ENGINE_ENABLED` folds to `false` and Rollup drops the runner, its
 * Wasm, and the bundled runner module. This follows the conformance route-gate
 * test: it walks the static value-import graph from `main.tsx` and proves the
 * engine is never statically reachable, then pins the guarded shape the
 * production build tree-shakes, and scans the whole `src/` tree so a lazy chunk
 * cannot sneak a static engine import either. The real proof is the lane's
 * `pnpm build:web && ! find dist -name '*.wasm' | xargs -r grep -l -a quickjs`;
 * this test is the cheap standing guard that fails on the obvious regression.
 */

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const QUICKJS_DIR = resolve(SRC_ROOT, "features/plugins/quickjs");
const TEST_DIR = resolve(SRC_ROOT, "test");

/** The engine packages and the modules that pull them in, by specifier. */
const ENGINE_PACKAGES = ["quickjs-emscripten-core"];
const ENGINE_PACKAGE_PREFIXES = ["@jitl/"];
const ENGINE_MODULE_SPECIFIERS = [
  "@/features/plugins/quickjs/host-assets",
  "@/features/plugins/quickjs/worker-entry",
  "@/features/plugins/quickjs/runner",
];

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

/** Every `.ts`/`.tsx` under `src/`, minus the tests and the engine's own folder. */
function sourceFiles(): string[] {
  return readdirSync(SRC_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
    .filter((file) => (file.endsWith(".ts") || file.endsWith(".tsx")) && !file.endsWith(".d.ts"))
    .filter((file) => !file.startsWith(`${TEST_DIR}/`) && !file.startsWith(`${QUICKJS_DIR}/`));
}

function isEngineSpecifier(specifier: string): boolean {
  return (
    ENGINE_PACKAGES.includes(specifier) ||
    ENGINE_PACKAGE_PREFIXES.some((prefix) => specifier.startsWith(prefix)) ||
    ENGINE_MODULE_SPECIFIERS.includes(specifier)
  );
}

describe("the QuickJS engine is absent from a shipped build", () => {
  const reachable = walkEntryGraph();

  it("reaches the app entry to prove the walk works", () => {
    expect([...reachable].some((file) => file.endsWith("/App.tsx"))).toBe(true);
  });

  it("never statically imports the engine packages from the entry graph", () => {
    for (const file of reachable) {
      for (const specifier of extractValueSpecifiers(readFileSync(file, "utf8"))) {
        expect(isEngineSpecifier(specifier), `${file}: ${specifier}`).toBe(false);
      }
    }
  });

  it("never statically reaches the runner, its bundle entry, or the host-assets loader", () => {
    const forbidden = ["/quickjs/runner.ts", "/quickjs/worker-entry.ts", "/quickjs/host-assets.ts"];
    const bad = [...reachable].filter((file) => forbidden.some((suffix) => file.endsWith(suffix)));
    expect(bad).toEqual([]);
  });

  it("statically reaches nothing under quickjs but the flag and its constants leaf", () => {
    const allowed = ["constants.ts", "engine-flag.ts"];
    const underQuickjs = [...reachable]
      .filter((file) => file.startsWith(`${QUICKJS_DIR}/`))
      .map((file) => file.slice(QUICKJS_DIR.length + 1));
    for (const file of underQuickjs) expect(allowed, file).toContain(file);
  });

  it("lets no lazy chunk statically import the engine either", () => {
    for (const file of sourceFiles()) {
      for (const specifier of extractValueSpecifiers(readFileSync(file, "utf8"))) {
        expect(isEngineSpecifier(specifier), `${file}: ${specifier}`).toBe(false);
      }
    }
  });

  it("guards the only reach to the engine with the compile-time flag and a dynamic import", () => {
    const runtime = readFileSync(resolve(SRC_ROOT, "features/plugins/runtime.ts"), "utf8");
    expect(runtime).toContain("QUICKJS_ENGINE_ENABLED");
    expect(runtime).toContain('await import("@/features/plugins/quickjs/host-assets")');
    // No static import sneaks the loader into the chunk.
    expect(runtime).not.toMatch(
      /\bimport\s+[^;]*?from\s+["']@\/features\/plugins\/quickjs\/host-assets["']/
    );
    // The flag is the compile-time platform check, never the runtime platform rule.
    const flag = readFileSync(resolve(QUICKJS_DIR, "engine-flag.ts"), "utf8");
    expect(flag).toContain('import.meta.env.TAURI_ENV_PLATFORM === "android"');
    expect(flag).not.toContain("host-platform");
    expect(flag).not.toContain("pluginsRunOn");
  });
});
