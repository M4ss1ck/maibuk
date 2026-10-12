import { statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The entry chunk must not carry the Plugin manifest validator. `zod` and the
 * manifest schema are only needed when a Plugin is validated, which happens
 * after the first render inside the dynamic `lifecycle` import (main.tsx:24).
 * A static import chain from `src/main.tsx` that reaches `zod`,
 * `manifest-schema.ts`, or `manifest-validate.ts` ships the whole validator in
 * the first chunk and pays for it on every launch (#437).
 *
 * This walks the static value-import graph, resolving `@/` and relative
 * specifiers, and ignores `import()` expressions and type-only imports, which
 * the bundler erases. It stands in for the reviewed check: `pnpm build:web`,
 * then grep "ZodError" in the entry script named in `dist/index.html`.
 */

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const FORBIDDEN_FILES = ["manifest-schema.ts", "manifest-validate.ts"];

/** `import`/`export` statements that keep a runtime dependency (not `import type`). */
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

function walkEntryGraph(): { files: Set<string>; bareImports: Set<string> } {
  const entry = resolve(SRC_ROOT, "main.tsx");
  const files = new Set<string>([entry]);
  const bareImports = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    for (const specifier of extractValueSpecifiers(readFileSync(file, "utf8"))) {
      const clean = stripQuery(specifier);
      if (clean === "zod" || clean.startsWith("zod/")) bareImports.add(clean);
      const resolved = resolveSpecifier(specifier, file);
      if (resolved !== null && !files.has(resolved)) {
        files.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return { files, bareImports };
}

describe("the web entry chunk", () => {
  const reachable = walkEntryGraph();

  it("reaches the app entry to prove the walk works", () => {
    expect([...reachable.files].some((file) => file.endsWith("/App.tsx"))).toBe(true);
  });

  it("does not statically import zod, manifest-schema, or manifest-validate", () => {
    const validatorFiles = [...reachable.files].filter((file) =>
      FORBIDDEN_FILES.some((name) => file.endsWith(`/${name}`))
    );
    expect(validatorFiles).toEqual([]);
    expect([...reachable.bareImports]).toEqual([]);
  });
});
