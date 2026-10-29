import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// es-module-lexer keeps its WebAssembly memory for as long as a module that
// imports it stays loaded. Plugin module planning therefore runs the lexer in a
// one-shot Worker (modules.worker.ts) and only reaches module-plan.ts by value
// from there. modules.ts loads it by dynamic import, used when no Worker API
// exists, so the lexer stays off the main chunk. This guard fails when a new
// static import pulls the lexer into the main bundle (#655). Tests are exempt:
// they call computePluginModulePlan directly.

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PLUGINS = "features/plugins";
const LEXER_FILE = `${PLUGINS}/module-plan.ts`;
const WORKER_FILE = `${PLUGINS}/modules.worker.ts`;
const MAIN_FILE = `${PLUGINS}/modules.ts`;

/** Every .ts/.tsx file under src/, relative to src/, skipping src/test. */
function appSourceFiles(dir: string = SRC_ROOT): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "test" ? [] : appSourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry) ? [relative(SRC_ROOT, path).split("\\").join("/")] : [];
  });
}

function read(file: string): string {
  return readFileSync(join(SRC_ROOT, file), "utf8");
}

/** Every static import/export-from statement and its specifier, with `import type` marked. */
function staticImports(source: string): { typeOnly: boolean; specifier: string }[] {
  const pattern = /\b(import|export)\s+((?:type\s+)?)[^;]*?\bfrom\s*["']([^"']+)["']/g;
  return [...source.matchAll(pattern)].map((match) => ({
    typeOnly: match[2].trim() === "type",
    specifier: match[3],
  }));
}

const MODULE_PLAN_SPECIFIER = /(?:^@\/features\/plugins\/|^\.\/|\/)module-plan$/;

describe("Plugin module lexer boundary (#655)", () => {
  it("only module-plan.ts imports es-module-lexer in app code", () => {
    const importers = appSourceFiles().filter((file) => /["']es-module-lexer["']/.test(read(file)));
    expect(importers).toEqual([LEXER_FILE]);
  });

  it("module-plan.ts is imported by value only from the Worker, and from modules.ts by dynamic import", () => {
    const valueImporters = appSourceFiles().filter((file) =>
      staticImports(read(file)).some(
        (imp) => !imp.typeOnly && MODULE_PLAN_SPECIFIER.test(imp.specifier)
      )
    );
    expect(valueImporters).toEqual([WORKER_FILE]);

    const main = read(MAIN_FILE);
    expect(main).toMatch(/\bimport\(\s*["']@\/features\/plugins\/module-plan["']\s*\)/);
    expect(staticImports(main).filter((imp) => MODULE_PLAN_SPECIFIER.test(imp.specifier))).toEqual([
      { typeOnly: true, specifier: "@/features/plugins/module-plan" },
    ]);
  });

  it("the Worker is the only static value consumer of module-plan.ts", () => {
    expect(
      staticImports(read(WORKER_FILE)).filter(
        (imp) => !imp.typeOnly && MODULE_PLAN_SPECIFIER.test(imp.specifier)
      )
    ).toEqual([{ typeOnly: false, specifier: "@/features/plugins/module-plan" }]);
  });
});
