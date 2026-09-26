// File collection for the coverage guard. run.ts feeds the real repository
// through collectGuardInputs; the Vitest mirror
// (src/test/unit/e2e-coverage-guard.test.ts) calls it too, so CI runs the
// guard without a browser.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EXCLUSIONS, ROWS } from "../coverage-matrix";
import type { GuardInput, SourceFile } from "./coverage";

/** Everything checkCoverage needs except allowPlanned. */
export type GuardInputs = Omit<GuardInput, "allowPlanned">;

/** Reads the matrix, CONTEXT.md, the shortcut registry, App.tsx routes and
 * every e2e file under `root` (the repository root). */
export function collectGuardInputs(root: string): GuardInputs {
  function read(path: string): string {
    return readFileSync(resolve(root, path), "utf8");
  }

  function walk(dir: string, skip: (rel: string) => boolean): SourceFile[] {
    const out: SourceFile[] = [];
    for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name).split("\\").join("/");
      if (skip(rel)) continue;
      if (entry.isDirectory()) out.push(...walk(rel, skip));
      else if (/\.(ts|mjs)$/.test(entry.name)) out.push({ path: rel, source: read(rel) });
    }
    return out;
  }

  const specs = walk("e2e/specs", () => false);
  const otherE2eFiles = walk(
    "e2e",
    (rel) =>
      rel === "e2e/specs" ||
      rel === "e2e/guards" ||
      rel === "e2e/.output" ||
      rel.includes("node_modules")
  );

  return {
    rows: ROWS,
    exclusions: EXCLUSIONS,
    contextMd: read("CONTEXT.md"),
    shortcutRegistrySource: read("src/lib/shortcut-registry.ts"),
    appRoutesSource: read("src/App.tsx"),
    specs,
    otherE2eFiles,
  };
}
